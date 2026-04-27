#!/usr/bin/env python3
"""
ping_api.py — 大陆 ICMP Ping 测速 API
部署在中国大陆服务器上，供 SubHub 远程调用
使用系统 ping 命令执行 ICMP 测速

接口：
  GET /ping?host=xxx.com  — 对目标主机做 ICMP ping
  GET /ping-batch         — POST JSON body: {"hosts": ["host1:port", "host2:port"]}
  GET /health             — 健康检查
"""

import subprocess
import json
import re
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor, as_completed

# 认证 Token（防止滥用）
AUTH_TOKEN = "subhub_ping_2026"

def icmp_ping(host, count=3, timeout=3):
    """
    用系统 ping 命令做 ICMP 测速
    返回 {"success": bool, "latency": float, "ip": str, "loss": float}
    """
    # 先 DNS 解析
    ip = host
    family = "v4"
    try:
        infos = socket.getaddrinfo(host, None)
        # 优先 IPv4
        v4 = [i for i in infos if i[0] == socket.AF_INET]
        v6 = [i for i in infos if i[0] == socket.AF_INET6]
        if v4:
            ip = v4[0][4][0]
            family = "v4"
        elif v6:
            ip = v6[0][4][0]
            family = "v6"
    except Exception as e:
        return {"success": False, "latency": -1, "ip": host, "error": f"DNS: {e}", "family": "?"}

    # 根据 IP 类型选择 ping 命令
    cmd = "ping6" if family == "v6" else "ping"
    try:
        result = subprocess.run(
            [cmd, "-c", str(count), "-W", str(timeout), ip],
            capture_output=True, text=True, timeout=count * timeout + 5
        )
        output = result.stdout + result.stderr

        # 解析丢包率（支持 33.3333% 这种小数格式）
        loss_match = re.search(r'([\d.]+)% packet loss', output)
        loss = round(float(loss_match.group(1))) if loss_match else 100

        # 解析平均延迟 — rtt min/avg/max/mdev = 0.039/0.048/0.058/0.007 ms
        rtt_match = re.search(r'rtt min/avg/max/mdev = [\d.]+/([\d.]+)/', output)
        if not rtt_match:
            # 兼容另一种格式
            rtt_match = re.search(r'min/avg/max = [\d.]+/([\d.]+)/', output)

        if rtt_match and loss < 100:
            avg = float(rtt_match.group(1))
            return {
                "success": True,
                "latency": round(avg, 1),
                "ip": ip,
                "family": family,
                "loss": loss,
            }
        else:
            return {
                "success": False,
                "latency": -1,
                "ip": ip,
                "family": family,
                "loss": loss,
                "error": "100% packet loss" if loss == 100 else f"{loss}% loss, no avg",
            }
    except subprocess.TimeoutExpired:
        return {"success": False, "latency": -1, "ip": ip, "family": family, "error": "ping timeout"}
    except FileNotFoundError:
        # ping6 不存在时用 ping -6
        if cmd == "ping6":
            try:
                result = subprocess.run(
                    ["ping", "-6", "-c", str(count), "-W", str(timeout), ip],
                    capture_output=True, text=True, timeout=count * timeout + 5
                )
                output = result.stdout
                loss_match = re.search(r'([\d.]+)% packet loss', output)
                loss = round(float(loss_match.group(1))) if loss_match else 100
                rtt_match = re.search(r'rtt min/avg/max/mdev = [\d.]+/([\d.]+)/', output)
                if rtt_match and loss < 100:
                    return {"success": True, "latency": round(float(rtt_match.group(1)), 1), "ip": ip, "family": family, "loss": loss}
                return {"success": False, "latency": -1, "ip": ip, "family": family, "loss": loss, "error": "no rtt"}
            except Exception as e2:
                return {"success": False, "latency": -1, "ip": ip, "family": family, "error": str(e2)}
        return {"success": False, "latency": -1, "ip": ip, "family": family, "error": "ping not found"}
    except Exception as e:
        return {"success": False, "latency": -1, "ip": ip, "family": family, "error": str(e)}


class PingHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 静默日志
        pass

    def check_auth(self):
        token = parse_qs(urlparse(self.path).query).get("token", [None])[0]
        if not token:
            token = self.headers.get("X-Token")
        if token != AUTH_TOKEN:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b'{"error":"forbidden"}')
            return False
        return True

    def send_json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode())

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        if parsed.path == "/health":
            self.send_json(200, {"status": "ok", "location": "China-Shanghai"})
            return

        if not self.check_auth():
            return

        if parsed.path == "/ping":
            host = params.get("host", [None])[0]
            if not host:
                self.send_json(400, {"error": "missing host"})
                return
            # 提取纯 host（去掉端口）
            pure_host = host.split(":")[0] if ":" in host and not host.startswith("[") else host
            result = icmp_ping(pure_host, count=3, timeout=3)
            self.send_json(200, {"host": host, "result": result})
            return

        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.check_auth():
            return

        parsed = urlparse(self.path)
        if parsed.path == "/ping-batch":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            hosts = body.get("hosts", [])
            if not hosts:
                self.send_json(400, {"error": "missing hosts"})
                return

            # 并发 ping（最多 8 个同时）
            results = {}
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = {}
                for h in hosts:
                    pure_host = h.split(":")[0] if ":" in h and not h.startswith("[") else h
                    futures[pool.submit(icmp_ping, pure_host, 3, 3)] = h
                for future in as_completed(futures):
                    host_key = futures[future]
                    results[host_key] = future.result()

            self.send_json(200, {"results": results, "location": "China-Shanghai"})
            return

        if parsed.path == "/fetch-sub":
            """代理拉取订阅内容 — 供海外 SubHub 调用，解决国内订阅源限制"""
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            sub_url = body.get("url", "")
            if not sub_url:
                self.send_json(400, {"error": "missing url"})
                return
            try:
                import urllib.request
                req = urllib.request.Request(sub_url, headers={
                    "User-Agent": body.get("ua", "Shadowrocket/1980 CFNetwork/1496.0.7 Darwin/23.5.0"),
                    "Accept": "*/*",
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    content = resp.read().decode("utf-8", errors="replace")
                    headers_dict = dict(resp.headers)
                    self.send_json(200, {
                        "success": True,
                        "content": content,
                        "status": resp.status,
                        "headers": {k: v for k, v in headers_dict.items() if k.lower() in (
                            "content-type", "subscription-userinfo", "content-disposition"
                        )},
                    })
            except Exception as e:
                self.send_json(200, {"success": False, "error": str(e)})
            return

        self.send_json(404, {"error": "not found"})


if __name__ == "__main__":
    port = 9877
    server = HTTPServer(("0.0.0.0", port), PingHandler)
    print(f"[PingAPI] 中国大陆 ICMP 测速服务启动 :{port}")
    server.serve_forever()
