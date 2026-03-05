#!/usr/bin/env node
// ──────────────────────────────────────────────
// Fetch CQ9 game list from demo.cqgame.games/en/Home
// Writes data/cq9-games.json so the mini-app shows all games from the demo site.
// Run: node scripts/fetch-cq9-games.js (requires network)
// If no games are found (client-rendered list), run instead:
//   npx puppeteer browsers install chrome
//   node scripts/fetch-cq9-games-puppeteer.js
// ──────────────────────────────────────────────

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'https://demo.cqgame.games/en/Home';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'cq9-games.json');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0',
        'Accept': 'text/html,application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body: Buffer.concat(chunks).toString('utf-8')
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function parseCQ9GamesFromBody(body) {
  const games = [];
  const seen = new Set();

  function add(id, name, category) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0 || seen.has(n)) return;
    seen.add(n);
    games.push({
      game_id: n,
      name: name || `Game ${n}`,
      category: category || 'Slot',
      image: ''
    });
  }

  try {
    const nextDataMatch = body.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      const data = JSON.parse(nextDataMatch[1]);
      const props = data.props && data.props.pageProps;
      const list = props && (props.games || props.gameList || props.list || props.initialGames);
      if (Array.isArray(list)) {
        list.forEach(g => {
          const id = g.game_id ?? g.gameId ?? g.id;
          if (id != null) add(id, g.name ?? g.gameName ?? g.title, g.category ?? g.type);
        });
        if (games.length > 0) return games;
      }
      const page = data.props && data.props.pageProps;
      if (page && typeof page === 'object') {
        const walk = (o) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) return o.forEach(walk);
          if (o.game_id != null || o.gameId != null) {
            add(o.game_id ?? o.gameId, o.name ?? o.gameName ?? o.title, o.category ?? o.type);
            return;
          }
          Object.values(o).forEach(walk);
        };
        walk(page);
        if (games.length > 0) return games;
      }
    }
  } catch (e) {
    // fall back to regex
  }

  const idRegex = /(?:game_id|gameId)["\s:=]+(\d+)/gi;
  let m;
  while ((m = idRegex.exec(body)) !== null) add(m[1]);
  const linkRegex = /Detail\?game_id=(\d+)/g;
  while ((m = linkRegex.exec(body)) !== null) add(m[1]);

  return games;
}

async function main() {
  console.log('Fetching', HOME_URL, '...');
  const resp = await fetch(HOME_URL);
  if (resp.statusCode !== 200) {
    console.error('HTTP', resp.statusCode);
    process.exit(1);
  }
  const games = parseCQ9GamesFromBody(resp.body);
  if (games.length === 0) {
    console.error('No games found in page. The demo site may load games via client-side API.');
    console.error('You can still add games manually to data/cq9-seed-games.json (game_id, name, category).');
    process.exit(1);
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(games, null, 2), 'utf-8');
  console.log('Wrote', games.length, 'games to', OUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
