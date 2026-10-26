#!/usr/bin/env sh
# Start the Adventure Generator on Linux or macOS: install, build, run, open the browser.
# Usage: ./start.sh   (or: sh start.sh)
set -eu
cd "$(dirname "$0")"

PORT="${PORT:-7880}"
URL="http://localhost:$PORT"
HEALTH="http://127.0.0.1:$PORT/api/health"
PNPM="npx --yes pnpm@12.15.0"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 24 or newer from https://nodejs.org and run this again."
  exit 1
fi

open_browser() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$URL" || true
  fi
}

answers() {
  node -e "fetch(process.argv[1], { signal: AbortSignal.timeout(2000) }).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))" "$HEALTH"
}

if answers; then
  echo "Adventure Generator is already running: $URL"
  open_browser
  exit 0
fi

# Quick when nothing changed; picks up new dependencies after an update.
echo "Installing dependencies..."
$PNPM install
echo "Building the web app..."
$PNPM build

# Open the browser once the server answers.
(
  i=0
  while [ $i -lt 60 ]; do
    if answers; then open_browser; break; fi
    i=$((i + 1))
    sleep 1
  done
) &

echo
echo "Adventure Generator: $URL"
echo "Press Ctrl+C to stop it."
echo
exec $PNPM start
