#!/usr/bin/env node
// Download Pragmatic Play game thumbnails from their website to local storage
// Fetches each game's page to find the real thumbnail image URL, then downloads it

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, 'data', 'pp-seed-games.json');
const IMG_DIR = path.join(__dirname, 'public', 'images', 'pp');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      agent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': '*/*',
      }
    };
    https.request(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGet(res.headers.location));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
}

async function findGameImage(slug) {
  const pageUrl = `https://www.pragmaticplay.com/en/games/${slug}/?gamelang=en&cur=USD`;
  try {
    const resp = await httpsGet(pageUrl);
    const html = resp.body.toString('utf-8');

    // Look for og:image (high-quality game image)
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                     html.match(/content="([^"]+)"\s+property="og:image"/i);
    if (ogMatch) return ogMatch[1];

    // Look for game__image in the HTML
    const imgMatch = html.match(/data-lazy-src="(https:\/\/www\.pragmaticplay\.com\/wp-content\/uploads\/[^"]+)"/i) ||
                     html.match(/class="game__image[^"]*"[^>]*src="(https:\/\/www\.pragmaticplay\.com\/wp-content\/uploads\/[^"]+)"/i);
    if (imgMatch) return imgMatch[1];

    return null;
  } catch (e) {
    console.log(`  Error fetching page for ${slug}: ${e.message}`);
    return null;
  }
}

async function downloadImage(url, dest) {
  const resp = await httpsGet(url);
  if (resp.statusCode !== 200) return false;
  fs.writeFileSync(dest, resp.body);
  return true;
}

async function main() {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  const games = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
  console.log(`Downloading images for ${games.length} PP games...\n`);

  let downloaded = 0, failed = 0;

  for (const game of games) {
    const ext = '.jpg';
    const localFile = path.join(IMG_DIR, game.slug + ext);
    const localUrl = `/images/pp/${game.slug}${ext}`;

    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1000) {
      console.log(`  SKIP ${game.slug} (already exists)`);
      game.image = localUrl;
      downloaded++;
      continue;
    }

    console.log(`  Fetching ${game.slug}...`);
    const imgUrl = await findGameImage(game.slug);
    if (!imgUrl) {
      console.log(`    No image found`);
      game.image = '';
      failed++;
      continue;
    }

    console.log(`    Found: ${imgUrl.substring(0, 80)}...`);
    try {
      const ok = await downloadImage(imgUrl, localFile);
      if (ok && fs.statSync(localFile).size > 1000) {
        console.log(`    OK (${(fs.statSync(localFile).size / 1024).toFixed(1)} KB)`);
        game.image = localUrl;
        downloaded++;
      } else {
        console.log(`    FAILED (bad response or tiny file)`);
        game.image = '';
        failed++;
      }
    } catch (e) {
      console.log(`    FAILED: ${e.message}`);
      game.image = '';
      failed++;
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 300));
  }

  // Save updated seed data with local paths
  fs.writeFileSync(SEED_PATH, JSON.stringify(games, null, 2));
  console.log(`\nDone! Downloaded: ${downloaded}, Failed: ${failed}`);
  console.log(`Updated ${SEED_PATH} with local image paths.`);
}

main().catch(e => { console.error(e); process.exit(1); });
