#!/usr/bin/env bash
# go2rtc for the stage inset: the Reolink cameras with their mic, played by go2rtc's own player in MSE mode
# (the mic is AAC, which WebRTC can't carry). The app proxies it at /go2rtc, so the stage gets it through
# the tunnel too: /stage?kitchen=reolink (camera 0) or reolink1 (camera 1).
#
#   infra/go2rtc.sh          the hub's streams from infra/go2rtc.yaml, API and player on :1984
#   infra/go2rtc.sh --test   HACK(demo): an ffmpeg test pattern with a tone as both cameras, no hub needed
#
# No Docker: the standalone binary from the official GitHub release, fetched once into ~/.local/opt/go2rtc
# (or set GO2RTC_BIN). REOLINK_HOST, REOLINK_USER and REOLINK_PASSWORD come from bridge/.env.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
version=v1.9.15
bin="${GO2RTC_BIN:-$HOME/.local/opt/go2rtc/go2rtc}"

if [ ! -x "$bin" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) asset=go2rtc_linux_amd64 ;;
    Linux-aarch64) asset=go2rtc_linux_arm64 ;;
    Darwin-arm64) asset=go2rtc_mac_arm64.zip ;;
    Darwin-x86_64) asset=go2rtc_mac_amd64.zip ;;
    *) echo "No go2rtc build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
  esac
  mkdir -p "$(dirname "$bin")"
  url="https://github.com/AlexxIT/go2rtc/releases/download/$version/$asset"
  if [[ $asset == *.zip ]]; then
    curl -fsSL "$url" -o "$(dirname "$bin")/go2rtc.zip" && unzip -o -q "$(dirname "$bin")/go2rtc.zip" -d "$(dirname "$bin")"
  else
    curl -fsSL "$url" -o "$bin"
  fi
  chmod +x "$bin"
fi

while IFS='=' read -r key value; do
  case "$key" in
    REOLINK_HOST | REOLINK_USER | REOLINK_PASSWORD) value="${value%\"}"; export "$key=${value#\"}" ;;
  esac
done < "$here/../bridge/.env"

config="$here/go2rtc.yaml"
[ "${1:-}" = "--test" ] && config="$here/go2rtc.test.yaml"
exec "$bin" -config "$config"
