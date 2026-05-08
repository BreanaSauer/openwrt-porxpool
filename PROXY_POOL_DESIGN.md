# Proxy Pool Daemon

This is the lightweight OpenWrt/KWRT design for the phone proxy pool.

## Goal

Phones use one stable proxy endpoint:

```text
192.168.31.2:10000
```

The daemon assigns phones to upstream SOCKS5 proxies by MAC address, then
generates sing-box rules by current DHCP source IP.

```text
phone MAC -> current DHCP IP -> sing-box source_ip rule -> upstream proxy
```

Python is only the control plane. sing-box handles all real traffic.

## Files

```text
/opt/proxy-pool/proxy_poold.py
/opt/proxy-pool/config.json
/opt/proxy-pool/bindings.json
/opt/proxy-pool/state.json
/opt/proxy-pool/sing-box.json
/overlay/share/IP.txt
```

## IP.txt Format

```text
ip|port|username|password|expire_date
```

Example:

```text
121.41.78.38|9125|user|pass|2026-06-01
```

Expired entries are ignored. Dead SOCKS5 entries are ignored after health check.

## Control API

The daemon listens only on localhost by default:

```text
127.0.0.1:18080
```

Endpoints:

```text
GET  /status
POST /enable
POST /disable
POST /reload
POST /iptxt      # raw text body replaces IP.txt
```

A LuCI panel can later call these endpoints for switch/upload/status actions.

## OpenWrt Install Sketch

```sh
mkdir -p /opt/proxy-pool
cp proxy_poold.py /opt/proxy-pool/
cp proxy-pool.config.example.json /opt/proxy-pool/config.json
cp openwrt-proxy-pool.init /etc/init.d/proxy-pool
chmod +x /etc/init.d/proxy-pool

opkg install python3 sing-box

/etc/init.d/proxy-pool enable
/etc/init.d/proxy-pool start
```

It does not change OpenClash, DHCP, Wi-Fi, Samba, or default routing.
