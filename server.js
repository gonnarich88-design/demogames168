require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// ──────────────────────────────────────────────
// Load game data
// ──────────────────────────────────────────────
function loadGames() {
  const gamesPath = path.join(__dirname, 'data', 'games.json');
  const seedPath = path.join(__dirname, 'data', 'seed-games.json');

  try {
    if (fs.existsSync(gamesPath)) {
      return JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to load games.json, falling back to seed data:', err.message);
  }

  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to load seed-games.json:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Multi-domain Reverse Proxy for JILI Games
// Proxies: jiligames.com, uat-wb-api.jiligames.com, casino-wbgame.jiligames.com
// ──────────────────────────────────────────────

// All JILI domains that need proxying (blocked in Thailand)
const JILI_DOMAINS = [
  'jiligames.com',
  'uat-wb-api.jiligames.com',
  'casino-wbgame.jiligames.com',
];

// Convert full URL to our proxy path: https://foo.jiligames.com/bar → /jili/foo.jiligames.com/bar
function toProxyPath(fullUrl) {
  try {
    const u = new URL(fullUrl);
    // Check if it's a JILI domain (any *.jiligames.com)
    if (u.hostname.endsWith('jiligames.com')) {
      return '/jili/' + u.hostname + u.pathname + u.search;
    }
  } catch {}
  return null;
}

// Rewrite HTML body — replace all jiligames.com URLs with proxy paths
// Also inject <base> tag so relative paths resolve through our proxy
function rewriteHtml(body, targetHost, targetPathDir = '/') {
  // Replace https://ANYTHING.jiligames.com/... with /jili/ANYTHING.jiligames.com/...
  let html = body.replace(/https?:\/\/([a-zA-Z0-9.-]*jiligames\.com)(\/[^"'<>\s]*)/g, (match, host, path) => {
    return '/jili/' + host + path;
  });

  // Inject <base> tag + fetch/XHR override for proxied game pages
  if (targetHost) {
    // 1. <base> tag — fixes relative paths (e.g. "src/polyfills.js")
    let basePath = '/jili/' + targetHost + targetPathDir;
    if (!basePath.endsWith('/')) basePath += '/';
    const baseTag = `<base href="${basePath}">`;

    // 2. fetch/XHR override — fixes absolute paths from JS runtime (e.g. "/lang/0604/en-us.json")
    //    Rewrites "/xxx" → "/jili/{targetHost}/xxx" so they go through our proxy
    const proxyBase = '/jili/' + targetHost;
    const overrideScript = `<script>(function(){` +
      `var B='${proxyBase}';` +
      // Override fetch
      `var F=window.fetch;` +
      `window.fetch=function(u,o){` +
        `if(typeof u==='string'&&u.charAt(0)==='/'&&u.indexOf('/jili/')!==0)u=B+u;` +
        `return F.call(this,u,o);` +
      `};` +
      // Override XMLHttpRequest
      `var X=XMLHttpRequest.prototype.open;` +
      `XMLHttpRequest.prototype.open=function(m,u){` +
        `if(typeof u==='string'&&u.charAt(0)==='/'&&u.indexOf('/jili/')!==0)` +
          `arguments[1]=B+u;` +
        `return X.apply(this,arguments);` +
      `};` +
      // Override Image, Script, Audio .src property to catch new Image().src = "/path"
      `var P=function(C,p){` +
        `var d=Object.getOwnPropertyDescriptor(C.prototype,p);` +
        `if(d&&d.set){Object.defineProperty(C.prototype,p,{` +
          `set:function(v){` +
            `if(typeof v==='string'&&v.charAt(0)==='/'&&v.indexOf('/jili/')!==0)v=B+v;` +
            `d.set.call(this,v);` +
          `},get:d.get,configurable:true});}` +
      `};` +
      `try{P(HTMLImageElement,'src');}catch(e){}` +
      `try{P(HTMLScriptElement,'src');}catch(e){}` +
      `try{P(HTMLAudioElement,'src');}catch(e){}` +
      `try{P(HTMLSourceElement,'src');}catch(e){}` +
    `})();</script>`;

    const injection = baseTag + overrideScript;

    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head>' + injection);
    } else if (html.includes('<HEAD>')) {
      html = html.replace('<HEAD>', '<HEAD>' + injection);
    } else {
      html = injection + html;
    }
  }

  return html;
}

// Generic JILI proxy: /jili/:hostname/rest/of/path
app.use('/jili', (req, res) => {
  // Extract target hostname from URL: /jili/casino-wbgame.jiligames.com/rx10000/...
  // req.url has /jili prefix stripped by Express mount, e.g. /jiligames.com/PlusIntro/637?showGame=true
  const fullPath = req.url;
  const match = fullPath.match(/^\/([a-zA-Z0-9.-]*jiligames\.com)(\/[^?]*)?(\?.*)?$/);
  if (!match) {
    console.error('  [PROXY] Invalid path:', fullPath);
    return res.status(400).send('Invalid proxy path');
  }

  const targetHost = match[1];
  const targetPathWithoutQuery = match[2] || '/';
  const targetPath = targetPathWithoutQuery + (match[3] || '');

  // Extract directory part for <base> tag (e.g. /rx10000/ from /rx10000/?ssoKey=...)
  const targetPathDir = targetPathWithoutQuery.endsWith('/')
    ? targetPathWithoutQuery
    : targetPathWithoutQuery.substring(0, targetPathWithoutQuery.lastIndexOf('/') + 1) || '/';

  console.log(`  [PROXY] ${targetHost}${targetPath.substring(0, 80)}...`);

  const options = {
    hostname: targetHost,
    path: targetPath,
    method: req.method,
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer': `https://${targetHost}/`,
      'Origin': `https://${targetHost}`,
    }
  };

  // Copy cookies
  if (req.headers.cookie) {
    options.headers['Cookie'] = req.headers.cookie;
  }

  const proxyReq = https.request(options, (proxyRes) => {
    res.statusCode = proxyRes.statusCode;

    // Copy headers, remove security headers
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      const k = key.toLowerCase();
      if (k === 'x-frame-options' || k === 'x-content-type-options' ||
          k.startsWith('content-security-policy')) continue;
      // Rewrite Location redirects
      if (k === 'location') {
        let loc = value;
        const proxied = toProxyPath(loc);
        if (proxied) {
          res.setHeader('Location', proxied);
        } else if (loc.startsWith('/')) {
          // Relative redirect on same host
          res.setHeader('Location', '/jili/' + targetHost + loc);
        } else {
          res.setHeader('Location', loc);
        }
        continue;
      }
      // Rewrite Set-Cookie domains
      if (k === 'set-cookie') {
        const cookies = Array.isArray(value) ? value : [value];
        const rewritten = cookies.map(c => c.replace(/domain=[^;]+;?/gi, ''));
        res.setHeader('Set-Cookie', rewritten);
        continue;
      }
      res.setHeader(key, value);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    // Check content type — if HTML, buffer and rewrite URLs
    const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf-8');
        html = rewriteHtml(html, targetHost, targetPathDir);
        // Remove content-length since we changed the body
        res.removeHeader('content-length');
        res.end(html);
      });
    } else {
      // Non-HTML: pipe directly
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).send('Game server unavailable');
    console.error('Proxy error:', err.message);
  });

  const onClientClose = () => proxyReq.destroy();
  req.on('close', onClientClose);
  req.on('aborted', onClientClose);

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

// Legacy /proxy route — redirect to new /jili/jiligames.com/...
app.use('/proxy', (req, res) => {
  res.redirect(307, '/jili/jiligames.com' + req.url);
});

// ──────────────────────────────────────────────
// Express - Static files & API
// ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API: Get all games (with optional category, search, pagination)
app.get('/api/games', (req, res) => {
  let games = loadGames();
  const { category, search, page = 1, limit = 50 } = req.query;

  // Filter by category
  if (category && category.toLowerCase() !== 'all') {
    games = games.filter(g =>
      g.category.toLowerCase().replace(/\s+/g, '') === category.toLowerCase().replace(/\s+/g, '')
    );
  }

  // Search by name
  if (search) {
    const term = search.toLowerCase();
    games = games.filter(g => g.name.toLowerCase().includes(term));
  }

  const total = games.length;
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 50;
  const start = (p - 1) * l;
  const paged = games.slice(start, start + l);

  res.json({
    games: paged.map(g => ({
      ...g,
      playUrl: `/jili/jiligames.com/PlusIntro/${g.id}?showGame=true`
    })),
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l)
  });
});

// API: Get single game by ID
app.get('/api/games/:id', (req, res) => {
  const games = loadGames();
  const game = games.find(g => g.id === parseInt(req.params.id));

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  res.json({
    ...game,
    playUrl: `/jili/jiligames.com/PlusIntro/${game.id}?showGame=true`
  });
});

// ──────────────────────────────────────────────
// API: Resolve game URL (server-side redirect chain)
// Follows: PlusTrial → LoginTrial → final game URL
// Returns the final proxied URL for direct iframe loading
// ──────────────────────────────────────────────
function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8')
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

app.get('/api/game-url/:id', async (req, res) => {
  const gameId = req.params.id;
  console.log(`[RESOLVE] Starting resolve for game ${gameId}`);

  try {
    // Step 1: Fetch PlusTrial page from jiligames.com
    const step1 = await httpsGet(`https://jiligames.com/PlusTrial/${gameId}/en-us`);
    console.log(`[RESOLVE] Step1 PlusTrial: HTTP ${step1.statusCode}`);

    // Step 2: Parse meta refresh URL
    const metaMatch = step1.body.match(/url='([^']+)'/i) || step1.body.match(/url="([^"]+)"/i);
    if (!metaMatch) {
      return res.status(500).json({ error: 'Could not find game redirect URL' });
    }
    const loginTrialUrl = metaMatch[1].replace(/&amp;/g, '&');
    console.log(`[RESOLVE] Step2 LoginTrial URL: ${loginTrialUrl.substring(0, 80)}...`);

    // Step 3: Follow LoginTrial redirect (302)
    const step3 = await httpsGet(loginTrialUrl);
    console.log(`[RESOLVE] Step3 LoginTrial: HTTP ${step3.statusCode}`);

    let finalUrl;
    if (step3.statusCode >= 300 && step3.statusCode < 400 && step3.headers.location) {
      finalUrl = step3.headers.location;
    } else if (step3.statusCode === 200) {
      // Sometimes it returns 200 directly
      finalUrl = loginTrialUrl;
    } else {
      return res.status(500).json({ error: 'Game server returned unexpected response' });
    }

    console.log(`[RESOLVE] Final game URL: ${finalUrl.substring(0, 80)}...`);

    // Step 4: Convert to proxy path
    const proxyPath = toProxyPath(finalUrl);
    if (!proxyPath) {
      return res.status(500).json({ error: 'Could not convert game URL to proxy path' });
    }

    res.json({ url: proxyPath });

  } catch (err) {
    console.error('[RESOLVE] Error:', err.message);
    res.status(500).json({ error: 'Failed to resolve game URL: ' + err.message });
  }
});

// ──────────────────────────────────────────────
// Telegram Bot
// ──────────────────────────────────────────────
let bot = null;

if (BOT_TOKEN && BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE') {
  // Use custom HTTPS agent to bypass SSL cert verification (e.g. corporate proxy / missing CA)
  const telegramAgent = new https.Agent({ rejectUnauthorized: false });
  bot = new Telegraf(BOT_TOKEN, { telegram: { agent: telegramAgent } });

  // /start command
  bot.start(async (ctx) => {
    try {
      await ctx.replyWithPhoto(
        'https://co168.bz/assets/images/all_slot_games_in_co168.png',
        {
          caption: '🎰 *ยินดีต้อนรับสู่ Co168 เว็บหลัก*\n\n'
            + 'เว็บรวมเกมส์คาสิโนออนไลน์ สล็อต, ยิงปลา, บาคาร่า และอื่น ๆ อีกมากมาย\n\n'
            + 'ทดลองเล่นฟรี กดปุ่มด้านล่างนี้ได้เลย! 👇',
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 Jili Games', WEBAPP_URL)],
            [Markup.button.url('🌐 หน้าเว็บหลัก', 'https://ai-code-kutt.xiwm1k.easypanel.host/hfN3ma')]
          ])
        }
      );

      // Set menu button for this chat
      await ctx.setChatMenuButton({
        type: 'web_app',
        text: '🎮 Play Games',
        web_app: { url: WEBAPP_URL }
      });
    } catch (err) {
      console.error('Error in /start:', err.message);
      await ctx.reply('Welcome! Tap the button below to play games.',
        Markup.inlineKeyboard([
          [Markup.button.webApp('🎮 Open Game Catalog', WEBAPP_URL)]
        ])
      );
    }
  });

  // /games command
  bot.command('games', async (ctx) => {
    await ctx.reply(
      '🎰 Choose a category or browse all games:',
      Markup.inlineKeyboard([
        [Markup.button.webApp('🎮 All Games', WEBAPP_URL)],
        [
          Markup.button.webApp('🎰 Slots', `${WEBAPP_URL}?cat=slot`),
          Markup.button.webApp('🐟 Fishing', `${WEBAPP_URL}?cat=fishing`)
        ],
        [
          Markup.button.webApp('🃏 Table', `${WEBAPP_URL}?cat=tableandcard`),
          Markup.button.webApp('🔢 Bingo', `${WEBAPP_URL}?cat=bingo`)
        ],
        [Markup.button.webApp('🎲 Casino', `${WEBAPP_URL}?cat=casino`)]
      ])
    );
  });

  // /help command
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 *How to use JILI Games Bot*\n\n'
      + '1️⃣ Tap *"Play Games"* button at the bottom\n'
      + '2️⃣ Browse games by category or search\n'
      + '3️⃣ Tap a game to see details\n'
      + '4️⃣ Tap *"Play Demo"* to try the game for free!\n\n'
      + '*Commands:*\n'
      + '/start - Open the game catalog\n'
      + '/games - Browse games by category\n'
      + '/help - Show this help message',
      { parse_mode: 'Markdown' }
    );
  });

  // Launch bot with onLaunch callback (launch() Promise never resolves because polling loop is infinite)
  console.log('[BOT] Connecting to Telegram API...');
  bot.launch({}, () => {
    console.log(`🤖 Telegram bot started — @${bot.botInfo?.username}`);
  }).catch(err => console.error('[BOT] Failed to start bot:', err.message));

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('⚠️  BOT_TOKEN not set. Telegram bot is disabled.');
  console.warn('   Set BOT_TOKEN in .env to enable the bot.');
}

// ──────────────────────────────────────────────
// Catch-all: redirect unmatched paths through proxy
// (game pages loaded via proxy reference absolute paths like /PlusTrial/637/en-us
//  which need to be routed through our reverse proxy to jiligames.com)
// ──────────────────────────────────────────────
app.use((req, res, next) => {
  // Only intercept paths that are NOT our own app resources
  if (req.path === '/' || req.path === '/game.html' ||
      req.path.startsWith('/api/') || req.path.startsWith('/proxy/') ||
      req.path.startsWith('/jili/') ||
      req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
      req.path.startsWith('/images/')) {
    return next();
  }
  // Detect origin domain from Referer header (e.g. /jili/casino-wbgame.jiligames.com/...)
  // so absolute paths like /astarte/... go to the correct game domain, not jiligames.com
  const ref = req.headers.referer || '';
  const refMatch = ref.match(/\/jili\/([a-zA-Z0-9.-]*jiligames\.com)/);
  const targetDomain = refMatch ? refMatch[1] : 'jiligames.com';
  console.log(`  [CATCH-ALL] ${req.url} → ${targetDomain} (ref: ${ref.substring(ref.indexOf('/jili/'), ref.indexOf('/jili/') + 50) || 'none'})`);
  // Redirect to proxy (307 preserves HTTP method)
  res.redirect(307, '/jili/' + targetDomain + req.url);
});

// ──────────────────────────────────────────────
// Start Express server
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 JILI Games Mini App Server`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   WebApp:  ${WEBAPP_URL}`);
  console.log(`   Bot:     ${bot ? 'Active' : 'Disabled (no BOT_TOKEN)'}`);
  console.log(`   Games:   ${loadGames().length} games loaded\n`);
});
