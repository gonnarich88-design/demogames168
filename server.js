require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const url = require('url');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const OUTBOUND_PROXY_URL = process.env.OUTBOUND_PROXY_URL;

// Cached proxy agent for outbound requests (for bypassing regional blocks)
let _jiliProxyAgent = null;
function getJiliOutboundAgent(hostname) {
  if (!OUTBOUND_PROXY_URL) return undefined;
  if (!hostname || !hostname.endsWith('jiligames.com')) return undefined;
  if (!_jiliProxyAgent) {
    _jiliProxyAgent = new HttpsProxyAgent(OUTBOUND_PROXY_URL);
  }
  return _jiliProxyAgent;
}

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
    agent: getJiliOutboundAgent(targetHost),
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
// Dynamic HTML pages — serve with inline JS to bypass Telegram WebView cache
// ──────────────────────────────────────────────
const APP_VERSION = require('./package.json').version;

function serveInlineHtml(htmlFile, jsFiles) {
  const htmlPath = path.join(__dirname, 'public', htmlFile);
  return (req, res) => {
    let html = fs.readFileSync(htmlPath, 'utf-8');
    // For each JS file: remove external <script> reference and inline the content
    jsFiles.forEach(jsFile => {
      const jsName = jsFile.split('/').pop();
      html = html.replace(new RegExp(`<script[^>]*${jsName}[^<]*</script>`, 'g'), '');
      const jsContent = fs.readFileSync(path.join(__dirname, 'public', jsFile), 'utf-8');
      html = html.replace('</body>', `<script>\n${jsContent}\n</script>\n</body>`);
    });
    // Remove any Date.now() cache-bust loaders
    html = html.replace(/<script>\s*\/\/ Cache-bust[\s\S]*?<\/script>/g, '');
    // Inject live version from package.json into footer (works with both class-based and inline-style footers)
    html = html.replace(/v[\d.]+<\/footer>/, `v${APP_VERSION}</footer>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(html);
  };
}

// Intercept HTML pages BEFORE express.static to prevent cached JS from loading
app.get('/game.html', (req, res, next) => {
  if (!req.query.id) return res.redirect('/');
  serveInlineHtml('game.html', ['js/game.js'])(req, res);
});

app.get('/', serveInlineHtml('index.html', ['js/app.js']));

// ──────────────────────────────────────────────
// Express - Static files & API
// ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
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
// ──────────────────────────────────────────────
function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      agent: getJiliOutboundAgent(u.hostname),
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

// Shared: resolve game ID to proxy path. Returns { proxyPath } or { error, hint }.
async function resolveGameUrl(gameId) {
  const step1 = await httpsGet(`https://jiligames.com/PlusTrial/${gameId}/en-us`);
  const metaMatch = step1.body.match(/url='([^']+)'/i) || step1.body.match(/url="([^"]+)"/i);
  if (!metaMatch) return { error: 'Could not find game redirect URL' };
  const loginTrialUrl = metaMatch[1].replace(/&amp;/g, '&');
  const step3 = await httpsGet(loginTrialUrl);
  let finalUrl;
  if (step3.statusCode >= 300 && step3.statusCode < 400 && step3.headers.location) {
    finalUrl = step3.headers.location;
  } else if (step3.statusCode === 200) {
    finalUrl = loginTrialUrl;
  } else {
    return { error: 'Game server returned unexpected response' };
  }
  const proxyPath = toProxyPath(finalUrl);
  if (!proxyPath) return { error: 'Could not convert game URL to proxy path' };
  return { proxyPath };
}

// GET /play/:id — redirect to game (no fetch in WebView; works in Telegram)
app.get('/play/:id', async (req, res) => {
  const gameId = req.params.id;
  console.log(`[PLAY] Resolving game ${gameId} for redirect`);
  try {
    const result = await resolveGameUrl(gameId);
    if (result.error) {
      const hint = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Timeout/i.test(result.error) && !OUTBOUND_PROXY_URL
        ? 'Set OUTBOUND_PROXY_URL if server is in blocked region.'
        : '';
      const q = new URLSearchParams({ id: gameId, error: result.error });
      if (hint) q.set('hint', hint);
      return res.redirect(302, '/game.html?' + q.toString());
    }
    res.redirect(302, result.proxyPath);
  } catch (err) {
    console.error('[PLAY] Error:', err.message);
    const msg = 'Failed to resolve: ' + err.message;
    const hint = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Timeout/i.test(err.message) && !OUTBOUND_PROXY_URL
      ? 'Set OUTBOUND_PROXY_URL if server is in blocked region.'
      : '';
    const q = new URLSearchParams({ id: gameId, error: msg });
    if (hint) q.set('hint', hint);
    res.redirect(302, '/game.html?' + q.toString());
  }
});

app.get('/api/game-url/:id', async (req, res) => {
  const gameId = req.params.id;
  console.log(`[RESOLVE] Starting resolve for game ${gameId}`);
  try {
    const result = await resolveGameUrl(gameId);
    if (result.error) {
      const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Timeout|socket hang up/i.test(result.error);
      const hint = isNetwork && !OUTBOUND_PROXY_URL
        ? 'Server may be in Thailand. Set OUTBOUND_PROXY_URL in .env (proxy outside Thailand) and restart.'
        : undefined;
      return res.status(500).json({ error: result.error, ...(hint && { hint }) });
    }
    res.json({ url: result.proxyPath });
  } catch (err) {
    console.error('[RESOLVE] Error:', err.message);
    const msg = 'Failed to resolve game URL: ' + err.message;
    const isNetwork = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Timeout|socket hang up/i.test(err.message);
    const hint = isNetwork && !OUTBOUND_PROXY_URL
      ? 'Server may be in Thailand. Set OUTBOUND_PROXY_URL in .env (proxy outside Thailand) and restart.'
      : undefined;
    res.status(500).json({ error: msg, ...(hint && { hint }) });
  }
});

// ──────────────────────────────────────────────
// API: Server info / debug (check hosting location & jiligames reachability)
// ──────────────────────────────────────────────
app.get('/api/server-info', async (req, res) => {
  const info = { timestamp: new Date().toISOString() };

  // 1. Check server IP & geo location via external service
  try {
    const geoRes = await httpsGet('https://ipinfo.io/json');
    if (geoRes.statusCode === 200) {
      const geo = JSON.parse(geoRes.body);
      info.server = { ip: geo.ip, city: geo.city, region: geo.region, country: geo.country, org: geo.org };
    }
  } catch (err) {
    info.server = { error: err.message };
  }

  // 2. Check if server can reach jiligames.com
  try {
    const start = Date.now();
    const jiliRes = await httpsGet('https://jiligames.com/');
    info.jiligames = {
      reachable: jiliRes.statusCode < 500,
      statusCode: jiliRes.statusCode,
      latencyMs: Date.now() - start
    };
  } catch (err) {
    info.jiligames = { reachable: false, error: err.message };
  }

  // 3. Config info
  info.config = {
    outboundProxy: OUTBOUND_PROXY_URL ? 'configured' : 'not set',
    nodeEnv: process.env.NODE_ENV || 'not set',
    uptime: Math.floor(process.uptime()) + 's'
  };

  res.json(info);
});

// API: Debug test game URL resolution step-by-step
app.get('/api/debug/test-game/:id', async (req, res) => {
  const gameId = req.params.id;
  const steps = [];

  try {
    // Step 1
    const t1 = Date.now();
    const step1 = await httpsGet(`https://jiligames.com/PlusTrial/${gameId}/en-us`);
    steps.push({ step: 1, name: 'PlusTrial', statusCode: step1.statusCode, latencyMs: Date.now() - t1, bodyLength: step1.body.length });

    // Step 2: parse meta refresh
    const metaMatch = step1.body.match(/url='([^']+)'/i) || step1.body.match(/url="([^"]+)"/i);
    if (!metaMatch) {
      steps.push({ step: 2, name: 'ParseMetaRefresh', error: 'No meta refresh found', bodyPreview: step1.body.substring(0, 300) });
      return res.json({ success: false, steps });
    }
    const loginTrialUrl = metaMatch[1].replace(/&amp;/g, '&');
    steps.push({ step: 2, name: 'ParseMetaRefresh', url: loginTrialUrl.substring(0, 120) + '...' });

    // Step 3: follow LoginTrial
    const t3 = Date.now();
    const step3 = await httpsGet(loginTrialUrl);
    steps.push({ step: 3, name: 'LoginTrial', statusCode: step3.statusCode, latencyMs: Date.now() - t3, hasLocation: !!step3.headers.location });

    let finalUrl;
    if (step3.statusCode >= 300 && step3.statusCode < 400 && step3.headers.location) {
      finalUrl = step3.headers.location;
    } else if (step3.statusCode === 200) {
      finalUrl = loginTrialUrl;
    }

    // Step 4: convert to proxy path
    const proxyPath = finalUrl ? toProxyPath(finalUrl) : null;
    steps.push({ step: 4, name: 'ProxyPath', finalUrl: finalUrl ? finalUrl.substring(0, 120) + '...' : null, proxyPath: proxyPath ? proxyPath.substring(0, 120) + '...' : null });

    res.json({ success: !!proxyPath, steps });
  } catch (err) {
    steps.push({ step: 'error', message: err.message });
    res.json({ success: false, steps });
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
            [Markup.button.webApp('🎮 ทดลองเล่นฟรี', WEBAPP_URL)],
            [Markup.button.url('🌐 หน้าเว็บหลัก', 'https://ai-code-kutt.xiwm1k.easypanel.host/hfN3ma')],
            [Markup.button.url('✍️ สมัครสมาชิก', 'https://co168.bz/register')]
          ])
        }
      );

      // Set menu button for this chat
      await ctx.setChatMenuButton({
        type: 'web_app',
        text: '🎮 เล่นเกมส์',
        web_app: { url: WEBAPP_URL }
      });
    } catch (err) {
      console.error('Error in /start:', err.message);
      await ctx.reply('ยินดีตอนรับ! กดปุ่มด้านล่างเพื่อเล่นเกมส์.',
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
      '📖 *วิธีใช้งาน Co168 Bot*\n\n'
      + '1️⃣ กดปุ่ม *"เล่นเกมส์"* ที่ปุ่มซ้ายล่าง\n'
      + '2️⃣ ดูเกมส์ตามหมวดหมู่หรือค้นหา\n'
      + '3️⃣ กดเกมส์เพื่อดูรายละเอียด\n'
      + '4️⃣ กด *"ทดลองเล่นฟรี"* เพื่อทดลองเล่นเกมส์ฟรี!\n\n'
      + '*คำสั่ง:*\n'
      + '/start - เปิดหน้าเกมส์\n'
      + '/games - ดูเกมส์ตามหมวดหมู่\n'
      + '/help - ดูวิธีใช้งาน',
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
      req.path.startsWith('/play/') || req.path.startsWith('/jili/') ||
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
