#!/usr/bin/env node
// ──────────────────────────────────────────────
// JILI Games - Bot Setup Script
// Run once to configure the Telegram bot
// ──────────────────────────────────────────────

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ BOT_TOKEN is not set in .env file');
  process.exit(1);
}

if (!WEBAPP_URL || WEBAPP_URL === 'https://your-domain.com') {
  console.error('❌ WEBAPP_URL is not set in .env file');
  console.error('   For local testing, use ngrok: npx ngrok http 3000');
  process.exit(1);
}

async function setup() {
  const bot = new Telegraf(BOT_TOKEN);

  console.log('🤖 Setting up JILI Games Bot...\n');

  try {
    // 1. Set bot commands
    console.log('📋 Setting bot commands...');
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot and open game catalog' },
      { command: 'games', description: 'Choose game provider (JILI, PP, Joker)' },
      { command: 'help', description: 'How to use this bot' }
    ]);
    console.log('   ✅ Commands set\n');

    // 2. Set default menu button (Web App)
    console.log('🎮 Setting menu button...');
    await bot.telegram.setChatMenuButton({
      menuButton: {
        type: 'web_app',
        text: 'Play Games',
        web_app: { url: WEBAPP_URL }
      }
    });
    console.log(`   ✅ Menu button set → ${WEBAPP_URL}\n`);

    // 3. Get bot info
    const botInfo = await bot.telegram.getMe();
    console.log('ℹ️  Bot Info:');
    console.log(`   Name:     ${botInfo.first_name}`);
    console.log(`   Username: @${botInfo.username}`);
    console.log(`   ID:       ${botInfo.id}`);
    console.log(`   WebApp:   ${WEBAPP_URL}`);

    console.log('\n✨ Setup complete!');
    console.log(`\n🔗 Open your bot: https://t.me/${botInfo.username}`);

  } catch (err) {
    console.error('\n❌ Setup failed:', err.message);
    if (err.message.includes('Unauthorized')) {
      console.error('   Check your BOT_TOKEN in .env');
    }
    process.exit(1);
  }
}

setup();
