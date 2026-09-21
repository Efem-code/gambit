#!/usr/bin/env bash
# Publish gambit to GitHub Pages.
#
# Every deploy stamps a new BUILD into sw.js. That stamp is the only thing that
# makes an update actually reach an installed phone: the browser compares the
# service worker byte for byte, and an identical file means it keeps serving the
# version it already cached.
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

say "1. Stamping this build"
STAMP="$(date +%Y%m%d-%H%M%S)"
sed -i '' "s/^const BUILD = '.*';/const BUILD = '$STAMP';/" sw.js
note "build $STAMP"

say "2. Pushing"
git add -A
if git diff --cached --quiet; then
  note "nothing changed"
else
  git commit -qm "Deploy $STAMP"
  note "committed"
fi
git push -q origin main
note "pushed"

URL="$(gh api repos/Efem-code/gambit/pages --jq .html_url 2>/dev/null || true)"
say "3. Live"
note "${URL:-https://efem-code.github.io/gambit/}"
note "GitHub takes a minute or two to rebuild."
note "Open it on the phone; the app reloads itself onto the new build."
