#!/usr/bin/env bash
set -euo pipefail

BACKEND="${1:-dia2}"  # default to dia2 (zero-exceptions TTS policy); "openai"/"stub" as fallback

echo "→ Starting TTS server (backend=$BACKEND)..."
TTS_BACKEND="$BACKEND" uv run python server.py &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# Wait for server
for i in {1..30}; do
  if curl -sf http://localhost:5025/health >/dev/null; then break; fi
  sleep 1
done

echo "→ Starting HLS..."
curl -s -X POST http://localhost:5025/start_hls

echo "→ Driving 2025 game.js with the SDatTOR sample..."
GAME=SDatTOR VOICE_URL=http://localhost:5025/generate node game.js

echo "→ Done. Open http://localhost:5025/ in a browser to listen."
echo "→ Server PID $SERVER_PID still running; Ctrl-C to stop."
wait $SERVER_PID
