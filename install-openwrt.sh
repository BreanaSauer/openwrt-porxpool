#!/bin/sh
set -eu

BASE="${BASE:-/opt/proxy-pool}"
SRC_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$BASE" /overlay/share

cp "$SRC_DIR/proxy_poold.py" "$BASE/proxy_poold.py"
cp "$SRC_DIR/proxy_pool_ctl.py" "$BASE/proxy_pool_ctl.py"
cp "$SRC_DIR/root/usr/bin/proxy-pool-ctl" /usr/bin/proxy-pool-ctl
chmod +x /usr/bin/proxy-pool-ctl

if [ ! -f "$BASE/config.json" ]; then
  cp "$SRC_DIR/proxy-pool.config.example.json" "$BASE/config.json"
fi

cp "$SRC_DIR/openwrt-proxy-pool.init" /etc/init.d/proxy-pool
chmod +x /etc/init.d/proxy-pool

mkdir -p /usr/share/luci/menu.d
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /www/luci-static/resources/view/proxy-pool
cp "$SRC_DIR/root/usr/share/luci/menu.d/luci-app-proxy-pool.json" /usr/share/luci/menu.d/luci-app-proxy-pool.json
cp "$SRC_DIR/root/usr/share/rpcd/acl.d/luci-app-proxy-pool.json" /usr/share/rpcd/acl.d/luci-app-proxy-pool.json
cp "$SRC_DIR/root/www/luci-static/resources/view/proxy-pool/main.js" /www/luci-static/resources/view/proxy-pool/main.js
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/rpcd restart 2>/dev/null || true

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
echo
echo "LuCI menu:"
echo "  Services -> Proxy Pool"
echo
echo "If the menu is not visible, run:"
echo "  /etc/init.d/rpcd restart"
