#!/bin/sh
set -eu

/etc/init.d/proxy-pool stop 2>/dev/null || true
/etc/init.d/proxy-pool disable 2>/dev/null || true
rm -f /etc/init.d/proxy-pool
rm -f /usr/bin/proxy-pool-ctl
rm -f /usr/share/luci/menu.d/luci-app-proxy-pool.json
rm -f /usr/share/rpcd/acl.d/luci-app-proxy-pool.json
rm -rf /www/luci-static/resources/view/proxy-pool

echo "Removed service entry."
echo "Data is preserved under /opt/proxy-pool and /overlay/share/IP.txt."
echo "Delete them manually if you really want to remove all data."
