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
// Load Pragmatic Play game data
// ──────────────────────────────────────────────
function loadPPGames() {
  const gamesPath = path.join(__dirname, 'data', 'pp-games.json');
  const seedPath = path.join(__dirname, 'data', 'pp-seed-games.json');

  try {
    if (fs.existsSync(gamesPath)) {
      return JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to load pp-games.json, falling back to seed data:', err.message);
  }

  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to load pp-seed-games.json:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Load Joker Gaming game data
// ──────────────────────────────────────────────
function loadJokerGames() {
  const gamesPath = path.join(__dirname, 'data', 'joker-games.json');
  const seedPath = path.join(__dirname, 'data', 'joker-seed-games.json');

  try {
    if (fs.existsSync(gamesPath)) {
      return JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));
    }
  } catch (err) {
    console.warn('Failed to load joker-games.json, falling back to seed data:', err.message);
  }

  try {
    return JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to load joker-seed-games.json:', err.message);
    return [];
  }
}

// ──────────────────────────────────────────────
// Load provider data
// ──────────────────────────────────────────────
function loadProviders() {
  const providersPath = path.join(__dirname, 'data', 'providers.json');
  try {
    return JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to load providers.json:', err.message);
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
// Reverse Proxy for Pragmatic Play Demo Games
// Proxies: demogamesfree.pragmaticplay.net and related CDN domains
// ──────────────────────────────────────────────

const PP_DOMAINS = [
  'demogamesfree.pragmaticplay.net',
  'commonassets.pragmaticplay.net',
  'cdn-gcp.pragmaticplay.net',
  'static.pragmaticplay.net',
  'hermes.pragmaticplay.net',
  'gserver.pragmaticplay.net',
];

function toPPProxyPath(fullUrl) {
  try {
    const u = new URL(fullUrl);
    if (u.hostname.endsWith('pragmaticplay.net') || u.hostname.endsWith('pragmaticplay.com')) {
      return '/pp-proxy/' + u.hostname + u.pathname + u.search;
    }
  } catch {}
  return null;
}

function rewritePPHtml(body, targetHost, targetPathDir = '/') {
  let html = body.replace(/https?:\/\/([a-zA-Z0-9.-]*pragmaticplay\.(?:net|com))(\/[^"'<>\s]*)/g, (match, host, path) => {
    return '/pp-proxy/' + host + path;
  });

  if (targetHost) {
    let basePath = '/pp-proxy/' + targetHost + targetPathDir;
    if (!basePath.endsWith('/')) basePath += '/';
    const baseTag = `<base href="${basePath}">`;

    const proxyBase = '/pp-proxy/' + targetHost;
    const overrideScript = `<script>(function(){` +
      `var B='${proxyBase}';` +
      `var F=window.fetch;` +
      `window.fetch=function(u,o){` +
        `if(typeof u==='string'&&u.charAt(0)==='/'&&u.indexOf('/pp-proxy/')!==0)u=B+u;` +
        `return F.call(this,u,o);` +
      `};` +
      `var X=XMLHttpRequest.prototype.open;` +
      `XMLHttpRequest.prototype.open=function(m,u){` +
        `if(typeof u==='string'&&u.charAt(0)==='/'&&u.indexOf('/pp-proxy/')!==0)` +
          `arguments[1]=B+u;` +
        `return X.apply(this,arguments);` +
      `};` +
      `var P=function(C,p){` +
        `var d=Object.getOwnPropertyDescriptor(C.prototype,p);` +
        `if(d&&d.set){Object.defineProperty(C.prototype,p,{` +
          `set:function(v){` +
            `if(typeof v==='string'&&v.charAt(0)==='/'&&v.indexOf('/pp-proxy/')!==0)v=B+v;` +
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

app.use('/pp-proxy', (req, res) => {
  const fullPath = req.url;
  const match = fullPath.match(/^\/([a-zA-Z0-9.-]*pragmaticplay\.(?:net|com))(\/[^?]*)?(\?.*)?$/);
  if (!match) {
    console.error('  [PP-PROXY] Invalid path:', fullPath);
    return res.status(400).send('Invalid proxy path');
  }

  const targetHost = match[1];
  const targetPathWithoutQuery = match[2] || '/';
  const targetPath = targetPathWithoutQuery + (match[3] || '');

  const targetPathDir = targetPathWithoutQuery.endsWith('/')
    ? targetPathWithoutQuery
    : targetPathWithoutQuery.substring(0, targetPathWithoutQuery.lastIndexOf('/') + 1) || '/';

  console.log(`  [PP-PROXY] ${targetHost}${targetPath.substring(0, 80)}...`);

  const options = {
    hostname: targetHost,
    path: targetPath,
    method: req.method,
    rejectAuthorized: false,
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Referer': `https://${targetHost}/`,
      'Origin': `https://${targetHost}`,
    }
  };

  if (req.headers.cookie) {
    options.headers['Cookie'] = req.headers.cookie;
  }

  const agent = new https.Agent({ rejectUnauthorized: false });
  options.agent = agent;

  const proxyReq = https.request(options, (proxyRes) => {
    res.statusCode = proxyRes.statusCode;

    for (const [key, value] of Object.entries(proxyRes.headers)) {
      const k = key.toLowerCase();
      if (k === 'x-frame-options' || k === 'x-content-type-options' ||
          k.startsWith('content-security-policy')) continue;
      if (k === 'location') {
        let loc = value;
        const proxied = toPPProxyPath(loc);
        if (proxied) {
          res.setHeader('Location', proxied);
        } else if (loc.startsWith('/')) {
          res.setHeader('Location', '/pp-proxy/' + targetHost + loc);
        } else {
          res.setHeader('Location', loc);
        }
        continue;
      }
      if (k === 'set-cookie') {
        const cookies = Array.isArray(value) ? value : [value];
        const rewritten = cookies.map(c => c.replace(/domain=[^;]+;?/gi, ''));
        res.setHeader('Set-Cookie', rewritten);
        continue;
      }
      res.setHeader(key, value);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
    if (ct.includes('text/html')) {
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf-8');
        html = rewritePPHtml(html, targetHost, targetPathDir);
        res.removeHeader('content-length');
        res.end(html);
      });
    } else {
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).send('Game server unavailable');
    console.error('PP Proxy error:', err.message);
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

// ──────────────────────────────────────────────
// Dynamic HTML pages — serve with inline JS to bypass Telegram WebView cache
// ──────────────────────────────────────────────
const APP_VERSION = require('./package.json').version;
const WEBAPP_URL_VERSIONED = WEBAPP_URL + '?v=' + APP_VERSION;

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
    // Inject live version from package.json (header span and footer)
    html = html.replace(/v[\d.]+<\/span>/g, `v${APP_VERSION}</span>`);
    html = html.replace(/v[\d.]+<\/footer>/g, `v${APP_VERSION}</footer>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(html);
  };
}

// Intercept game.html — redirect to /play/:id so the game loads directly
// This fixes Telegram WebView cache: even if old JS links to /game.html?id=X,
// the server redirects to /play/X which resolves and loads the game
app.get('/game.html', (req, res) => {
  const gameId = req.query.id;
  if (!gameId) return res.redirect('/');
  res.redirect(302, '/play/' + gameId);
});

// Home page: Co168 provider selection
app.get('/', serveInlineHtml('home.html', ['js/home.js']));

// Catalog pages per provider
app.get('/catalog/jili', serveInlineHtml('index.html', ['js/app.js']));
app.get('/catalog/pp', serveInlineHtml('index.html', ['js/app.js']));
app.get('/catalog/joker', serveInlineHtml('index.html', ['js/app.js']));

// ──────────────────────────────────────────────
// API: Proxy external images (fix PP thumbnails not loading in WebView/CORS)
// Supports OUTBOUND_PROXY_URL for regions where pragmaticplay.com is blocked
// Also caches downloaded images locally in public/images/pp/
// ──────────────────────────────────────────────
const ALLOWED_IMAGE_HOSTS = ['www.pragmaticplay.com', 'pragmaticplay.com', 'dl.zhenwudadi.net'];
const IMG_CACHE_DIR = path.join(__dirname, 'public', 'images', 'cache');
const PP_IMG_CACHE_DIR = path.join(__dirname, 'public', 'images', 'pp');
if (!fs.existsSync(PP_IMG_CACHE_DIR)) fs.mkdirSync(PP_IMG_CACHE_DIR, { recursive: true });
if (!fs.existsSync(IMG_CACHE_DIR)) fs.mkdirSync(IMG_CACHE_DIR, { recursive: true });

app.get('/api/proxy-image', (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).send('Missing url');

  let parsed;
  try { parsed = new URL(rawUrl); } catch { return res.status(400).send('Invalid url'); }
  if (!ALLOWED_IMAGE_HOSTS.includes(parsed.hostname)) return res.status(403).send('Host not allowed');

  // Check local disk cache first (fast, no network needed)
  const cacheKey = parsed.pathname.split('/').pop() || 'img';
  const cachePath = path.join(PP_IMG_CACHE_DIR, cacheKey);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 500) {
    const ext = path.extname(cacheKey).toLowerCase();
    const ctMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    res.setHeader('Content-Type', ctMap[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    return fs.createReadStream(cachePath).pipe(res);
  }

  // Fetch from upstream (use OUTBOUND_PROXY_URL if configured)
  const agent = OUTBOUND_PROXY_URL
    ? new HttpsProxyAgent(OUTBOUND_PROXY_URL)
    : new https.Agent({ rejectUnauthorized: false });

  const opts = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    agent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Co168ImageProxy/1.0)',
      'Accept': 'image/*,*/*'
    }
  };
  const proxyReq = https.request(opts, (proxyRes) => {
    // Follow redirects
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      res.redirect(302, '/api/proxy-image?url=' + encodeURIComponent(proxyRes.headers.location));
      proxyRes.resume();
      return;
    }
    if (proxyRes.statusCode >= 400) {
      res.status(proxyRes.statusCode).send('Upstream error');
      return;
    }
    const ct = proxyRes.headers['content-type'] || 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=604800');

    // Pipe to response AND save to disk cache simultaneously
    const cacheStream = fs.createWriteStream(cachePath);
    proxyRes.pipe(res);
    proxyRes.pipe(cacheStream);
    cacheStream.on('error', () => {});
  });
  proxyReq.on('error', (err) => {
    console.error('[PROXY-IMAGE] Error:', err.message);
    if (!res.headersSent) res.status(502).send('Image proxy error');
  });
  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).send('Image proxy timeout');
  });
  proxyReq.end();
});

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

// API: List providers
app.get('/api/providers', (req, res) => {
  const providers = loadProviders();
  res.json(providers);
});

// API: Get games for a specific provider
app.get('/api/providers/:provider/games', (req, res) => {
  const provider = req.params.provider.toLowerCase();
  const { category, search, page = 1, limit = 50 } = req.query;

  let rawGames;
  let playUrlFn;

  if (provider === 'jili') {
    rawGames = loadGames();
    playUrlFn = g => `/play/jili/${g.id}`;
  } else if (provider === 'pp') {
    rawGames = loadPPGames();
    playUrlFn = g => `/play/pp/${g.slug}`;
  } else if (provider === 'joker') {
    rawGames = loadJokerGames();
    playUrlFn = g => `/play/joker/${encodeURIComponent(g.code)}`;
  } else {
    const providers = loadProviders();
    const found = providers.find(p => p.slug === provider);
    if (!found) return res.status(404).json({ error: 'Provider not found' });
    return res.json({ games: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  }

  let games = rawGames;
  if (category && category.toLowerCase() !== 'all') {
    games = games.filter(g =>
      g.category.toLowerCase().replace(/\s+/g, '') === category.toLowerCase().replace(/\s+/g, '')
    );
  }
  if (search) {
    const term = search.toLowerCase();
    games = games.filter(g => g.name.toLowerCase().includes(term));
  }
  const total = games.length;
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 50;
  const start = (p - 1) * l;
  const paged = games.slice(start, start + l);
  return res.json({
    games: paged.map(g => ({
      ...g,
      playUrl: playUrlFn(g)
    })),
    total, page: p, limit: l,
    totalPages: Math.ceil(total / l)
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

// GET /play/jili/:id — resolve JILI game and redirect to proxy path
app.get('/play/jili/:id', async (req, res) => {
  const gameId = req.params.id;
  console.log(`[PLAY] Resolving JILI game ${gameId} for redirect`);
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

// ──────────────────────────────────────────────
// Pragmatic Play: Resolve demo game URL
// Fetches the PP game page and extracts the demo iframe URL (data-game-src)
// ──────────────────────────────────────────────
function httpsGetInsecure(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      agent: new https.Agent({ rejectUnauthorized: false }),
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function resolvePPGameUrl(slug) {
  let ppPageUrl = `https://www.pragmaticplay.com/en/games/${slug}/?gamelang=en&cur=THB`;
  console.log(`[PP-RESOLVE] Fetching ${ppPageUrl}`);

  const maxRedirects = 5;
  let resp;
  for (let i = 0; i < maxRedirects; i++) {
    resp = await httpsGetInsecure(ppPageUrl);
    if ((resp.statusCode === 301 || resp.statusCode === 302) && resp.headers.location) {
      const loc = resp.headers.location;
      ppPageUrl = loc.startsWith('http') ? loc : new URL(loc, ppPageUrl).href;
      console.log(`[PP-RESOLVE] Following ${resp.statusCode} → ${ppPageUrl}`);
      continue;
    }
    break;
  }

  if (resp.statusCode >= 400) {
    return { error: `PP returned status ${resp.statusCode}` };
  }

  const srcMatch = resp.body.match(/data-game-src="([^"]+)"/i);
  if (!srcMatch) {
    return { error: 'Could not find demo game URL on PP page' };
  }

  let demoUrl = srcMatch[1].replace(/&amp;/g, '&');
  console.log(`[PP-RESOLVE] Demo URL: ${demoUrl.substring(0, 100)}...`);

  // Convert to proxy path
  const proxyPath = toPPProxyPath(demoUrl);
  if (!proxyPath) {
    return { error: 'Could not convert PP demo URL to proxy path' };
  }

  return { proxyPath, demoUrl };
}

// GET /play/pp/:slug — resolve PP game and serve full-screen iframe page
// PP validates websiteUrl vs referrer, so we embed the demo in an iframe on our page.
// The iframe loads from PP domain directly → origin checks pass.
app.get('/play/pp/:slug', async (req, res) => {
  const slug = req.params.slug;
  console.log(`[PLAY] Resolving PP game "${slug}"`);
  try {
    const result = await resolvePPGameUrl(slug);
    if (result.error) {
      const q = new URLSearchParams({ id: slug, provider: 'pp', error: result.error });
      return res.redirect(302, '/game.html?' + q.toString());
    }

    const gameName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const html = `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${gameName} - Pragmatic Play Demo</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#0d0d0d;font-family:system-ui,sans-serif}
.pp-bar{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:rgba(13,13,13,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(255,215,0,0.15)}
.pp-bar a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;
  justify-content:center;text-decoration:none;flex-shrink:0}
.pp-bar a svg{width:18px;height:18px;fill:#e8e8e8}
.pp-bar .pp-name{color:#e8e8e8;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pp-bar .pp-badge{background:linear-gradient(135deg,#FFD700,#FF8C00);color:#000;font-size:9px;font-weight:700;
  padding:2px 8px;border-radius:10px;flex-shrink:0}
iframe{position:fixed;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);border:none;background:#0d0d0d}
.pp-loading{position:fixed;top:52px;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:#0d0d0d;color:rgba(255,255,255,0.6);font-size:14px;z-index:50}
.pp-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#FFD700;
  border-radius:50%;animation:spin .8s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<div class="pp-bar">
  <a href="/catalog/pp"><svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></a>
  <span class="pp-name">${gameName}</span>
  <span class="pp-badge">DEMO</span>
</div>
<div class="pp-loading" id="loader"><div class="pp-spinner"></div>กำลังโหลดเกม...</div>
<iframe src="${result.demoUrl}" allow="autoplay; fullscreen" allowfullscreen
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
  referrerpolicy="no-referrer"
  onload="document.getElementById('loader').style.display='none'"></iframe>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    console.error('[PLAY-PP] Error:', err.message);
    const q = new URLSearchParams({ id: slug, provider: 'pp', error: 'Failed to resolve: ' + err.message });
    res.redirect(302, '/game.html?' + q.toString());
  }
});

// ──────────────────────────────────────────────
// Joker Gaming: Resolve demo game URL
// Calls joker123.net API to get a free-play session URL, then follows redirects
// to get the final game page URL on the game server.
// ──────────────────────────────────────────────
async function resolveJokerGameUrl(gameCode) {
  const apiUrl = `https://www.joker123.net/Service/PlayFreeGame?gameCode=${encodeURIComponent(gameCode)}`;
  console.log(`[JOKER-RESOLVE] POST ${apiUrl}`);

  const resp = await httpsPostSimple(apiUrl);
  if (resp.statusCode !== 200) {
    return { error: `Joker API returned status ${resp.statusCode}` };
  }

  let json;
  try { json = JSON.parse(resp.body); } catch { return { error: 'Invalid JSON from Joker API' }; }
  if (!json.Success || !json.Data || !json.Data.GameUrl) {
    return { error: json.Message || 'Joker API returned no GameUrl' };
  }

  let gameUrl = json.Data.GameUrl;
  if (!gameUrl.startsWith('http')) {
    gameUrl = 'https://www.joker123.net' + (gameUrl.startsWith('/') ? '' : '/') + gameUrl;
  }
  console.log(`[JOKER-RESOLVE] Initial GameUrl: ${gameUrl}`);

  const maxRedirects = 5;
  for (let i = 0; i < maxRedirects; i++) {
    const r = await httpsGetInsecure(gameUrl);
    if ((r.statusCode === 301 || r.statusCode === 302) && r.headers.location) {
      const loc = r.headers.location;
      gameUrl = loc.startsWith('http') ? loc : new URL(loc, gameUrl).href;
      console.log(`[JOKER-RESOLVE] Following ${r.statusCode} → ${gameUrl}`);
      continue;
    }
    break;
  }

  console.log(`[JOKER-RESOLVE] Final URL: ${gameUrl}`);
  return { demoUrl: gameUrl };
}

function httpsPostSimple(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      agent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Length': 0,
        'Referer': 'https://www.joker123.net/GameIndex',
        'Origin': 'https://www.joker123.net',
      }
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// GET /play/joker/:code — resolve Joker demo game and serve full-screen iframe page
app.get('/play/joker/:code', async (req, res) => {
  const code = req.params.code;
  console.log(`[PLAY] Resolving Joker game "${code}"`);
  try {
    const result = await resolveJokerGameUrl(code);
    if (result.error) {
      const q = new URLSearchParams({ id: code, provider: 'joker', error: result.error });
      return res.redirect(302, '/game.html?' + q.toString());
    }

    const gameName = code.replace(/([A-Z])/g, ' $1').replace(/GW$/, '').trim();
    const html = `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>${gameName} - Joker Gaming Demo</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#0d0d0d;font-family:system-ui,sans-serif}
.jk-bar{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:rgba(13,13,13,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  border-bottom:1px solid rgba(255,215,0,0.15)}
.jk-bar a{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);display:flex;align-items:center;
  justify-content:center;text-decoration:none;flex-shrink:0}
.jk-bar a svg{width:18px;height:18px;fill:#e8e8e8}
.jk-bar .jk-name{color:#e8e8e8;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jk-bar .jk-badge{background:linear-gradient(135deg,#FFD700,#FF8C00);color:#000;font-size:9px;font-weight:700;
  padding:2px 8px;border-radius:10px;flex-shrink:0}
iframe{position:fixed;top:52px;left:0;right:0;bottom:0;width:100%;height:calc(100% - 52px);border:none;background:#0d0d0d}
.jk-loading{position:fixed;top:52px;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;background:#0d0d0d;color:rgba(255,255,255,0.6);font-size:14px;z-index:50}
.jk-spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top-color:#FFD700;
  border-radius:50%;animation:spin .8s linear infinite;margin-bottom:16px}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<div class="jk-bar">
  <a href="/catalog/joker"><svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></a>
  <span class="jk-name">${gameName}</span>
  <span class="jk-badge">DEMO</span>
</div>
<div class="jk-loading" id="loader"><div class="jk-spinner"></div>กำลังโหลดเกม...</div>
<iframe src="${result.demoUrl}" allow="autoplay; fullscreen" allowfullscreen
  referrerpolicy="no-referrer"
  onload="document.getElementById('loader').style.display='none'"></iframe>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    console.error('[PLAY-JOKER] Error:', err.message);
    const q = new URLSearchParams({ id: code, provider: 'joker', error: 'Failed to resolve: ' + err.message });
    res.redirect(302, '/game.html?' + q.toString());
  }
});

// GET /play/:id — backward compatibility, redirect to /play/jili/:id
app.get('/play/:id', (req, res) => {
  res.redirect(302, '/play/jili/' + req.params.id);
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
            [Markup.button.webApp('🎮 ทดลองเล่นฟรี', WEBAPP_URL_VERSIONED)],
            [Markup.button.url('🌐 หน้าเว็บหลัก', 'https://ai-code-kutt.xiwm1k.easypanel.host/hfN3ma')],
            [Markup.button.url('✍️ สมัครสมาชิก', 'https://co168.bz/register')]
          ])
        }
      );

      // Set menu button for this chat
      await ctx.setChatMenuButton({
        type: 'web_app',
        text: '🎮 เล่นเกมส์',
        web_app: { url: WEBAPP_URL_VERSIONED }
      });
    } catch (err) {
      console.error('Error in /start:', err.message);
      await ctx.reply('ยินดีตอนรับ! กดปุ่มด้านล่างเพื่อเล่นเกมส์.',
        Markup.inlineKeyboard([
          [Markup.button.webApp('🎮 Open Game Catalog', WEBAPP_URL_VERSIONED)]
        ])
      );
    }
  });

  // /games command
  bot.command('games', async (ctx) => {
    await ctx.reply(
      '🎰 Choose a category or browse all games:',
      Markup.inlineKeyboard([
        [Markup.button.webApp('🎮 All Games', WEBAPP_URL_VERSIONED)],
        [
          Markup.button.webApp('🎰 Slots', `${WEBAPP_URL}?v=${APP_VERSION}&cat=slot`),
          Markup.button.webApp('🐟 Fishing', `${WEBAPP_URL}?v=${APP_VERSION}&cat=fishing`)
        ],
        [
          Markup.button.webApp('🃏 Table', `${WEBAPP_URL}?v=${APP_VERSION}&cat=tableandcard`),
          Markup.button.webApp('🔢 Bingo', `${WEBAPP_URL}?v=${APP_VERSION}&cat=bingo`)
        ],
        [Markup.button.webApp('🎲 Casino', `${WEBAPP_URL}?v=${APP_VERSION}&cat=casino`)]
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
  if (req.path === '/' || req.path === '/game.html' ||
      req.path.startsWith('/api/') || req.path.startsWith('/proxy/') ||
      req.path.startsWith('/play/') || req.path.startsWith('/jili/') ||
      req.path.startsWith('/pp-proxy/') ||
      req.path.startsWith('/catalog/') ||
      req.path.startsWith('/css/') || req.path.startsWith('/js/') ||
      req.path.startsWith('/images/')) {
    return next();
  }
  const ref = req.headers.referer || '';

  // Check if request originates from a PP proxied page
  const ppRefMatch = ref.match(/\/pp-proxy\/([a-zA-Z0-9.-]*pragmaticplay\.(?:net|com))/);
  if (ppRefMatch) {
    const ppDomain = ppRefMatch[1];
    console.log(`  [CATCH-ALL] ${req.url} → PP:${ppDomain}`);
    return res.redirect(307, '/pp-proxy/' + ppDomain + req.url);
  }

  // Default: JILI proxy
  const refMatch = ref.match(/\/jili\/([a-zA-Z0-9.-]*jiligames\.com)/);
  const targetDomain = refMatch ? refMatch[1] : 'jiligames.com';
  console.log(`  [CATCH-ALL] ${req.url} → ${targetDomain} (ref: ${ref.substring(ref.indexOf('/jili/'), ref.indexOf('/jili/') + 50) || 'none'})`);
  res.redirect(307, '/jili/' + targetDomain + req.url);
});

// ──────────────────────────────────────────────
// Start Express server
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Co168 Mini App Server`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   WebApp:  ${WEBAPP_URL}`);
  console.log(`   Bot:     ${bot ? 'Active' : 'Disabled (no BOT_TOKEN)'}`);
  console.log(`   JILI:    ${loadGames().length} games loaded`);
  console.log(`   PP:      ${loadPPGames().length} games loaded`);
  console.log(`   Joker:   ${loadJokerGames().length} games loaded\n`);
});
