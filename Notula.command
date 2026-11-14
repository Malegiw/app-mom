#!/bin/zsh
# Double-click this file in Finder to start Notula on this Mac.
# It builds the app, starts the engine, and opens the browser. Close this window to stop Notula.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
if [ ! -d node_modules ]; then
  echo "Memasang kebutuhan Notula (sekali saja)..."
  npm install || exit 1
fi
npm run build || exit 1
(sleep 2 && open "http://localhost:8787") &
node engine/server.mjs "$@"
