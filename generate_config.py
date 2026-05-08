"""
sing-box multi-port proxy gateway config generator.

IP.txt format, one proxy per line:
    ip|port|username|password|expire_date

Example:
    121.41.78.38|9125|user|pass|2026-06-01

Exit codes:
    0: config generated successfully
    2: IP.txt is missing, empty, or all entries are expired/invalid
    3: entries exist, but all health checks failed
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path


START_PORT = 10001
LISTEN_ADDR = "0.0.0.0"
CHECK_TIMEOUT = 5
CHECK_WORKERS = 20


@dataclass
class Proxy:
    ip: str
    port: int
    user: str
    password: str
    expire: str = ""
    source_line: int = 0
    alive: bool = False
    latency_ms: float = -1
    error: str = ""

    @property
    def tag_name(self) -> str:
        return f"{self.ip}:{self.port}"


def parse_expire(value: str) -> date | None:
    value = value.strip()
    if not value or value.upper() in {"N/A", "NA", "NONE", "-"}:
        return None

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


def is_expired(expire: str, today: date) -> bool:
    expire_date = parse_expire(expire)
    return bool(expire_date and expire_date < today)


def parse_proxies(filepath: Path, today: date) -> tuple[list[Proxy], list[str]]:
    warnings: list[str] = []
    proxies: list[Proxy] = []

    if not filepath.exists():
        warnings.append(f"IP file does not exist: {filepath}")
        return proxies, warnings

    for line_no, raw_line in enumerate(filepath.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 4:
            warnings.append(f"line {line_no}: skipped, expected ip|port|user|password|expire")
            continue

        ip, port_text, user, password = parts[:4]
        expire = parts[4] if len(parts) >= 5 else ""

        try:
            port = int(port_text)
        except ValueError:
            warnings.append(f"line {line_no}: skipped, invalid port: {port_text}")
            continue

        if is_expired(expire, today):
            warnings.append(f"line {line_no}: skipped, expired at {expire}: {ip}:{port}")
            continue

        proxies.append(Proxy(ip=ip, port=port, user=user, password=password, expire=expire, source_line=line_no))

    return proxies, warnings


def check_socks5(proxy: Proxy, timeout: int = CHECK_TIMEOUT) -> Proxy:
    start = time.time()

    try:
        with socket.create_connection((proxy.ip, proxy.port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            sock.sendall(b"\x05\x01\x02")
            resp = sock.recv(2)

            if len(resp) < 2 or resp[0] != 0x05:
                proxy.error = "bad socks5 handshake"
                return proxy

            if resp[1] == 0x02:
                auth_msg = b"\x01"
                auth_msg += struct.pack("B", len(proxy.user)) + proxy.user.encode()
                auth_msg += struct.pack("B", len(proxy.password)) + proxy.password.encode()
                sock.sendall(auth_msg)
                auth_resp = sock.recv(2)
                if len(auth_resp) < 2 or auth_resp[1] != 0x00:
                    proxy.error = "socks5 auth failed"
                    return proxy
            elif resp[1] == 0x00:
                pass
            else:
                proxy.error = f"unsupported socks5 auth method: {resp[1]}"
                return proxy

        proxy.alive = True
        proxy.latency_ms = round((time.time() - start) * 1000, 1)
        return proxy

    except socket.timeout:
        proxy.error = "timeout"
        return proxy
    except OSError as exc:
        proxy.error = str(exc)
        return proxy


def batch_check(proxies: list[Proxy], workers: int, timeout: int) -> tuple[list[Proxy], list[Proxy]]:
    alive: list[Proxy] = []
    dead: list[Proxy] = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(check_socks5, proxy, timeout) for proxy in proxies]
        for future in as_completed(futures):
            result = future.result()
            if result.alive:
                alive.append(result)
                print(f"OK   {result.tag_name} {result.latency_ms}ms")
            else:
                dead.append(result)
                print(f"FAIL {result.tag_name} {result.error}")

    alive.sort(key=lambda item: item.latency_ms)
    return alive, dead


def generate_config(proxies: list[Proxy], start_port: int, listen_addr: str) -> dict:
    inbounds = []
    outbounds = [{"type": "direct", "tag": "direct"}]
    route_rules = []
    dns_servers = [{"tag": "local-dns", "type": "udp", "server": "223.5.5.5"}]
    dns_rules = []

    for index, proxy in enumerate(proxies, 1):
        listen_port = start_port + index - 1
        in_tag = f"in-{index}"
        out_tag = f"proxy-{index}"
        dns_tag = f"dns-{index}"

        inbounds.append(
            {
                "type": "http",
                "tag": in_tag,
                "listen": listen_addr,
                "listen_port": listen_port,
            }
        )

        outbounds.append(
            {
                "type": "socks",
                "tag": out_tag,
                "server": proxy.ip,
                "server_port": proxy.port,
                "username": proxy.user,
                "password": proxy.password,
            }
        )

        route_rules.append({"inbound": [in_tag], "action": "route", "outbound": out_tag})
        dns_servers.append(
            {
                "tag": dns_tag,
                "type": "https",
                "server": "223.5.5.5",
                "server_port": 443,
                "path": "/dns-query",
                "detour": out_tag,
            }
        )
        dns_rules.append({"inbound": [in_tag], "action": "route", "server": dns_tag})

    return {
        "log": {"level": "info", "timestamp": True},
        "dns": {
            "servers": dns_servers,
            "rules": dns_rules,
            "strategy": "ipv4_only",
        },
        "inbounds": inbounds,
        "outbounds": outbounds,
        "route": {
            "rules": [{"protocol": "dns", "action": "hijack-dns"}, *route_rules],
            "default_domain_resolver": {"server": "local-dns", "strategy": "ipv4_only"},
        },
    }


def write_port_map(path: Path, proxies: list[Proxy], start_port: int) -> None:
    lines = ["local_port,proxy,expire,latency_ms"]
    for index, proxy in enumerate(proxies):
        lines.append(f"{start_port + index},{proxy.ip}:{proxy.port},{proxy.expire},{proxy.latency_ms}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    script_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--ip-file", default=str(script_dir / "IP.txt"))
    parser.add_argument("--output", default=str(script_dir / "config.json"))
    parser.add_argument("--port-map", default=str(script_dir / "port-map.csv"))
    parser.add_argument("--start-port", type=int, default=START_PORT)
    parser.add_argument("--listen", default=LISTEN_ADDR)
    parser.add_argument("--timeout", type=int, default=CHECK_TIMEOUT)
    parser.add_argument("--workers", type=int, default=CHECK_WORKERS)
    parser.add_argument("--no-check", action="store_true", help="skip socks5 health checks")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    ip_file = Path(args.ip_file)
    output_file = Path(args.output)
    port_map_file = Path(args.port_map)

    print("sing-box gateway config generator")
    print(f"IP file: {ip_file}")

    proxies, warnings = parse_proxies(ip_file, date.today())
    for warning in warnings:
        print(f"WARN {warning}")

    if not proxies:
        print("No usable proxy entries. sing-box should stay stopped.")
        return 2

    print(f"Usable non-expired entries: {len(proxies)}")

    if args.no_check:
        alive = proxies
        for proxy in alive:
            proxy.alive = True
            proxy.latency_ms = 0
    else:
        alive, _dead = batch_check(proxies, workers=args.workers, timeout=args.timeout)

    if not alive:
        print("No alive proxy entries after health check. sing-box should stay stopped.")
        return 3

    output_file.parent.mkdir(parents=True, exist_ok=True)
    port_map_file.parent.mkdir(parents=True, exist_ok=True)

    config = generate_config(alive, start_port=args.start_port, listen_addr=args.listen)
    output_file.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    write_port_map(port_map_file, alive, start_port=args.start_port)

    print(f"Generated: {output_file}")
    print(f"Port map:  {port_map_file}")
    print(f"Ports:     {args.start_port}-{args.start_port + len(alive) - 1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
