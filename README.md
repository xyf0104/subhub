# 🌊 SubHub 节点配置 by 无风

自托管代理订阅管理服务，支持多协议节点管理、订阅分享、s-ui 日本节点集成。

## ✨ 功能

- 📡 **多协议支持** — Hysteria2、VLESS、VMess、Trojan、Shadowsocks、TUIC
- 🔗 **订阅源管理** — 导入、定时刷新第三方机场订阅，原生支持 Shadowrocket `.conf`
- 🎁 **分享管理** — 一键创建带流量/时间限制的订阅分享
- 🇯🇵 **s-ui 集成** — 自动创建日本服务器用户，按入站协议精确控制
- 📊 **节点测速** — 大陆 ICMP Ping + 服务器监控
- 🔍 **智能搜索** — 支持中文/拼音模糊搜索
- 📱 **多客户端** — Clash、Shadowrocket、V2Ray、Sing-box、OpenClash

## 🚀 一键安装

```bash
git clone https://github.com/xyf0104/subhub.git /opt/subhub && cd /opt/subhub && bash install.sh
```

### 前提条件

- Debian/Ubuntu VPS（root 权限）
- 已安装 [s-ui](https://github.com/alireza0/s-ui)（日本服务器）
- 可选：已解析到 VPS 的域名（用于 SSL）

### 安装过程

脚本会自动：
1. ✅ 检测 s-ui 安装状态
2. ✅ 交互式输入域名、密码等配置
3. ✅ 安装 Docker、Nginx、Certbot、frps 等依赖
4. ✅ 拉取代码、生成 `.env`、构建 Docker 容器
5. ✅ 配置 Nginx 反代 + 自动申请 SSL 证书
6. ✅ 输出路由器 frpc 配置指南

## 📁 项目结构

```
├── server.js              # Express 服务入口
├── src/
│   ├── routes/
│   │   ├── api.js         # 节点/订阅/设置 API
│   │   ├── share.js       # 分享 API + s-ui 桥接
│   │   ├── subscribe.js   # 订阅输出
│   │   └── auth.js        # 认证中间件
│   └── services/
│       ├── nodeManager.js  # 数据持久化
│       ├── nodeParser.js   # URI 解析器
│       └── configGenerator.js # 多格式配置生成
├── public/                 # 前端静态文件
├── ping_api.py            # 大陆 Ping API（部署在路由器）
├── frpc_subhub.ini        # 路由器 frpc 配置模板
├── Dockerfile
├── docker-compose.yml
└── install.sh             # 一键安装脚本
```

## 🔧 手动部署

```bash
git clone https://github.com/xyf0104/subhub.git /opt/subhub
cd /opt/subhub
cp .env.example .env
# 编辑 .env 填入配置
docker compose build --pull --no-cache subhub
docker compose up -d --force-recreate --remove-orphans
```

## 🔄 更新

```bash
cd /opt/subhub
git pull --ff-only origin main
docker compose build --pull --no-cache subhub
docker compose up -d --force-recreate --remove-orphans
```

## 📋 路由器配置

安装完成后，按照脚本输出的指南在 OpenWrt 路由器上配置：
1. 部署 `ping_api.py`（大陆 ICMP Ping + 订阅代理拉取）
2. 配置 `frpc` 连接到 VPS 的 `frps`

## 📝 License

MIT
