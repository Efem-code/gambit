#!/usr/bin/env bash
# Put Gambit on the phone over USB.
#
# Two tricks are doing the work here.
#
# 1. `adb reverse` makes the Mac's server reachable from the phone on
#    localhost. Browsers treat loopback as a secure origin even over plain
#    http, which is what lets the service worker register and the "Install
#    app" option appear. A LAN address like http://192.168.1.20 is not a
#    secure origin, so there would be no offline mode and no install.
#
# 2. The URL is http://gambit.localhost:8778, not http://localhost:8778.
#    Chromium resolves any *.localhost name to loopback and still treats it as
#    secure, and this matters more than it looks: an installed web app claims
#    its whole host on Android, with no regard for the port. Anvil, installed
#    from plain localhost, registered itself for http://localhost on *every*
#    port — so opening any other localhost app produced an "Open with Anvil?"
#    chooser instead of the app you wanted. Giving each app its own hostname
#    keeps them from fighting over the loopback address.
#
# Once installed, the app caches itself and runs with the cable unplugged and
# the phone in aeroplane mode. Re-run this only to push an update.
set -euo pipefail
cd "$(dirname "$0")"

PORT=8778
HOSTNAME=gambit.localhost
APP=Gambit

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  %s\033[0m\n' "$*"; }

command -v adb >/dev/null || { warn "adb not found. Install it with: brew install android-platform-tools"; exit 1; }

say "1. Finding the phone"
DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [ -z "$DEVICES" ]; then
  warn "No device. Check that:"
  note "  - the cable is plugged in and is a data cable, not charge-only"
  note "  - Developer options -> USB debugging is on"
  note "  - the 'Allow USB debugging?' prompt on the phone has been accepted"
  adb devices
  exit 1
fi
note "$(echo "$DEVICES" | head -1)"

say "2. Forwarding port $PORT to the phone"
adb reverse --remove tcp:$PORT >/dev/null 2>&1 || true
adb reverse tcp:$PORT tcp:$PORT
note "the phone's http://$HOSTNAME:$PORT now reaches this folder"

say "3. Stamping this build"
# The browser only installs a new service worker if sw.js actually differs.
# Without this the phone keeps serving the version it first cached and every
# change you make appears to do nothing.
STAMP="$(date +%Y%m%d-%H%M%S)"
sed -i '' "s/^const BUILD = '.*';/const BUILD = '$STAMP';/" sw.js
note "build $STAMP"

say "4. Serving"
lsof -ti tcp:$PORT 2>/dev/null | xargs kill 2>/dev/null || true
python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1
curl -sf "http://127.0.0.1:$PORT/manifest.webmanifest" >/dev/null || { warn "server did not start"; exit 1; }
note "serving $(pwd)"

say "5. Opening on the phone"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb shell am start -a android.intent.action.VIEW -d "http://$HOSTNAME:$PORT/" >/dev/null 2>&1 \
  && note "opened in the phone's browser" \
  || warn "could not launch the browser — open http://$HOSTNAME:$PORT yourself"

cat <<EOF

  On the phone: the app shows an **Install** button along the bottom.
  Tap it. If it does not appear, use the browser's own menu (⋮):
    Add to Home screen   (Brave)
    Install app          (Chrome)

  Once installed, later runs of this script update it automatically — open
  the app while this is running and it reloads itself on the new build.

  $APP then has its own icon, launches without a browser bar, and works with
  no signal at all. You can unplug once it has loaded once.

  Leave this running while you install. Ctrl-C when done.

EOF
wait $SERVER
