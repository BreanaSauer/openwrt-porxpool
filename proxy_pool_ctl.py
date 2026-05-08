"""Small CLI for proxy_poold local control API."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request


def request(method: str, path: str, data: str | None, host: str, port: int) -> str:
    body = data.encode("utf-8") if data is not None else None
    req = urllib.request.Request(
        f"http://{host}:{port}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json; charset=utf-8"} if path == "/settings" else {},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18080)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("settings")
    sub.add_parser("enable")
    sub.add_parser("disable")
    sub.add_parser("reload")
    upload = sub.add_parser("upload")
    upload.add_argument("file")
    setp = sub.add_parser("set")
    setp.add_argument("pairs", nargs="+", help="key=value")
    args = parser.parse_args()

    if args.cmd == "status":
        print(request("GET", "/status", None, args.host, args.port))
    elif args.cmd == "settings":
        print(request("GET", "/settings", None, args.host, args.port))
    elif args.cmd in {"enable", "disable", "reload"}:
        print(request("POST", f"/{args.cmd}", "", args.host, args.port))
    elif args.cmd == "upload":
        with open(args.file, "r", encoding="utf-8") as f:
            print(request("POST", "/iptxt", f.read(), args.host, args.port))
    elif args.cmd == "set":
        patch = {}
        for pair in args.pairs:
            if "=" not in pair:
                raise SystemExit(f"invalid pair: {pair}")
            key, value = pair.split("=", 1)
            if value.isdigit():
                patch[key] = int(value)
            elif value.lower() in {"true", "false"}:
                patch[key] = value.lower() == "true"
            else:
                patch[key] = value
        print(request("POST", "/settings", json.dumps(patch), args.host, args.port))
    else:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
