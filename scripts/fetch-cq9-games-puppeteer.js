#!/usr/bin/env node
// ──────────────────────────────────────────────
// Fetch CQ9 game list by loading demo.cqgame.games/en/Home in a browser.
// The site loads games via client-side JS, so we use Puppeteer to get the list.
// Run: node scripts/fetch-cq9-games-puppeteer.js (requires network + Chromium)
// If Chrome not found: npx puppeteer browsers install chrome
// Writes data/cq9-games.json; server uses this over cq9-seed-games.json.
// ──────────────────────────────────────────────

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const HOME_URL = 'https://demo.cqgame.games/en/Home';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'cq9-games.json');

async function main() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0');
    await page.setViewport({ width: 1280, height: 800 });
    console.log('Loading', HOME_URL, '...');
    await page.goto(HOME_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for game links or cards to appear (site may use different selectors)
    await new Promise(r => setTimeout(r, 3000));

    const games = await page.evaluate(() => {
      const result = [];
      const seen = new Set();
      const links = document.querySelectorAll('a[href*="game_id="], a[href*="Detail?"], [data-game-id]');
      links.forEach(a => {
        const href = a.href || a.getAttribute('href') || '';
        const match = href.match(/game_id=(\d+)/);
        const id = match ? match[1] : (a.getAttribute('data-game-id') || '').trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          const name = (a.querySelector('[class*="name"], [class*="title"], .game-name') || a).textContent?.trim() || `Game ${id}`;
          result.push({ game_id: parseInt(id, 10), name, category: 'Slot', image: '' });
        }
      });
      if (result.length > 0) return result;
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(a => {
        const href = a.href || '';
        const m = href.match(/game_id=(\d+)/);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          result.push({
            game_id: parseInt(m[1], 10),
            name: a.textContent?.trim() || `Game ${m[1]}`,
            category: 'Slot',
            image: ''
          });
        }
      });
      return result;
    });

    if (games.length === 0) {
      const html = await page.content();
      const idRegex = /game_id=(\d+)/g;
      const ids = [];
      let m;
      while ((m = idRegex.exec(html)) !== null) ids.push(m[1]);
      const unique = [...new Set(ids)];
      unique.forEach(id => {
        games.push({
          game_id: parseInt(id, 10),
          name: `Game ${id}`,
          category: 'Slot',
          image: ''
        });
      });
    }

    await browser.close();

    if (games.length === 0) {
      console.error('No games found. The page structure may have changed.');
      process.exit(1);
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(games, null, 2), 'utf-8');
    console.log('Wrote', games.length, 'games to', OUT_FILE);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
