#!/usr/bin/env node
// ──────────────────────────────────────────────
// Pragmatic Play Games Scraper - Puppeteer
// Scrapes game list from pragmaticplay.com/en/games/
// ──────────────────────────────────────────────

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const GAMES_URL = 'https://www.pragmaticplay.com/en/games/';
const OUTPUT_PATH = path.join(__dirname, 'data', 'pp-games.json');
const SEED_PATH = path.join(__dirname, 'data', 'pp-seed-games.json');

async function scrapeGames() {
  console.log('🔍 Starting Pragmatic Play scraper...\n');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--ignore-certificate-errors'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`📡 Navigating to ${GAMES_URL}...`);
    await page.goto(GAMES_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // Accept age verification if present
    const ageBtn = await page.$('.age-check__button--accept, button:has-text("Yes")');
    if (ageBtn) {
      await ageBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Click "Load More Games" until all games are loaded
    console.log('📜 Loading all games (clicking Load More)...');
    let clickCount = 0;
    while (true) {
      const loadMoreBtn = await page.$('.js-load-more-games-btn, .load-more-games-btn');
      if (!loadMoreBtn) break;

      const isVisible = await page.evaluate(btn => {
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && style.visibility !== 'hidden' && btn.offsetParent !== null;
      }, loadMoreBtn);

      if (!isVisible) break;

      await loadMoreBtn.click();
      clickCount++;
      console.log(`   Loaded page ${clickCount + 1}...`);
      await new Promise(r => setTimeout(r, 2000));

      if (clickCount > 100) {
        console.log('   Max pages reached, stopping.');
        break;
      }
    }

    console.log(`   Clicked Load More ${clickCount} times\n`);

    // Extract game data from the page
    console.log('🎯 Extracting game data...');
    const games = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      const gameCards = document.querySelectorAll('#js-games-list .game, .games-list .game');

      gameCards.forEach(card => {
        const link = card.querySelector('a.game__thumbnail, a[href*="/en/games/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const slugMatch = href.match(/\/en\/games\/([a-z0-9-]+)\//);
        if (!slugMatch) return;

        const slug = slugMatch[1];
        if (seen.has(slug) || slug === 'page') return;
        seen.add(slug);

        const name = link.getAttribute('title') ||
          card.querySelector('.game__title, .game__name, h3, h4')?.textContent?.trim() ||
          slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        let image = '';
        const img = card.querySelector('img.game__image');
        if (img) {
          image = img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
          if (image.includes("data:image/svg")) image = '';
        }

        const studio = card.getAttribute('data-studio') || 'pragmatic_play';

        results.push({ slug, name, category: 'Slot', image, studio });
      });

      return results;
    });

    console.log(`✅ Found ${games.length} games\n`);

    // Save
    const dataDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(games, null, 2));
    console.log(`💾 Saved ${games.length} games to ${OUTPUT_PATH}`);

    await browser.close();
    return games;

  } catch (err) {
    console.error('\n❌ Scraping failed:', err.message);
    if (browser) await browser.close();

    console.log('\n🔄 Falling back to seed data...');
    if (fs.existsSync(SEED_PATH)) {
      const seedData = JSON.parse(fs.readFileSync(SEED_PATH, 'utf-8'));
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(seedData, null, 2));
      console.log(`💾 Copied ${seedData.length} seed games to ${OUTPUT_PATH}`);
      return seedData;
    }

    throw err;
  }
}

if (require.main === module) {
  scrapeGames()
    .then(games => {
      console.log(`\n✨ Done! ${games.length} Pragmatic Play games ready.`);
      process.exit(0);
    })
    .catch(err => {
      console.error('\n💥 Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { scrapeGames };
