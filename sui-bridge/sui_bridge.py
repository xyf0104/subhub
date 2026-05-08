#!/usr/bin/env python3
"""
s-ui 客户端管理 API 桥接服务
部署在 s-ui 所在服务器上，供 SubHub 远程调用
用法: SUI_DOMAIN=jpjp.xiass.com BRIDGE_TOKEN=xxx python3 sui_bridge.py
"""

import json
from urllib.parse import unquote
import sqlite3
import time
import uuid
import secrets
import string
from http.server import HTTPServer, BaseHTTPRequestHandler

import os

DB_PATH = os.environ.get("SUI_DB_PATH", "/usr/local/s-ui/db/s-ui.db")
API_TOKEN = os.environ.get("BRIDGE_TOKEN", "subhub_bridge_change_me")
LISTEN_PORT = int(os.environ.get("BRIDGE_PORT", "9876"))
SUI_DOMAIN = os.environ.get("SUI_DOMAIN", "your-sui-domain.com")

# NOTE: 不再硬编码，动态从数据库获取
def get_all_inbound_ids():
    """从数据库获取所有入站 ID"""
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute("SELECT id FROM inbounds").fetchall()
        conn.close()
        return [r[0] for r in rows]
    except Exception:
        return []


def gen_password(length=10):
    """生成随机密码"""
    chars = string.ascii_letters + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


def gen_uuid():
    """生成随机 UUID"""
    return str(uuid.uuid4())


def build_client_config(name, password, uid):
    """按照 s-ui 的格式构建完整客户端配置"""
    import base64, hashlib
    # 生成 shadowsocks 需要的 key
    ss_key = base64.b64encode(secrets.token_bytes(32)).decode()
    ss16_key = base64.b64encode(secrets.token_bytes(16)).decode()
    return {
        "mixed": {"username": name, "password": password},
        "socks": {"username": name, "password": password},
        "http": {"username": name, "password": password},
        "shadowsocks": {"name": name, "password": ss_key},
        "shadowsocks16": {"name": name, "password": ss16_key},
        "shadowtls": {"name": name, "password": ss_key},
        "vmess": {"name": name, "uuid": uid, "alterId": 0},
        "vless": {"name": name, "uuid": uid, "flow": "xtls-rprx-vision"},
        "anytls": {"name": name, "password": password},
        "trojan": {"name": name, "password": password},
        "naive": {"username": name, "password": password},
        "hysteria": {"name": name, "auth_str": password},
        "tuic": {"name": name, "uuid": uid, "password": password},
        "hysteria2": {"name": name, "password": password},
    }


def get_client_links(name, password, uid):
    """
    根据数据库中的实际入站配置动态生成节点 URI
    NOTE: 不再硬编码，自动适配 s-ui 后台的入站增删改
    """
    domain = SUI_DOMAIN
    links = []
    try:
        conn = sqlite3.connect(DB_PATH)
        rows = conn.execute("SELECT id, type, tag, out_json, options FROM inbounds").fetchall()
        conn.close()

        for row in rows:
            ib_id, ib_type, ib_tag = row[0], row[1], row[2]
            out_json = json.loads(row[3]) if row[3] else {}
            options = json.loads(row[4]) if row[4] else {}
            port = out_json.get("server_port", options.get("listen_port", 443))
            tls_cfg = out_json.get("tls", {})
            sni = tls_cfg.get("server_name", "www.bing.com")
            insecure = "1" if tls_cfg.get("insecure", False) else "0"

            if ib_type == "hysteria2":
                down = out_json.get("down_mbps", 50)
                up = options.get("up_mbps", 500)
                uri = (f"hysteria2://{password}@{domain}:{port}"
                       f"?downmbps={down}&upmbps={up}&security=tls"
                       f"&insecure={insecure}&sni={sni}&fastopen=0"
                       f"#{ib_tag}")
                links.append({"remark": ib_tag, "type": "local", "uri": uri})

            elif ib_type == "vless":
                reality = tls_cfg.get("reality", {})
                if reality.get("enabled"):
                    pbk = reality.get("public_key", "")
                    sid = reality.get("short_id", "")
                    fp = tls_cfg.get("utls", {}).get("fingerprint", "chrome")
                    uri = (f"vless://{uid}@{domain}:{port}"
                           f"?type=tcp&security=reality&pbk={pbk}&sid={sid}"
                           f"&fp={fp}&sni={sni}&flow=xtls-rprx-vision"
                           f"#{ib_tag}")
                else:
                    uri = (f"vless://{uid}@{domain}:{port}"
                           f"?type=tcp&security=tls&sni={sni}"
                           f"&flow=xtls-rprx-vision"
                           f"#{ib_tag}")
                links.append({"remark": ib_tag, "type": "local", "uri": uri})

            elif ib_type == "trojan":
                transport = options.get("transport", {})
                t_type = transport.get("type", "tcp")
                if t_type == "ws":
                    path = transport.get("path", "/")
                    host = transport.get("headers", {}).get("host", sni)
                    uri = (f"trojan://{password}@{domain}:{port}"
                           f"?type=ws&path={path}&host={host}"
                           f"&security=tls&allowInsecure={insecure}&sni={sni}"
                           f"#{ib_tag}")
                else:
                    uri = (f"trojan://{password}@{domain}:{port}"
                           f"?security=tls&allowInsecure={insecure}&sni={sni}"
                           f"#{ib_tag}")
                links.append({"remark": ib_tag, "type": "local", "uri": uri})

            elif ib_type == "tuic":
                uri = (f"tuic://{uid}:{password}@{domain}:{port}"
                       f"?security=tls&insecure={insecure}&sni={sni}"
                       f"&alpn=h3,h2,http/1.1&congestion_control=bbr"
                       f"#{ib_tag}")
                links.append({"remark": ib_tag, "type": "local", "uri": uri})

    except Exception as e:
        print(f"[Bridge] get_client_links error: {e}")

    return links


def notify_sui_change(conn, action, data):
    """向 changes 表写入变更记录，触发 s-ui 热重载"""
    conn.execute(
        "INSERT INTO changes (date_time, actor, key, action, obj) VALUES (?, ?, ?, ?, ?)",
        (int(time.time()), "subhub", "clients", action, json.dumps(data, indent=2).encode())
    )
    conn.commit()


class BridgeHandler(BaseHTTPRequestHandler):
    """API 请求处理"""

    def check_auth(self):
        token = self.headers.get("X-Token", "")
        if token != API_TOKEN:
            self.send_json(403, {"error": "unauthorized"})
            return False
        return True

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.check_auth():
            return

        if self.path == "/api/clients":
            conn = sqlite3.connect(DB_PATH)
            rows = conn.execute("SELECT id, enable, name, config, volume, expiry, down, up FROM clients").fetchall()
            clients = []
            for r in rows:
                raw = r[3]
                if isinstance(raw, bytes):
                    raw = raw.decode()
                config = json.loads(raw) if raw else {}
                # NOTE: 兼容两种 config 格式
                # s-ui 原生格式: { vless: { uuid }, hysteria2: { password }, ... }
                # bridge 创建格式: { id, password }
                password = config.get("password", "")
                uid = config.get("id", "")
                if not password and "hysteria2" in config:
                    password = config["hysteria2"].get("password", "")
                if not uid and "vless" in config:
                    uid = config["vless"].get("uuid", "")
                # NOTE: 实时动态生成 links，不依赖数据库中的历史值
                links = get_client_links(r[2], password, uid)
                clients.append({
                    "id": r[0], "enable": bool(r[1]), "name": r[2],
                    "links": links, "volume": r[4], "expiry": r[5],
                    "down": r[6], "up": r[7],
                })
            conn.close()
            self.send_json(200, {"success": True, "clients": clients})

        elif self.path == "/api/inbounds":
            conn = sqlite3.connect(DB_PATH)
            rows = conn.execute("SELECT id, type, tag FROM inbounds").fetchall()
            inbounds = [{"id": r[0], "type": r[1], "tag": r[2]} for r in rows]
            conn.close()
            self.send_json(200, {"success": True, "inbounds": inbounds})

        elif self.path == "/api/traffic":
            # 返回所有用户流量 + 系统网卡统计
            conn = sqlite3.connect(DB_PATH)
            rows = conn.execute(
                "SELECT name, enable, up, down, total_up, total_down, volume, expiry FROM clients"
            ).fetchall()
            users = []
            for r in rows:
                users.append({
                    "name": r[0], "enable": bool(r[1]),
                    "up": r[2], "down": r[3],
                    "totalUp": r[4], "totalDown": r[5],
                    "volume": r[6], "expiry": r[7],
                })
            conn.close()

            # 系统网卡流量（自重启以来）
            sys_rx, sys_tx = 0, 0
            try:
                with open("/proc/net/dev") as f:
                    for line in f:
                        if "eth0" in line:
                            p = line.split()
                            sys_rx, sys_tx = int(p[1]), int(p[9])
            except Exception:
                pass

            # 系统运行时间
            uptime_sec = 0
            try:
                with open("/proc/uptime") as f:
                    uptime_sec = float(f.read().split()[0])
            except Exception:
                pass

            self.send_json(200, {
                "success": True,
                "users": users,
                "system": {
                    "rx": sys_rx, "tx": sys_tx,
                    "uptimeSeconds": int(uptime_sec),
                }
            })

        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.check_auth():
            return

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        data = json.loads(body) if body else {}

        if self.path == "/api/clients":
            # 创建客户端
            name = data.get("name", "")
            if not name:
                self.send_json(400, {"error": "name required"})
                return

            inbound_ids = data.get("inboundIds", get_all_inbound_ids())
            volume = data.get("volume", 0)  # 流量限制（字节）
            expiry = data.get("expiry", 0)  # 过期时间戳

            password = gen_password()
            uid = gen_uuid()
            config = build_client_config(name, password, uid)
            links = get_client_links(name, password, uid)

            conn = sqlite3.connect(DB_PATH)
            # 检查重名
            existing = conn.execute("SELECT id FROM clients WHERE name=?", (name,)).fetchone()
            if existing:
                conn.close()
                self.send_json(409, {"error": f"客户端 {name} 已存在"})
                return

            conn.execute(
                "INSERT INTO clients (enable, name, config, inbounds, links, volume, expiry, down, up, desc, `group`, delay_start, auto_reset, reset_days, next_reset, total_up, total_down) VALUES (?,?,?,?,?,?,?,0,0,'','',0,0,0,0,0,0)",
                (1, name, json.dumps(config, indent=4).encode(), json.dumps(inbound_ids, indent=4).encode(),
                 json.dumps(links, indent=2).encode(), volume, expiry)
            )
            conn.commit()

            # 获取插入的 id
            client_id = conn.execute("SELECT id FROM clients WHERE name=?", (name,)).fetchone()[0]

            # 通知 s-ui 重载
            change_data = {
                "enable": True, "name": name, "config": config,
                "inbounds": inbound_ids, "links": [],
                "volume": volume, "expiry": expiry,
                "up": 0, "down": 0, "desc": "", "group": "",
                "delayStart": False, "autoReset": False,
                "resetDays": 0, "nextReset": 0, "totalUp": 0, "totalDown": 0,
            }
            # NOTE: s-ui 内部用 action='edit' 触发热重载，'new' 不会生效
            notify_sui_change(conn, "edit", change_data)
            conn.close()

            # 提取 URI 列表返回
            uris = [l["uri"] for l in links]
            self.send_json(200, {
                "success": True,
                "client": {"id": client_id, "name": name, "links": links, "uris": uris}
            })

        else:
            self.send_json(404, {"error": "not found"})

    def do_PUT(self):
        if not self.check_auth():
            return

        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        data = json.loads(body) if body else {}

        # PUT /api/clients/NAME — 更新用户的入站权限 / 重命名
        if self.path.startswith("/api/clients/"):
            name = unquote(self.path.split("/api/clients/")[1])
            conn = sqlite3.connect(DB_PATH)
            client = conn.execute("SELECT id, config, inbounds, links FROM clients WHERE name=?", (name,)).fetchone()
            if not client:
                conn.close()
                self.send_json(404, {"error": f"客户端 {name} 不存在"})
                return

            client_id = client[0]
            updated_name = name

            # 重命名
            new_name = data.get("newName")
            if new_name and new_name != name:
                # 检查新名是否已存在
                existing = conn.execute("SELECT id FROM clients WHERE name=?", (new_name,)).fetchone()
                if existing:
                    conn.close()
                    self.send_json(409, {"error": f"名称 {new_name} 已存在"})
                    return
                conn.execute("UPDATE clients SET name=? WHERE id=?", (new_name, client_id))
                updated_name = new_name

            # 更新入站权限
            new_inbound_ids = data.get("inboundIds")
            if new_inbound_ids is not None:
                conn.execute(
                    "UPDATE clients SET inbounds=? WHERE id=?",
                    (json.dumps(new_inbound_ids, indent=4).encode(), client_id)
                )

            # 更新流量限制
            new_volume = data.get("volume")
            if new_volume is not None:
                conn.execute("UPDATE clients SET volume=? WHERE id=?", (new_volume, client_id))

            # 更新到期时间
            new_expiry = data.get("expiry")
            if new_expiry is not None:
                conn.execute("UPDATE clients SET expiry=? WHERE id=?", (new_expiry, client_id))

            has_change = new_name or new_inbound_ids is not None or new_volume is not None or new_expiry is not None
            if has_change:
                conn.commit()
                # NOTE: 读取完整客户端数据用于 notify，s-ui 只认 action='edit' + 完整 obj
                full = conn.execute(
                    "SELECT enable, name, config, inbounds, links, volume, expiry, up, down, desc, `group` FROM clients WHERE id=?",
                    (client_id,)
                ).fetchone()
                if full:
                    raw_config = full[2]
                    if isinstance(raw_config, bytes): raw_config = raw_config.decode()
                    raw_inbounds = full[3]
                    if isinstance(raw_inbounds, bytes): raw_inbounds = raw_inbounds.decode()
                    notify_sui_change(conn, "edit", {
                        "enable": bool(full[0]),
                        "name": full[1],
                        "config": json.loads(raw_config) if raw_config else {},
                        "inbounds": json.loads(raw_inbounds) if raw_inbounds else [],
                        "links": [],
                        "volume": full[5], "expiry": full[6],
                        "up": full[7], "down": full[8],
                        "desc": full[9] or "", "group": full[10] or "",
                        "delayStart": False, "autoReset": False,
                        "resetDays": 0, "nextReset": 0, "totalUp": 0, "totalDown": 0,
                    })

            conn.close()
            self.send_json(200, {"success": True, "name": updated_name, "inboundIds": new_inbound_ids})

    def do_DELETE(self):
        if not self.check_auth():
            return

        # DELETE /api/clients/NAME
        if self.path.startswith("/api/clients/"):
            name = self.path.split("/api/clients/")[1]
            conn = sqlite3.connect(DB_PATH)

            client = conn.execute("SELECT id, name, config FROM clients WHERE name=?", (name,)).fetchone()
            if not client:
                conn.close()
                self.send_json(404, {"error": f"客户端 {name} 不存在"})
                return

            client_id = client[0]
            config = json.loads(client[2].decode()) if isinstance(client[2], bytes) else {}

            conn.execute("DELETE FROM clients WHERE id=?", (client_id,))
            conn.commit()

            # 通知 s-ui 重载
            notify_sui_change(conn, "delete", {
                "enable": True, "name": name, "config": config,
                "inbounds": get_all_inbound_ids(), "links": [],
                "volume": 0, "expiry": 0, "up": 0, "down": 0,
                "desc": "", "group": "", "id": client_id,
            })
            conn.close()
            self.send_json(200, {"success": True, "deleted": name})
        else:
            self.send_json(404, {"error": "not found"})

    def log_message(self, format, *args):
        print(f"[Bridge] {self.client_address[0]} - {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", LISTEN_PORT), BridgeHandler)
    print(f"[Bridge] s-ui 桥接服务启动 → 0.0.0.0:{LISTEN_PORT}")
    server.serve_forever()
