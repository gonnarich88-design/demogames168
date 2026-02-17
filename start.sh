#!/bin/bash
# ──────────────────────────────────────────────
# JILI Games Mini App - Quick Start
# Run this whenever you need to restart
# ──────────────────────────────────────────────

BOT_TOKEN="8118107198:AAHjV9vuAFaqdd5f5JHIC3w3xwzjF_EqYKU"
NODE_BIN="$HOME/.local/node/bin/node"
APP_DIR="$HOME/works/miniapp"
CURL_BIN="/usr/bin/curl"
WEBAPP_URL="https://demogames.sky168.info"

echo ""
echo "🎮 JILI Games Mini App - Starting..."
echo "────────────────────────────────────"

# Step 1: Kill existing processes
echo "🔄 Cleaning up..."
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

# Step 2: Update bot menu button
$CURL_BIN -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🎮 Play Games\",\"web_app\":{\"url\":\"$WEBAPP_URL\"}}}" > /dev/null
echo "✅ Bot menu updated"

# Step 3: Start Express server
cd "$APP_DIR"
NODE_TLS_REJECT_UNAUTHORIZED=0 $NODE_BIN "$APP_DIR/server.js" > /tmp/miniapp.log 2>&1 &
SERVER_PID=$!
sleep 3
echo "✅ Server started (PID: $SERVER_PID)"

echo ""
echo "════════════════════════════════════"
echo "  🎮 READY! URL: $WEBAPP_URL"
echo "  Server PID: $SERVER_PID"
echo "════════════════════════════════════"
echo ""
echo "If server dies, just run: ./start.sh"
