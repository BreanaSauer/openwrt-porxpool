#!/bin/sh
set -eu

BASE="${BASE:-/opt/proxy-pool}"
SRC_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$BASE" /overlay/share

cp "$SRC_DIR/proxy_poold.py" "$BASE/proxy_poold.py"
cp "$SRC_DIR/proxy_pool_ctl.py" "$BASE/proxy_pool_ctl.py"

if [ ! -f "$BASE/config.json" ]; then
  cp "$SRC_DIR/proxy-pool.config.example.json" "$BASE/config.json"
fi

cp "$SRC_DIR/openwrt-proxy-pool.init" /etc/init.d/proxy-pool
chmod +x /etc/init.d/proxy-pool

if [ ! -f /overlay/share/IP.txt ]; then
  touch /overlay/share/IP.txt
fi

echo "Installed to $BASE"
echo
echo "Install runtime packages if needed:"
echo "  opkg update"
echo "  opkg install python3 sing-box"
echo
echo "Start service:"
echo "  /etc/init.d/proxy-pool enable"
echo "  /etc/init.d/proxy-pool start"
echo
echo "Phone proxy endpoint will be shown in:"
echo "  python3 $BASE/proxy_pool_ctl.py status"
