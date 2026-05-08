# sing-box-gateway

Lightweight proxy pool gateway for OpenWrt/KWRT.

It lets phones use one stable proxy endpoint, while the router assigns each phone to an upstream SOCKS5 proxy and keeps the binding by MAC address.

```text
Phone proxy setting: 192.168.31.2:10000

phone MAC -> current DHCP IP -> sing-box source_ip rule -> upstream SOCKS5 proxy
```

Python is only the control plane. `sing-box` handles all real traffic.

## Features

- One proxy endpoint for all phones.
- Reads upstream proxies from `IP.txt`.
- Ignores expired proxies.
- Health-checks SOCKS5 proxies with username/password auth.
- Reads dnsmasq DHCP leases to map phone IP to MAC.
- Keeps persistent `MAC -> upstream proxy` bindings.
- Limits devices per upstream proxy, default `3`.
- Generates sing-box config using `source_ip_cidr` rules.
- Local control API and LuCI panel for runtime control.
- Does not modify OpenClash, DHCP, Wi-Fi, Samba, or default routing.

## OpenWrt/KWRT Layout

```text
/opt/proxy-pool/proxy_poold.py
/opt/proxy-pool/proxy_pool_ctl.py
/opt/proxy-pool/config.json
/opt/proxy-pool/bindings.json
/opt/proxy-pool/state.json
/opt/proxy-pool/sing-box.json
/overlay/share/IP.txt
```

`/overlay/share/IP.txt` can also be edited through your existing Samba share:

```text
\\192.168.31.2\share\IP.txt
```

## IP.txt Format

One proxy per line:

```text
ip|port|username|password|expire_date
```

Example:

```text
121.41.78.38|9125|user|pass|2026-06-01
```

Blank lines and lines starting with `#` are ignored.

## Install on OpenWrt/KWRT

Copy this repository folder to the router, then run:

```sh
opkg update
opkg install python3 sing-box

sh install-openwrt.sh
/etc/init.d/proxy-pool enable
/etc/init.d/proxy-pool start
```

Check status:

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

The status output includes `advertised_proxy`, for example:

```text
192.168.31.2:10000
```

That is what phones should use as their manual HTTP proxy.

## Settings

Settings live in:

```text
/opt/proxy-pool/config.json
```

Important fields:

```json
{
  "enabled": true,
  "listen_addr": "0.0.0.0",
  "listen_port": 10000,
  "max_devices_per_proxy": 3,
  "ip_file": "/overlay/share/IP.txt",
  "lan_interface": "br-lan",
  "advertised_host": "",
  "preferred_lan_prefix": "192.168.31."
}
```

`listen_addr` defaults to `0.0.0.0` so phones on LAN can connect. The panel/status display should show the router LAN IP plus `listen_port`, such as `192.168.31.2:10000`.
If your router has multiple LAN addresses, set `advertised_host` to the address phones should use.

Change settings through the local API helper:

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py set listen_port=10000 max_devices_per_proxy=3
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

## Control API

The daemon listens on localhost by default:

```text
127.0.0.1:18080
```

Endpoints:

```text
GET  /status
GET  /settings
POST /settings
POST /enable
POST /disable
POST /reload
POST /iptxt
```

A LuCI panel can call these endpoints to implement:

- Enable/disable switch.
- Proxy endpoint port setting.
- Upload/replace `IP.txt`.
- View alive proxies.
- View phone bindings.
- Manual reload.

## LuCI Panel

The installer adds a LuCI entry:

```text
Services -> Proxy Pool
```

The panel can enable or disable forwarding, edit the endpoint port, upload or replace `IP.txt`, parse imported proxy lines into a management table, delete unwanted proxy lines before saving, reload the pool, and view daemon status, sing-box forwarding status, alive proxies, phone bindings, and IP file line counts.

`Stopped` in the panel does not always mean the daemon failed. If `Daemon` is online but the forwarding engine is stopped with `no alive proxies`, the service is waiting for valid upstream proxies in `IP.txt`.

If the menu is not visible after installation, restart rpcd:

```sh
/etc/init.d/rpcd restart
```

## Uninstall

```sh
sh uninstall-openwrt.sh
```

The uninstall script removes the service entry but preserves data under `/opt/proxy-pool` and `/overlay/share/IP.txt`.
