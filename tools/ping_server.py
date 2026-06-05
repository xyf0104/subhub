#!/usr/bin/env python3
"""
SubHub 路由器 API 服务
NOTE: 运行在路由器上，提供从中国大陆的真实 ICMP ping 数据和订阅中转拉取功能
"""
import json
import subprocess
import http.server
import urllib.parse
import urllib.request
import ssl
import threading

TOKEN = "subhub_ping_2026"
PORT = 9877


def do_ping(host: str, count: int = 3, timeout: int = 5) -> dict:
    """执行 ICMP ping 并返回结果"""
    try:
        result = subprocess.run(
            ["ping", "-c", str(count), "-W", str(timeout), host],
            capture_output=True, text=True, timeout=timeout + 5
        )
        output = result.stdout
        if result.returncode == 0:
            for line in output.split("\n"):
                if "min/avg/max" in line:
                    parts = line.split("=")[-1].strip().split("/")
                    avg = float(parts[1])
                    return {"success": True, "latency": avg, "ip": host, "loss": 0}
            return {"success": True, "latency": 0, "ip": host}
        else:
            return {"success": False, "latency": -1, "error": "ping failed", "ip": host}
    except Exception as e:
        return {"success": False, "latency": -1, "error": str(e), "ip": host}


def fetch_subscription(url: str) -> dict:
    """
    中转拉取订阅链接
    NOTE: 从国内网络拉取订阅，解决国内订阅源限制海外 IP 的问题
    同时提取 subscription-userinfo 头用于流量监控
    """
    try:
        # NOTE: 忽略 SSL 证书验证，部分订阅源使用自签证书
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(url, headers={
            "User-Agent": "Shadowrocket/1980 CFNetwork/1496.0.7 Darwin/23.5.0",
            "Accept": "*/*",
        })
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            # NOTE: 透传 subscription-userinfo 头，让 SubHub 获取上游流量信息
            userinfo = resp.headers.get("subscription-userinfo", "")
            result = {"success": True, "content": content}
            if userinfo:
                result["userinfo"] = userinfo
            return result
    except Exception as e:
        return {"success": False, "error": str(e)}


class PingHandler(http.server.BaseHTTPRequestHandler):
    """HTTP 请求处理器"""

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if params.get("token") != TOKEN:
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b'{"error":"forbidden"}')
            return

        if parsed.path == "/ping":
            host = params.get("host", "")
            if not host:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"missing host"}')
                return
            result = do_ping(host)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"result": result}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if params.get("token") != TOKEN:
            self.send_response(403)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(length) if length > 0 else b"{}"

        if parsed.path == "/ping-batch":
            body = json.loads(body_raw)
            hosts = body.get("hosts", [])
            results = {}
            threads = []

            def ping_host(h):
                results[h] = do_ping(h)

            # NOTE: 最多并行 20 个 ping
            for h in hosts[:20]:
                t = threading.Thread(target=ping_host, args=(h,))
                threads.append(t)
                t.start()

            for t in threads:
                t.join(timeout=15)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"results": results}).encode())

        elif parsed.path == "/fetch-sub":
            # NOTE: 中转拉取订阅链接 — SubHub 用此接口通过国内网络拉取订阅
            body = json.loads(body_raw)
            url = body.get("url", "")
            if not url:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'{"error":"missing url"}')
                return
            result = fetch_subscription(url)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), PingHandler)
    print(f"Ping API running on port {PORT}")
    server.serve_forever()
