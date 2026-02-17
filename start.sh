#!/bin/bash
# ──────────────────────────────────────────────
# JILI Games Mini App - Quick Start
# Run this whenever you need to restart
# ──────────────────────────────────────────────

BOT_TOKEN="8118107198:AAHjV9vuAFaqdd5f5JHIC3w3xwzjF_EqYKU"
NODE_BIN="$HOME/.local/node/bin/node"
CLOUDFLARED_BIN="$HOME/.local/node/bin/cloudflared"
APP_DIR="$HOME/works/miniapp"
CURL_BIN="/usr/bin/curl"

echo ""
echo "🎮 JILI Games Mini App - Starting..."
echo "────────────────────────────────────"

# Step 1: Kill existing processes
echo "🔄 Cleaning up..."
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -f cloudflared 2>/dev/null || true
sleep 2

# Step 2: Start cloudflared tunnel
echo "🌐 Starting Cloudflare tunnel..."
rm -f /tmp/cloudflared.log
$CLOUDFLARED_BIN tunnel --url http://localhost:3000 > /tmp/cloudflared.log 2>&1 &
CF_PID=$!

# Wait for tunnel URL
TUNNEL_URL=""
for i in $(seq 1 20); do
  TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | head -1)
  [ -n "$TUNNEL_URL" ] && break
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ Failed to get tunnel URL!"
  kill $CF_PID 2>/dev/null
  exit 1
fi
echo "✅ Tunnel: $TUNNEL_URL"

# Step 3: Update .env
cd "$APP_DIR"
sed -i '' "s|WEBAPP_URL=.*|WEBAPP_URL=$TUNNEL_URL|" .env
echo "✅ Updated .env"

# Step 4: Update bot menu button
$CURL_BIN -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"🎮 Play Games\",\"web_app\":{\"url\":\"$TUNNEL_URL\"}}}" > /dev/null
echo "✅ Bot menu updated"

# Step 5: Start Express server
NODE_TLS_REJECT_UNAUTHORIZED=0 $NODE_BIN "$APP_DIR/server.js" > /tmp/miniapp.log 2>&1 &
SERVER_PID=$!
sleep 3
echo "✅ Server started (PID: $SERVER_PID)"

echo ""
echo "════════════════════════════════════"
echo "  🎮 READY! URL: $TUNNEL_URL"
echo "  Tunnel PID: $CF_PID"
echo "  Server PID: $SERVER_PID"
echo "════════════════════════════════════"
echo ""
echo "If tunnel dies, just run: ./start.sh"
