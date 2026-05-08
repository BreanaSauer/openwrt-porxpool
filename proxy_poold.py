"""
Lightweight proxy pool daemon for OpenWrt/KWRT.

Purpose:
  - Keep one stable proxy entry for phones, for example 192.168.31.2:10000.
  - Read upstream SOCKS5 proxies from IP.txt.
  - Read phone MAC/IP/hostnames from dnsmasq DHCP leases.
  - Bind each MAC to one upstream proxy, with a max device count per proxy.
  - Generate a sing-box config that routes by source_ip.
  - Keep sing-box as the data plane; this daemon is only the control plane.

Only Python standard library is used.
"""

from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import shutil
import signal
import socket
import socketserver
import struct
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = {
    "enabled": True,
    "ip_file": "/overlay/share/IP.txt",
    "dhcp_leases": "/tmp/dhcp.leases",
    "listen_addr": "0.0.0.0",
    "listen_port": 10000,
    "max_devices_per_proxy": 3,
    "stale_device_days": 30,
    "health_check_interval_sec": 300,
    "reconcile_interval_sec": 30,
    "socks_timeout_sec": 5,
    "health_workers": 20,
    "config_output": "/opt/proxy-pool/sing-box.json",
    "bindings_file": "/opt/proxy-pool/bindings.json",
    "state_file": "/opt/proxy-pool/state.json",
    "sing_box_bin": "sing-box",
    "sing_box_pid_file": "/var/run/proxy-pool-sing-box.pid",
    "control_host": "127.0.0.1",
    "control_port": 18080,
    "lan_interface": "br-lan",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def today_local() -> date:
    return date.today()


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    atomic_write(path, json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n")


def get_lan_ips(interface: str) -> list[str]:
    commands = [
        ["ip", "-4", "-o", "addr", "show", "dev", interface],
        ["ip", "-4", "-o", "addr", "show"],
    ]
    ips: list[str] = []
    for command in commands:
        try:
            output = subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL)
        except Exception:
            continue
        for line in output.splitlines():
            parts = line.split()
            if "inet" not in parts:
                continue
            value = parts[parts.index("inet") + 1].split("/", 1)[0]
            if value.startswith("127."):
                continue
            if value not in ips:
                ips.append(value)
        if ips:
            break
    return ips


def parse_date(value: str) -> date | None:
    value = value.strip()
    if not value or value.upper() in {"N/A", "NA", "NONE", "-"}:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass
    return None


@dataclass
class UpstreamProxy:
    key: str
    ip: str
    port: int
    user: str
    password: str
    expire: str = ""
    line: int = 0
    alive: bool = False
    latency_ms: float = -1
    error: str = ""

    @property
    def outbound_tag(self) -> str:
        return f"proxy-{self.key}"


@dataclass
class Lease:
    mac: str
    ip: str
    hostname: str
    expires_at: str


def proxy_key(ip: str, port: int, user: str) -> str:
    digest = hashlib.sha1(f"{ip}:{port}:{user}".encode("utf-8")).hexdigest()[:10]
    return digest


def read_ip_file(path: Path) -> tuple[list[UpstreamProxy], list[str]]:
    warnings: list[str] = []
    proxies: list[UpstreamProxy] = []
    seen: set[str] = set()

    if not path.exists():
        return proxies, [f"IP file missing: {path}"]

    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 4:
            warnings.append(f"line {line_no}: invalid format")
            continue
        ip, port_text, user, password = parts[:4]
        expire = parts[4] if len(parts) >= 5 else ""
        expire_date = parse_date(expire)
        if expire_date and expire_date < today_local():
            warnings.append(f"line {line_no}: expired {expire} {ip}:{port_text}")
            continue
        try:
            port = int(port_text)
        except ValueError:
            warnings.append(f"line {line_no}: invalid port {port_text}")
            continue
        key = proxy_key(ip, port, user)
        if key in seen:
            continue
        seen.add(key)
        proxies.append(UpstreamProxy(key=key, ip=ip, port=port, user=user, password=password, expire=expire, line=line_no))

    return proxies, warnings


def check_socks(proxy: UpstreamProxy, timeout: int) -> UpstreamProxy:
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
                auth = b"\x01"
                auth += struct.pack("B", len(proxy.user)) + proxy.user.encode()
                auth += struct.pack("B", len(proxy.password)) + proxy.password.encode()
                sock.sendall(auth)
                auth_resp = sock.recv(2)
                if len(auth_resp) < 2 or auth_resp[1] != 0x00:
                    proxy.error = "socks5 auth failed"
                    return proxy
            elif resp[1] != 0x00:
                proxy.error = f"unsupported auth method {resp[1]}"
                return proxy
        proxy.alive = True
        proxy.latency_ms = round((time.time() - start) * 1000, 1)
    except Exception as exc:
        proxy.error = str(exc)
    return proxy


def health_check(proxies: list[UpstreamProxy], timeout: int, workers: int) -> list[UpstreamProxy]:
    if not proxies:
        return []
    alive: list[UpstreamProxy] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(check_socks, p, timeout) for p in proxies]
        for future in as_completed(futures):
            item = future.result()
            if item.alive:
                alive.append(item)
    alive.sort(key=lambda item: item.latency_ms)
    return alive


def read_leases(path: Path) -> list[Lease]:
    leases: list[Lease] = []
    if not path.exists():
        return leases
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = raw.split()
        if len(parts) < 4:
            continue
        expires, mac, ip, hostname = parts[:4]
        leases.append(Lease(mac=mac.lower(), ip=ip, hostname=hostname if hostname != "*" else "", expires_at=expires))
    return leases


def prune_bindings(bindings: dict[str, Any], stale_days: int, alive_keys: set[str]) -> dict[str, Any]:
    cutoff = time.time() - stale_days * 86400
    pruned: dict[str, Any] = {}
    for mac, entry in bindings.items():
        if entry.get("proxy_key") not in alive_keys:
            entry.pop("proxy_key", None)
        last_seen_ts = float(entry.get("last_seen_ts", 0) or 0)
        if last_seen_ts and last_seen_ts < cutoff:
            continue
        pruned[mac.lower()] = entry
    return pruned


def proxy_load_counts(bindings: dict[str, Any], alive_keys: set[str]) -> dict[str, int]:
    counts = {key: 0 for key in alive_keys}
    for entry in bindings.values():
        key = entry.get("proxy_key")
        if key in counts:
            counts[key] += 1
    return counts


def assign_bindings(
    bindings: dict[str, Any],
    leases: list[Lease],
    proxies: list[UpstreamProxy],
    max_devices: int,
) -> dict[str, Any]:
    proxy_keys = [p.key for p in proxies]
    alive_keys = set(proxy_keys)
    counts = {key: 0 for key in proxy_keys}

    for mac, entry in bindings.items():
        key = entry.get("proxy_key")
        if key in counts:
            counts[key] += 1

    now_ts = int(time.time())
    for lease in leases:
        entry = bindings.setdefault(lease.mac, {})
        old_key = entry.get("proxy_key")
        if old_key not in alive_keys:
            old_key = None

        if not old_key:
            candidate = min(proxy_keys, key=lambda key: counts.get(key, 0), default="")
            if candidate and counts.get(candidate, 0) < max_devices:
                entry["proxy_key"] = candidate
                counts[candidate] += 1
            elif candidate:
                # All proxies are full. Keep service available by assigning to the least loaded proxy.
                entry["proxy_key"] = candidate
                counts[candidate] += 1

        entry["ip"] = lease.ip
        entry["hostname"] = lease.hostname
        entry["last_seen"] = now_iso()
        entry["last_seen_ts"] = now_ts

    return bindings


def build_sing_box_config(settings: dict[str, Any], proxies: list[UpstreamProxy], bindings: dict[str, Any]) -> dict[str, Any]:
    in_tag = "phone-http"
    outbounds: list[dict[str, Any]] = [
        {"type": "direct", "tag": "direct"},
        {"type": "block", "tag": "block"},
    ]
    proxy_by_key = {p.key: p for p in proxies}
    for proxy in proxies:
        outbounds.append(
            {
                "type": "socks",
                "tag": proxy.outbound_tag,
                "server": proxy.ip,
                "server_port": proxy.port,
                "username": proxy.user,
                "password": proxy.password,
            }
        )

    rules: list[dict[str, Any]] = []
    for mac, entry in sorted(bindings.items()):
        ip = entry.get("ip")
        key = entry.get("proxy_key")
        proxy = proxy_by_key.get(key)
        if not ip or not proxy:
            continue
        rules.append(
            {
                "inbound": [in_tag],
                "source_ip_cidr": [f"{ip}/32"],
                "action": "route",
                "outbound": proxy.outbound_tag,
            }
        )

    return {
        "log": {"level": "info", "timestamp": True},
        "inbounds": [
            {
                "type": "http",
                "tag": in_tag,
                "listen": settings["listen_addr"],
                "listen_port": int(settings["listen_port"]),
            }
        ],
        "outbounds": outbounds,
        "route": {"rules": rules, "final": "block"},
    }


class SingBoxRunner:
    def __init__(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self.process: subprocess.Popen | None = None
        self.pid_file = Path(settings["sing_box_pid_file"])

    def start_or_restart(self) -> None:
        self.stop()
        bin_path = shutil.which(self.settings["sing_box_bin"]) or self.settings["sing_box_bin"]
        config = self.settings["config_output"]
        self.process = subprocess.Popen([bin_path, "run", "-c", config], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.pid_file.parent.mkdir(parents=True, exist_ok=True)
        self.pid_file.write_text(str(self.process.pid), encoding="utf-8")

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None

        if self.pid_file.exists():
            try:
                pid = int(self.pid_file.read_text(encoding="utf-8").strip())
                cmdline = Path(f"/proc/{pid}/cmdline")
                if cmdline.exists():
                    text = cmdline.read_text(encoding="utf-8", errors="ignore")
                    if "sing-box" in text and str(self.settings["config_output"]) in text:
                        os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
            try:
                self.pid_file.unlink()
            except OSError:
                pass


class ProxyPoolDaemon:
    def __init__(self, settings: dict[str, Any]) -> None:
        self.settings = settings
        self.bindings_file = Path(settings["bindings_file"])
        self.state_file = Path(settings["state_file"])
        self.config_output = Path(settings["config_output"])
        self.runner = SingBoxRunner(settings)
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.last_config_hash = ""
        self.last_health_at = 0.0
        self.alive_proxies: list[UpstreamProxy] = []

    def write_state(self, extra: dict[str, Any]) -> None:
        lan_ips = get_lan_ips(str(self.settings.get("lan_interface", "br-lan")))
        advertised_host = lan_ips[0] if lan_ips else ""
        state = {
            "updated_at": now_iso(),
            "enabled": bool(self.settings["enabled"]),
            "listen": f"{self.settings['listen_addr']}:{self.settings['listen_port']}",
            "advertised_proxy": f"{advertised_host}:{self.settings['listen_port']}" if advertised_host else "",
            "lan_ips": lan_ips,
            "settings": self.public_settings(),
            **extra,
        }
        save_json(self.state_file, state)

    def public_settings(self) -> dict[str, Any]:
        visible_keys = [
            "enabled",
            "ip_file",
            "dhcp_leases",
            "listen_addr",
            "listen_port",
            "max_devices_per_proxy",
            "stale_device_days",
            "health_check_interval_sec",
            "reconcile_interval_sec",
            "socks_timeout_sec",
            "health_workers",
            "control_host",
            "control_port",
            "lan_interface",
        ]
        return {key: self.settings.get(key) for key in visible_keys}

    def save_settings(self) -> None:
        save_json(Path(self.settings["_config_path"]), {k: v for k, v in self.settings.items() if not k.startswith("_")})

    def update_settings(self, patch: dict[str, Any]) -> None:
        allowed = {
            "enabled": bool,
            "ip_file": str,
            "dhcp_leases": str,
            "listen_addr": str,
            "listen_port": int,
            "max_devices_per_proxy": int,
            "stale_device_days": int,
            "health_check_interval_sec": int,
            "reconcile_interval_sec": int,
            "socks_timeout_sec": int,
            "health_workers": int,
            "lan_interface": str,
        }
        for key, caster in allowed.items():
            if key not in patch:
                continue
            value = patch[key]
            if caster is bool:
                if isinstance(value, str):
                    value = value.lower() in {"1", "true", "yes", "on"}
                else:
                    value = bool(value)
            else:
                value = caster(value)
            self.settings[key] = value
        self.save_settings()
        self.last_health_at = 0

    def stop_sing_box(self, reason: str) -> None:
        self.runner.stop()
        self.write_state({"running": False, "reason": reason, "alive_proxy_count": len(self.alive_proxies)})

    def reload_ip_file(self, text: str) -> None:
        atomic_write(Path(self.settings["ip_file"]), text)
        self.last_health_at = 0
        self.reconcile(force=True)

    def set_enabled(self, enabled: bool) -> None:
        self.settings["enabled"] = enabled
        self.save_settings()
        if enabled:
            self.reconcile(force=True)
        else:
            self.stop_sing_box("disabled")

    def reconcile(self, force: bool = False) -> None:
        with self.lock:
            if not self.settings["enabled"]:
                self.stop_sing_box("disabled")
                return

            now = time.time()
            if force or now - self.last_health_at >= int(self.settings["health_check_interval_sec"]):
                proxies, warnings = read_ip_file(Path(self.settings["ip_file"]))
                alive = health_check(
                    proxies,
                    timeout=int(self.settings["socks_timeout_sec"]),
                    workers=int(self.settings["health_workers"]),
                )
                self.alive_proxies = alive
                self.last_health_at = now
                if not alive:
                    self.stop_sing_box("no alive proxies")
                    self.write_state({"running": False, "warnings": warnings, "alive_proxy_count": 0})
                    return

            if not self.alive_proxies:
                self.stop_sing_box("no alive proxies")
                return

            bindings = load_json(self.bindings_file, {})
            bindings = prune_bindings(
                bindings,
                stale_days=int(self.settings["stale_device_days"]),
                alive_keys={p.key for p in self.alive_proxies},
            )
            leases = read_leases(Path(self.settings["dhcp_leases"]))
            bindings = assign_bindings(
                bindings,
                leases,
                self.alive_proxies,
                max_devices=int(self.settings["max_devices_per_proxy"]),
            )
            save_json(self.bindings_file, bindings)

            config = build_sing_box_config(self.settings, self.alive_proxies, bindings)
            config_text = json.dumps(config, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
            new_hash = sha256_text(config_text)
            if force or new_hash != self.last_config_hash:
                atomic_write(self.config_output, config_text)
                self.last_config_hash = new_hash
                self.runner.start_or_restart()

            assigned = [entry for entry in bindings.values() if entry.get("proxy_key") and entry.get("ip")]
            counts = proxy_load_counts(bindings, {p.key for p in self.alive_proxies})
            self.write_state(
                {
                    "running": True,
                    "alive_proxy_count": len(self.alive_proxies),
                    "lease_count": len(leases),
                    "assigned_device_count": len(assigned),
                    "bindings": bindings,
                    "proxies": [{**asdict(p), "assigned_count": counts.get(p.key, 0)} for p in self.alive_proxies],
                }
            )

    def serve_control_api(self) -> None:
        daemon = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def _send(self, code: int, payload: Any) -> None:
                body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _fmt: str, *_args: Any) -> None:
                return

            def do_GET(self) -> None:
                if self.path == "/status":
                    self._send(200, load_json(daemon.state_file, {}))
                    return
                if self.path == "/settings":
                    self._send(200, daemon.public_settings())
                    return
                self._send(404, {"error": "not found"})

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0") or "0")
                body = self.rfile.read(length).decode("utf-8", errors="replace")
                if self.path == "/enable":
                    daemon.set_enabled(True)
                    self._send(200, {"ok": True, "enabled": True})
                elif self.path == "/disable":
                    daemon.set_enabled(False)
                    self._send(200, {"ok": True, "enabled": False})
                elif self.path == "/reload":
                    daemon.reconcile(force=True)
                    self._send(200, {"ok": True})
                elif self.path == "/iptxt":
                    daemon.reload_ip_file(body)
                    self._send(200, {"ok": True})
                elif self.path == "/settings":
                    try:
                        patch = json.loads(body or "{}")
                    except json.JSONDecodeError as exc:
                        self._send(400, {"error": str(exc)})
                        return
                    daemon.update_settings(patch)
                    daemon.reconcile(force=True)
                    self._send(200, {"ok": True, "settings": daemon.public_settings()})
                else:
                    self._send(404, {"error": "not found"})

        host = self.settings["control_host"]
        port = int(self.settings["control_port"])
        class ReusableTCPServer(socketserver.ThreadingTCPServer):
            allow_reuse_address = True

        with ReusableTCPServer((host, port), Handler) as httpd:
            httpd.timeout = 1
            while not self.stop_event.is_set():
                httpd.handle_request()

    def run(self) -> None:
        thread = threading.Thread(target=self.serve_control_api, daemon=True)
        thread.start()
        self.reconcile(force=True)
        while not self.stop_event.wait(int(self.settings["reconcile_interval_sec"])):
            self.reconcile()
        self.runner.stop()


def load_settings(path: Path) -> dict[str, Any]:
    settings = DEFAULT_CONFIG.copy()
    settings.update(load_json(path, {}))
    settings["_config_path"] = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        save_json(path, {k: v for k, v in settings.items() if not k.startswith("_")})
    return settings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/opt/proxy-pool/config.json")
    parser.add_argument("--once", action="store_true", help="run one reconcile cycle and exit")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    settings = load_settings(Path(args.config))
    daemon = ProxyPoolDaemon(settings)

    def handle_stop(_signum: int, _frame: Any) -> None:
        daemon.stop_event.set()

    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    if args.once:
        daemon.reconcile(force=True)
        return 0

    daemon.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
