#!/usr/bin/env bash
# The kitchen page in its own Chrome window for the demo. The flags make sound play without a tap (Coldex's
# voice and the courier call, also after a reload) and grant the mic without a prompt, so nothing in the demo
# depends on someone having tapped the page first. Uses its own profile, so the everyday Chrome is untouched.
set -euo pipefail
URL="${1:-http://localhost:5174/?wake}"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.cache/coldex-kitchen-chrome" \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --no-first-run --no-default-browser-check \
  --new-window "$URL"
