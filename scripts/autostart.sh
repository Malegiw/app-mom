#!/bin/zsh
# Makes the Notula engine start by itself whenever this Mac is logged in, and restart if it stops.
#   ./scripts/autostart.sh install     turn it on
#   ./scripts/autostart.sh remove      turn it off
#   ./scripts/autostart.sh status      show whether it is running
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="id.ymd.notula.engine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v node)"
LOGDIR="$HOME/Library/Logs/Notula"

case "${1:-status}" in
  install)
    (cd "$ROOT" && PATH="$(dirname "$NODE"):$PATH" npm run build)
    mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$ROOT/engine/server.mjs</string>
    <string>--lan</string>
    <string>--tailscale</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGDIR/engine.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/engine.log</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Mesin Notula akan menyala otomatis setiap kali Mac ini masuk. Log: $LOGDIR/engine.log"
    ;;
  remove)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Jalan otomatis dimatikan."
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid" || echo "Tidak berjalan otomatis."
    ;;
  *)
    echo "Pakai: $0 install | remove | status"; exit 1 ;;
esac
