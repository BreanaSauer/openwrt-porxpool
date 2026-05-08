#!/bin/sh
set -eu

/etc/init.d/proxy-pool stop 2>/dev/null || true
/etc/init.d/proxy-pool disable 2>/dev/null || true
rm -f /etc/init.d/proxy-pool

echo "Removed service entry."
echo "Data is preserved under /opt/proxy-pool and /overlay/share/IP.txt."
echo "Delete them manually if you really want to remove all data."
