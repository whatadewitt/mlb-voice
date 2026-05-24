#!/usr/bin/env bash
# One-keystroke demo: boots the TTS server, kicks HLS, runs a named scenario,
# leaves the server running afterward so you can listen on http://localhost:5025/.
#
# Usage: ./scripts/demo.sh standard|homer|ads
#   Env: TTS_BACKEND=stub|openai|dia2 (default: dia2)
set -euo pipefail

SCEN="${1:-}"
case "$SCEN" in
  standard) FILE="scenarios/standard_game.yaml" ;;
  homer)    FILE="scenarios/go_ahead_homer.yaml" ;;
  ads)      FILE="scenarios/inning_break_into_ads.yaml" ;;
  *) echo "usage: $0 standard|homer|ads"; exit 1 ;;
esac

rm -f queue/*.wav hls/*.ts hls/playlist.m3u8 || true
echo "-> Starting TTS server (backend=${TTS_BACKEND:-dia2})..."
${TTS_BACKEND:+TTS_BACKEND=$TTS_BACKEND} uv run python server.py &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

for i in {1..30}; do
  if curl -sf http://localhost:5025/health >/dev/null; then break; fi
  sleep 1
done

curl -s -X POST http://localhost:5025/start_hls
echo
echo "-> Running scenario: $SCEN ($FILE)"
node src/scenarios/run.js "$FILE"
echo "-> Scenario complete. Server still running; Ctrl-C to stop."
wait $SERVER_PID
