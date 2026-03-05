#!/usr/bin/env node
// ──────────────────────────────────────────────
// Fetch real CQ9 game names by opening each Detail page and reading the title/heading.
// Run: node scripts/fetch-cq9-names-puppeteer.js (requires Puppeteer + Chrome)
// Reads data/cq9-seed-games.json, writes data/cq9-games.json with updated names.
// ──────────────────────────────────────────────

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SEED_FILE = path.join(DATA_DIR, 'cq9-seed-games.json');
const OUT_FILE = path.join(DATA_DIR, 'cq9-games.json');
const DELAY_MS = 800;

function loadSeed() {
  const raw = fs.readFileSync(SEED_FILE, 'utf-8');
  return JSON.parse(raw);
}

async function getNameFromDetail(page, gameId) {
  const url = `https://demo.cqgame.games/en/Game/Detail?game_id=${gameId}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    const name = await page.evaluate(() => {
      const sel = 'h1, [class*="game-name"], [class*="gameName"], [class*="title"], .game-title, [class*="GameName"]';
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const t = el.textContent.trim();
        if (t && t.length < 100 && !/^CQ9|^Return|^Normal|^Themed|^DEMO$/i.test(t)) return t;
      }
      const all = document.body.innerText || '';
      const lines = all.split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.length < 80);
      for (const line of lines) {
        if (!/^(CQ9|Return|Normal|Themed|DEMO|Volatility|Maximum|RTP|©|Link|Contact|[\d]+)$/i.test(line))
          return line;
      }
      return null;
    });
    return name || `Game ${gameId}`;
  } catch (e) {
    return `Game ${gameId}`;
  }
}

async function main() {
  const games = loadSeed();
  if (!Array.isArray(games) || games.length === 0) {
    console.error('No games in seed');
    process.exit(1);
  }
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0');
  await page.setViewport({ width: 1280, height: 800 });
  console.log('Fetching names for', games.length, 'games...');
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const id = g.game_id;
    process.stdout.write(`  [${i + 1}/${games.length}] game_id=${id} ... `);
    const name = await getNameFromDetail(page, id);
    g.name = name;
    console.log(name);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  await browser.close();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(games, null, 2), 'utf-8');
  console.log('Wrote', OUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
