#!/bin/bash
# ============================================================
#  🌊 SubHub 节点配置 — 全自动安装脚本
#  一键部署 SubHub + Nginx SSL + frps + s-ui Bridge
#  用法: git clone https://github.com/xyf0104/subhub.git /opt/subhub && cd /opt/subhub && bash install.sh
# ============================================================

set -e

# ==================== 颜色工具 ====================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; PURPLE='\033[0;35m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
ask()   { echo -ne "${CYAN}[?]${NC} $* "; }

INSTALL_DIR="/opt/subhub"
REPO_URL="https://github.com/xyf0104/subhub.git"
REPO_BRANCH="main"
VPS_IP=$(curl -s4 --connect-timeout 5 ifconfig.me 2>/dev/null || curl -s4 --connect-timeout 5 ip.sb 2>/dev/null || echo "YOUR_VPS_IP")

echo ""
echo -e "${PURPLE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║     🌊  SubHub 节点配置 — 全自动安装程序             ║${NC}"
echo -e "${PURPLE}║     包含: SubHub + Nginx SSL + frps + s-ui Bridge   ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ==================== 0. root 检查 ====================
[ "$(id -u)" -ne 0 ] && error "请使用 root 用户运行"

# ==================== 1. 交互配置 ====================
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 1 步: 基础配置 ━━━━━━━━━━━━━━━${NC}"
echo ""

# 域名
ask "输入已解析到本 VPS ($VPS_IP) 的域名（用于 HTTPS 订阅链接，留空用 IP）:"
read -r DOMAIN
[ -n "$DOMAIN" ] && info "域名: $DOMAIN" || warn "将使用 http://$VPS_IP 访问"

# 管理密码
echo ""
ask "设置管理员登录密码（留空自动生成）:"
read -rs ADMIN_PASSWORD
echo ""
if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="admin$(openssl rand -hex 4 2>/dev/null || echo $RANDOM)"
    warn "已自动生成密码: $ADMIN_PASSWORD"
else
    info "密码已设置"
fi

# 端口
ask "SubHub 服务端口 [默认 3456]:"
read -r PORT
PORT=${PORT:-3456}

# s-ui 配置
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 2 步: s-ui 日本节点集成 ━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  s-ui Bridge 用于将日本服务器的自建节点（Hysteria2/TUIC/Vless/Trojan）"
echo -e "  集成到 SubHub 的分享订阅中。Bridge 需要部署在 s-ui 所在的服务器上。"
echo ""

ask "s-ui 所在服务器的 IP 或域名（留空跳过 s-ui 集成）:"
read -r SUI_SERVER
SUI_BRIDGE_URL=""
SUI_BRIDGE_TOKEN=""
SUI_DOMAIN=""
DEPLOY_BRIDGE=false

if [ -n "$SUI_SERVER" ]; then
    ask "s-ui 服务器的 SSH 密码（用于自动部署 Bridge）:"
    read -rs SUI_SSH_PASSWORD
    echo ""

    ask "s-ui 服务器的节点域名（客户端连接用，如 jpjp.example.com）[默认同 IP]:"
    read -r SUI_DOMAIN
    SUI_DOMAIN=${SUI_DOMAIN:-$SUI_SERVER}

    SUI_BRIDGE_TOKEN="subhub_bridge_$(openssl rand -hex 4 2>/dev/null || echo $RANDOM)"
    SUI_BRIDGE_URL="http://${SUI_SERVER}:9876"
    DEPLOY_BRIDGE=true

    info "s-ui 服务器: $SUI_SERVER"
    info "节点域名: $SUI_DOMAIN"
    info "Bridge Token: $SUI_BRIDGE_TOKEN"
fi

# frp 配置
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 3 步: 大陆网络中转 (frps) ━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  frps 用于接收家庭路由器的 frpc 连接，实现大陆 Ping 测速和国内订阅拉取。"
echo ""
FRP_PORT=17000
FRP_TOKEN="subhub_router_$(openssl rand -hex 4 2>/dev/null || echo $RANDOM)"
ask "frps 监听端口 [默认 $FRP_PORT]:"
read -r FRP_PORT_INPUT
FRP_PORT=${FRP_PORT_INPUT:-$FRP_PORT}
info "frps 端口: $FRP_PORT, Token: $FRP_TOKEN"

# ==================== 2. 安装系统依赖 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 4 步: 安装系统依赖 ━━━━━━━━━━━━━━━${NC}"
echo ""

apt-get update -qq 2>/dev/null

# Git
if ! command -v git &>/dev/null; then
    info "安装 Git..."
    apt-get install -y -qq git curl wget
else
    info "Git ✓"
fi

# Docker
if ! command -v docker &>/dev/null; then
    info "安装 Docker（可能需要 1-3 分钟）..."
    curl -fsSL https://get.docker.com | bash -s -- --mirror Aliyun 2>/dev/null || curl -fsSL https://get.docker.com | bash
    systemctl enable docker && systemctl start docker
    info "Docker 安装完成"
else
    info "Docker ✓ $(docker --version 2>/dev/null | head -c 30)"
fi

# Docker Compose
if ! docker compose version &>/dev/null 2>/dev/null; then
    info "安装 Docker Compose..."
    apt-get install -y -qq docker-compose-plugin 2>/dev/null || {
        COMPOSE_V=$(curl -s https://api.github.com/repos/docker/compose/releases/latest 2>/dev/null | grep tag_name | cut -d '"' -f 4)
        COMPOSE_V=${COMPOSE_V:-v2.24.0}
        curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_V}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    }
    info "Docker Compose 安装完成"
else
    info "Docker Compose ✓"
fi

# Nginx
if ! command -v nginx &>/dev/null; then
    info "安装 Nginx..."
    apt-get install -y -qq nginx
    systemctl enable nginx
fi
info "Nginx ✓"

# Certbot（仅域名模式）
if [ -n "$DOMAIN" ]; then
    if ! command -v certbot &>/dev/null; then
        info "安装 Certbot..."
        apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null || {
            apt-get install -y -qq snapd && snap install certbot --classic 2>/dev/null
        }
    fi
    info "Certbot ✓"
fi

# sshpass（用于自动部署 Bridge）
if [ "$DEPLOY_BRIDGE" = true ] && ! command -v sshpass &>/dev/null; then
    apt-get install -y -qq sshpass 2>/dev/null
fi

# frps
if [ ! -f /usr/local/bin/frps ]; then
    info "安装 frps..."
    FRP_VERSION="0.52.3"
    case $(uname -m) in
        x86_64)  FRP_ARCH="amd64" ;;
        aarch64) FRP_ARCH="arm64" ;;
        *)       FRP_ARCH="amd64" ;;
    esac
    cd /tmp
    wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz" -O frp.tar.gz 2>/dev/null || \
    wget -q "https://mirrors.huaweicloud.com/github-frp/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz" -O frp.tar.gz
    tar -xzf frp.tar.gz
    cp "frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" /usr/local/bin/
    chmod +x /usr/local/bin/frps
    rm -rf frp.tar.gz "frp_${FRP_VERSION}_linux_${FRP_ARCH}"
    info "frps 安装完成"
else
    info "frps ✓"
fi

# ==================== 3. 拉取项目代码 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 5 步: 拉取项目代码 ━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -d "$INSTALL_DIR/.git" ]; then
    info "同步 GitHub main 最新代码..."
    cd "$INSTALL_DIR"
    git remote set-url origin "$REPO_URL"
    git fetch --prune origin "$REPO_BRANCH"

    # NOTE: 不自动覆盖本地源码，避免把未知修改或额外文件打进生产镜像。
    if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        error "检测到本地源码偏差，请先清理或提交后重新运行安装脚本"
    fi

    git checkout "$REPO_BRANCH"
    git merge --ff-only "origin/$REPO_BRANCH"

    LOCAL_COMMIT=$(git rev-parse HEAD)
    REMOTE_COMMIT=$(git rev-parse "origin/$REPO_BRANCH")
    [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ] || error "本地分支未与 GitHub main 完全一致，已停止部署"
else
    [ -d "$INSTALL_DIR" ] && mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
    git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
DEPLOY_COMMIT=$(git rev-parse --short HEAD)
info "代码就绪: $INSTALL_DIR（版本: $DEPLOY_COMMIT）"

# ==================== 4. 生成 .env ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 6 步: 生成配置文件 ━━━━━━━━━━━━━━━${NC}"
echo ""

COOKIE_SECRET=$(openssl rand -hex 16 2>/dev/null || echo "subhub-cookie-$(date +%s)")

if [ -f "$INSTALL_DIR/.env" ]; then
    # NOTE: 重复执行安装脚本时保留密码、Token 和既有集成配置，仅补齐新版本默认项。
    mkdir -p /opt/subhub-backups
    cp "$INSTALL_DIR/.env" "/opt/subhub-backups/env.$(date +%Y%m%d-%H%M%S).bak"
    grep -q '^SUBSCRIPTION_REFRESH_HOURS=' "$INSTALL_DIR/.env" || echo 'SUBSCRIPTION_REFRESH_HOURS=6' >> "$INSTALL_DIR/.env"
    grep -q '^ALLOW_INSECURE_SUBSCRIPTION_TLS=' "$INSTALL_DIR/.env" || echo 'ALLOW_INSECURE_SUBSCRIPTION_TLS=false' >> "$INSTALL_DIR/.env"
    info "已保留现有 .env，并补齐新版本默认配置"
else
    cat > "$INSTALL_DIR/.env" << ENVEOF
# SubHub 节点配置 — 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=${PORT}
COOKIE_SECRET=${COOKIE_SECRET}
SUBSCRIPTION_REFRESH_HOURS=6
ALLOW_INSECURE_SUBSCRIPTION_TLS=false
SUI_BRIDGE_URL=${SUI_BRIDGE_URL}
SUI_BRIDGE_TOKEN=${SUI_BRIDGE_TOKEN}
ENVEOF
fi
chmod 600 "$INSTALL_DIR/.env"
info ".env 配置完成"

# ==================== 5. 配置 frps ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 7 步: 配置 frps 服务 ━━━━━━━━━━━━━━━${NC}"
echo ""

mkdir -p /etc/frps
cat > /etc/frps/frps.ini << FRPEOF
[common]
bind_port = ${FRP_PORT}
token = ${FRP_TOKEN}
FRPEOF

cat > /etc/systemd/system/frps.service << 'SVCEOF'
[Unit]
Description=FRP Server for SubHub Router Ping API
After=network.target

[Service]
ExecStart=/usr/local/bin/frps -c /etc/frps/frps.ini
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable frps
systemctl restart frps
info "frps 已启动 (端口: $FRP_PORT)"

# ==================== 6. 部署 s-ui Bridge ====================
if [ "$DEPLOY_BRIDGE" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 8 步: 部署 s-ui Bridge ━━━━━━━━━━━━━━━${NC}"
    echo ""

    info "检测 s-ui 服务器连通性..."
    if sshpass -p "$SUI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@"$SUI_SERVER" "echo ok" &>/dev/null; then
        info "SSH 连接成功"

        # 检查 s-ui 是否已安装
        SUI_DB_EXISTS=$(sshpass -p "$SUI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no root@"$SUI_SERVER" "[ -f /usr/local/s-ui/db/s-ui.db ] && echo yes || echo no")
        if [ "$SUI_DB_EXISTS" != "yes" ]; then
            error "s-ui 未安装在 $SUI_SERVER（未找到数据库文件）。请先安装 s-ui 后重试。"
        fi

        info "上传 Bridge 脚本..."
        sshpass -p "$SUI_SSH_PASSWORD" scp -o StrictHostKeyChecking=no "$INSTALL_DIR/sui-bridge/sui_bridge.py" root@"$SUI_SERVER":/root/sui_bridge.py

        # 创建 systemd 服务
        sshpass -p "$SUI_SSH_PASSWORD" ssh -o StrictHostKeyChecking=no root@"$SUI_SERVER" bash -s << BRIDGE_DEPLOY
# 创建环境文件
cat > /etc/sui_bridge.env << 'BENV'
SUI_DOMAIN=${SUI_DOMAIN}
BRIDGE_TOKEN=${SUI_BRIDGE_TOKEN}
SUI_DB_PATH=/usr/local/s-ui/db/s-ui.db
BRIDGE_PORT=9876
BENV

# 创建 systemd 服务
cat > /etc/systemd/system/sui-bridge.service << 'BSVC'
[Unit]
Description=s-ui Bridge for SubHub
After=network.target s-ui.service

[Service]
Type=simple
EnvironmentFile=/etc/sui_bridge.env
ExecStart=/usr/bin/python3 /root/sui_bridge.py
Restart=always
RestartSec=5
WorkingDirectory=/root

[Install]
WantedBy=multi-user.target
BSVC

systemctl daemon-reload
systemctl enable sui-bridge
systemctl restart sui-bridge
echo "Bridge 部署完成"
BRIDGE_DEPLOY

        # 验证
        sleep 2
        if curl -s --connect-timeout 5 -H "X-Token: $SUI_BRIDGE_TOKEN" "http://${SUI_SERVER}:9876/api/inbounds" 2>/dev/null | grep -q "success"; then
            info "s-ui Bridge 部署成功并已验证！"
        else
            warn "Bridge 已部署但验证失败，可能需要等几秒再测试"
            warn "手动验证: curl -H 'X-Token: $SUI_BRIDGE_TOKEN' http://$SUI_SERVER:9876/api/inbounds"
        fi
    else
        warn "无法 SSH 到 $SUI_SERVER，跳过自动部署"
        warn "请手动部署 Bridge（见下方说明）"
    fi
fi

# ==================== 7. 构建并启动 SubHub ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 9 步: 构建并启动 SubHub ━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$INSTALL_DIR"
# NOTE: 安装脚本必须忽略旧构建缓存，确保刚同步的代码和最新基础镜像真正进入容器。
docker compose build --pull --no-cache subhub
docker compose up -d --force-recreate --remove-orphans
info "SubHub 容器已启动（版本: $DEPLOY_COMMIT）"

# 等待服务就绪
sleep 3
if curl -s --connect-timeout 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -q "ok"; then
    info "SubHub 运行正常 ✓"
else
    warn "服务可能需要几秒才能就绪"
fi

# ==================== 8. 配置 Nginx + SSL ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 第 10 步: 配置 Nginx 反向代理 ━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -n "$DOMAIN" ]; then
    # 先配 HTTP
    cat > /etc/nginx/sites-available/subhub << NGXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGXEOF

    ln -sf /etc/nginx/sites-available/subhub /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null
    nginx -t 2>/dev/null && systemctl reload nginx
    info "Nginx HTTP 配置完成"

    # SSL
    info "申请 SSL 证书..."
    mkdir -p /var/www/html
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null; then
        info "SSL 证书申请成功 ✓"
        # 设置自动续期
        (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | sort -u | crontab -
        info "SSL 自动续期已配置"
    else
        warn "自动 SSL 失败。如果已有 Nginx Proxy Manager 等工具管理 SSL，可忽略。"
        warn "手动申请: certbot --nginx -d $DOMAIN"
    fi
else
    # 无域名模式，Nginx 直接代理端口
    cat > /etc/nginx/sites-available/subhub << NGXEOF
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGXEOF
    ln -sf /etc/nginx/sites-available/subhub /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null
    nginx -t 2>/dev/null && systemctl reload nginx
    info "Nginx 反代配置完成 (HTTP)"
fi

# ==================== 9. 防火墙 ====================
if command -v ufw &>/dev/null; then
    ufw allow 80/tcp 2>/dev/null
    ufw allow 443/tcp 2>/dev/null
    ufw allow "$FRP_PORT/tcp" 2>/dev/null
    ufw allow 9877/tcp 2>/dev/null
fi

# ==================== 输出汇总 ====================
echo ""
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                 🎉  安装完成！                               ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
if [ -n "$DOMAIN" ]; then
    echo -e "${GREEN}║  🌐 访问地址:  https://${DOMAIN}${NC}"
else
    echo -e "${GREEN}║  🌐 访问地址:  http://${VPS_IP}${NC}"
fi
echo -e "${GREEN}║  🔑 管理密码:  ${ADMIN_PASSWORD}${NC}"
echo -e "${GREEN}║  📁 安装目录:  ${INSTALL_DIR}${NC}"
if [ -n "$SUI_BRIDGE_URL" ]; then
    echo -e "${GREEN}║  🇯🇵 s-ui桥接:  ${SUI_BRIDGE_URL}${NC}"
    echo -e "${GREEN}║  🔐 Bridge令牌: ${SUI_BRIDGE_TOKEN}${NC}"
fi
echo -e "${GREEN}║  📡 frps端口:  ${FRP_PORT}${NC}"
echo -e "${GREEN}║  🔐 frp令牌:   ${FRP_TOKEN}${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"

# ==================== 路由器 frpc 配置指南 ====================
echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║          📡 路由器 frpc 配置指南（复制粘贴即用）            ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}SubHub 的「大陆网络 Ping」和「国内中转拉取订阅」功能需要在"
echo -e "你的家庭路由器（OpenWrt）上部署 ping_api + frpc 中转。${NC}"
echo ""
echo -e "${YELLOW}【步骤 1】SSH 登录路由器，下载 ping_api.py${NC}"
cat << ROUTEREOF
${GREEN}# 从 VPS 下载（替换为你的 VPS IP）:
scp root@${VPS_IP}:/opt/subhub/ping_api.py /root/
# 或从 Gitee 下载:
curl -sL https://gitee.com/ranxiaoer/subhub/raw/main/ping_api.py -o /root/ping_api.py${NC}

${YELLOW}【步骤 2】创建 frpc 配置文件${NC}
${GREEN}cat > /etc/frpc_subhub.ini << 'EOF'
[common]
server_addr = ${VPS_IP}
server_port = ${FRP_PORT}
token = ${FRP_TOKEN}

[ping-api]
type = tcp
local_ip = 127.0.0.1
local_port = 9877
remote_port = 9877
use_encryption = true
use_compression = true
EOF${NC}

${YELLOW}【步骤 3】启动服务${NC}
${GREEN}# 启动 Ping API（后台运行）:
nohup python3 /root/ping_api.py > /tmp/ping_api.log 2>&1 &

# 启动 frpc:
nohup frpc -c /etc/frpc_subhub.ini > /tmp/frpc.log 2>&1 &${NC}

${YELLOW}【步骤 4】设置开机自启（OpenWrt /etc/rc.local 的 exit 0 前添加）${NC}
${GREEN}python3 /root/ping_api.py > /tmp/ping_api.log 2>&1 &
sleep 2
frpc -c /etc/frpc_subhub.ini > /tmp/frpc.log 2>&1 &${NC}
ROUTEREOF

# 手动 Bridge 部署指南（如果自动部署失败）
if [ "$DEPLOY_BRIDGE" = true ] && [ -n "$SUI_SSH_PASSWORD" ]; then
    echo ""
    echo -e "${YELLOW}【备用】手动部署 s-ui Bridge（仅在自动部署失败时需要）${NC}"
    cat << BRIDGEGUIDE
${GREEN}# SSH 到 s-ui 服务器:
ssh root@${SUI_SERVER}

# 上传 Bridge 脚本:
scp root@${VPS_IP}:/opt/subhub/sui-bridge/sui_bridge.py /root/

# 创建环境变量:
cat > /etc/sui_bridge.env << 'EOF'
SUI_DOMAIN=${SUI_DOMAIN}
BRIDGE_TOKEN=${SUI_BRIDGE_TOKEN}
SUI_DB_PATH=/usr/local/s-ui/db/s-ui.db
BRIDGE_PORT=9876
EOF

# 启动:
source /etc/sui_bridge.env && python3 /root/sui_bridge.py &${NC}
BRIDGEGUIDE
fi

echo ""
echo -e "${GREEN}━━━━ 常用命令 ━━━━${NC}"
echo -e "  查看日志: ${CYAN}docker logs subhub -f${NC}"
echo -e "  重启服务: ${CYAN}cd /opt/subhub && docker compose restart${NC}"
echo -e "  更新代码: ${CYAN}cd /opt/subhub && git pull --ff-only origin main && docker compose build --pull --no-cache subhub && docker compose up -d --force-recreate --remove-orphans${NC}"
echo -e "  查看状态: ${CYAN}docker ps && systemctl status frps${NC}"
echo ""

# 保存安装信息到文件
cat > "$INSTALL_DIR/INSTALL_INFO.txt" << INFOEOF
========================================
SubHub 安装信息（自动生成，请妥善保存）
生成时间: $(date '+%Y-%m-%d %H:%M:%S')
部署版本: ${DEPLOY_COMMIT}
========================================
VPS IP: ${VPS_IP}
域名: ${DOMAIN:-无}
管理密码: ${ADMIN_PASSWORD}
端口: ${PORT}
Cookie Secret: ${COOKIE_SECRET}

--- s-ui Bridge ---
服务器: ${SUI_SERVER:-未配置}
域名: ${SUI_DOMAIN:-未配置}
Bridge URL: ${SUI_BRIDGE_URL:-未配置}
Bridge Token: ${SUI_BRIDGE_TOKEN:-未配置}

--- frps ---
端口: ${FRP_PORT}
Token: ${FRP_TOKEN}

--- 一键更新 ---
cd /opt/subhub && git pull --ff-only origin main && docker compose build --pull --no-cache subhub && docker compose up -d --force-recreate --remove-orphans
========================================
INFOEOF
chmod 600 "$INSTALL_DIR/INSTALL_INFO.txt"
info "安装信息已保存到 $INSTALL_DIR/INSTALL_INFO.txt"
echo ""
