#!/usr/bin/env node
/**
 * Joker Gaming game list scraper.
 * Fetches the game list from joker123.net API and writes to data/joker-games.json
 *
 * Usage: node scraper-joker.js
 */

const https = require('https');
const fs   = require('fs');
const path = require('path');

const API_URL  = 'https://www.joker123.net/Service/GetListGames';
const OUT_FILE = path.join(__dirname, 'data', 'joker-games.json');
const SEED     = path.join(__dirname, 'data', 'joker-seed-games.json');

function httpsGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      agent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.joker123.net/GameIndex',
        'Origin': 'https://www.joker123.net',
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
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function main() {
  console.log('[JOKER-SCRAPER] Fetching game list from', API_URL);
  try {
    const resp = await httpsGet(API_URL);
    if (resp.statusCode !== 200) throw new Error(`HTTP ${resp.statusCode}`);

    const data = JSON.parse(resp.body);
    if (!data.Success) throw new Error('API returned Success=false');

    const games = data.Data.Games
      .filter(g => !g.IsExtend && g.FreePlay && g.Enabled && g.IsShow)
      .map(g => ({
        code:        g.Code,
        name:        g.Name,
        category:    g.GameCategoryCode || 'Slot',
        image:       g.ImageUrl || '',
        isNew:       g.IsNew || false,
        isHot:       g.IsHot || false,
        isRecommend: g.IsRecommend || false,
      }));

    fs.writeFileSync(OUT_FILE, JSON.stringify(games, null, 2));
    console.log(`[JOKER-SCRAPER] Wrote ${games.length} games to ${OUT_FILE}`);
  } catch (err) {
    console.error('[JOKER-SCRAPER] Error:', err.message);
    console.log('[JOKER-SCRAPER] Falling back to seed file');
    if (fs.existsSync(SEED) && !fs.existsSync(OUT_FILE)) {
      fs.copyFileSync(SEED, OUT_FILE);
      console.log('[JOKER-SCRAPER] Copied seed → games file');
    }
  }
}

main();
