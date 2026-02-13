#!/usr/bin/env node
// ──────────────────────────────────────────────
// JILI Games Scraper - Puppeteer
// Scrapes game list from jiligames.com/games
// ──────────────────────────────────────────────

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const GAMES_URL = 'https://jiligames.com/games';
const OUTPUT_PATH = path.join(__dirname, 'data', 'games.json');
const SEED_PATH = path.join(__dirname, 'data', 'seed-games.json');

// Category mapping for the tabs on jiligames.com
const CATEGORIES = ['All', 'Slot', 'Fishing', 'Table and Card', 'Bingo', 'Casino'];

async function scrapeGames() {
  console.log('🔍 Starting JILI Games scraper...\n');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    console.log(`📡 Navigating to ${GAMES_URL}...`);
    await page.goto(GAMES_URL, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for game cards to appear
    console.log('⏳ Waiting for game cards to load...');
    await page.waitForSelector('img', { timeout: 15000 }).catch(() => {
      console.log('   Warning: Could not find img elements, continuing anyway...');
    });

    // Wait extra time for dynamic content
    await new Promise(r => setTimeout(r, 3000));

    // Scroll to load all games (in case of lazy loading)
    console.log('📜 Scrolling to load all content...');
    await autoScroll(page);

    // Extract game data from the page
    console.log('🎯 Extracting game data...');
    const games = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Find all links that match the PlusIntro pattern
      const links = document.querySelectorAll('a[href*="PlusIntro"]');

      links.forEach(link => {
        const href = link.getAttribute('href') || '';
        const match = href.match(/PlusIntro\/(\d+)/);
        if (!match) return;

        const id = parseInt(match[1]);
        if (seen.has(id)) return;
        seen.add(id);

        // Find the game name - look for text content near the link
        let name = '';
        const parent = link.closest('.game-card, .game-item, [class*="game"], [class*="card"]') || link.parentElement?.parentElement;
        if (parent) {
          // Try multiple selectors for game name
          const nameEl = parent.querySelector('[class*="name"], [class*="title"], h3, h4, p, span');
          if (nameEl) name = nameEl.textContent.trim();
        }

        // Fallback: get text directly from link or nearby elements
        if (!name) {
          name = link.textContent.trim() || link.getAttribute('title') || '';
          // Clean up name (remove "Play Now", "Game Info" etc.)
          name = name.replace(/Play\s*Now|Game\s*Info|DEMO|FREE/gi, '').trim();
        }

        if (!name) name = `Game ${id}`;

        // Find image
        let image = '';
        const imgInLink = link.querySelector('img');
        const imgInParent = parent?.querySelector('img');
        const img = imgInLink || imgInParent;
        if (img) {
          image = img.src || img.dataset?.src || img.getAttribute('data-lazy-src') || '';
        }

        // Determine category from page context
        let category = 'Slot'; // Default

        results.push({ id, name, category, image });
      });

      return results;
    });

    console.log(`✅ Found ${games.length} games from links\n`);

    // Try to determine categories by clicking each tab
    for (let i = 1; i < CATEGORIES.length; i++) {
      const cat = CATEGORIES[i];
      console.log(`📂 Checking category: ${cat}...`);

      try {
        // Click category tab
        const clicked = await page.evaluate((categoryName) => {
          const tabs = document.querySelectorAll('button, a, [role="tab"], [class*="tab"], [class*="filter"], [class*="category"]');
          for (const tab of tabs) {
            const text = tab.textContent.trim();
            if (text.toLowerCase().includes(categoryName.toLowerCase())) {
              tab.click();
              return true;
            }
          }
          return false;
        }, cat);

        if (clicked) {
          await new Promise(r => setTimeout(r, 2000));

          // Get game IDs visible in this category
          const categoryGameIds = await page.evaluate(() => {
            const ids = [];
            const links = document.querySelectorAll('a[href*="PlusIntro"]');
            links.forEach(link => {
              const href = link.getAttribute('href') || '';
              const match = href.match(/PlusIntro\/(\d+)/);
              if (match) {
                const el = link.closest('[style*="display: none"], [style*="visibility: hidden"], .hidden');
                if (!el) {
                  ids.push(parseInt(match[1]));
                }
              }
            });
            return [...new Set(ids)];
          });

          // Update category for these games
          categoryGameIds.forEach(id => {
            const game = games.find(g => g.id === id);
            if (game) game.category = cat;
          });

          console.log(`   Found ${categoryGameIds.length} games in ${cat}`);
        }
      } catch (err) {
        console.log(`   Warning: Could not check ${cat} category:`, err.message);
      }
    }

    // Clean up and save
    const cleanGames = games
      .filter(g => g.name && g.id)
      .map(g => ({
        id: g.id,
        name: g.name.substring(0, 100), // Limit name length
        category: g.category || 'Slot',
        image: g.image || ''
      }));

    // Sort by ID
    cleanGames.sort((a, b) => b.id - a.id);

    // Ensure data directory exists
    const dataDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Save to file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cleanGames, null, 2));
    console.log(`\n💾 Saved ${cleanGames.length} games to ${OUTPUT_PATH}`);

    // Print summary
    const categoryCount = {};
    cleanGames.forEach(g => {
      categoryCount[g.category] = (categoryCount[g.category] || 0) + 1;
    });
    console.log('\n📊 Category breakdown:');
    Object.entries(categoryCount).forEach(([cat, count]) => {
      console.log(`   ${cat}: ${count} games`);
    });

    await browser.close();
    return cleanGames;

  } catch (err) {
    console.error('\n❌ Scraping failed:', err.message);

    if (browser) await browser.close();

    // Fallback to seed data
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

// Auto-scroll helper
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight > 20000) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Run if called directly
if (require.main === module) {
  scrapeGames()
    .then(() => {
      console.log('\n✨ Scraping completed successfully!');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n💥 Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { scrapeGames };
