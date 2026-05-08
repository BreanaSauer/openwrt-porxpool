#!/bin/sh
set -eu

# OpenWrt/KWRT auto-update helper.
# Reads proxies from the Samba share path and starts sing-box only when usable
# non-expired proxies exist. Stop sing-box when IP.txt is empty, expired, or dead.

BASE="/etc/sing-box-gateway"
IP_FILE="/overlay/share/IP.txt"
CONFIG="/etc/sing-box/config.json"
PORT_MAP="/overlay/share/port-map.csv"
LISTEN_ADDR="0.0.0.0"
START_PORT="10001"

PYTHON="${PYTHON:-python3}"
GENERATOR="$BASE/generate_config.py"

if [ ! -f "$GENERATOR" ]; then
  echo "missing generator: $GENERATOR" >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG")"

set +e
"$PYTHON" "$GENERATOR" \
  --ip-file "$IP_FILE" \
  --output "$CONFIG" \
  --port-map "$PORT_MAP" \
  --listen "$LISTEN_ADDR" \
  --start-port "$START_PORT"
rc="$?"
set -e

if [ "$rc" = "0" ]; then
  echo "valid proxies found; restarting sing-box"
  if [ -x /etc/init.d/sing-box ]; then
    /etc/init.d/sing-box enable || true
    /etc/init.d/sing-box restart
  else
    killall sing-box 2>/dev/null || true
    nohup sing-box run -c "$CONFIG" >/tmp/sing-box-gateway.log 2>&1 &
  fi
  exit 0
fi

if [ "$rc" = "2" ] || [ "$rc" = "3" ]; then
  echo "no usable proxies; stopping sing-box"
  if [ -x /etc/init.d/sing-box ]; then
    /etc/init.d/sing-box stop || true
  else
    killall sing-box 2>/dev/null || true
  fi
  exit 0
fi

echo "generator failed with exit code $rc" >&2
exit "$rc"
