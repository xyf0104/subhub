#!/bin/bash
# ============================================================
#  SubHub 节点配置 — 一键安装脚本
#  适用于 Debian/Ubuntu VPS（需已安装 s-ui）
#  用法: bash <(curl -sL https://gitee.com/wufeng/subhub/raw/main/install.sh)
# ============================================================

set -e

# ==================== 颜色与工具 ====================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
PURPLE='\033[0;35m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }
ask()   { echo -e "${CYAN}[?]${NC} $*"; }

INSTALL_DIR="/opt/subhub"
REPO_URL="https://gitee.com/wufeng/subhub.git"

echo ""
echo -e "${PURPLE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║     🌊  SubHub 节点配置 — 一键安装程序          ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ==================== 0. 检测 root ====================
if [ "$(id -u)" -ne 0 ]; then
    error "请使用 root 用户运行此脚本"
    exit 1
fi

# ==================== 1. 检测 s-ui ====================
info "检测 s-ui 安装状态..."
SUI_FOUND=false
SUI_BRIDGE_HOST=""

# 检查本机是否安装了 s-ui
if systemctl is-active --quiet s-ui 2>/dev/null || docker ps --format '{{.Names}}' 2>/dev/null | grep -q "s-ui"; then
    info "检测到本机已安装 s-ui"
    SUI_FOUND=true
    SUI_BRIDGE_HOST="127.0.0.1"
fi

if [ "$SUI_FOUND" = false ]; then
    warn "本机未检测到 s-ui 服务"
    ask "请输入 s-ui 所在服务器的 IP 或域名（留空跳过 s-ui 集成）:"
    read -r SUI_BRIDGE_HOST
    if [ -n "$SUI_BRIDGE_HOST" ]; then
        SUI_FOUND=true
    else
        warn "将跳过 s-ui 集成，仅安装基础订阅管理功能"
    fi
fi

# ==================== 2. 交互式配置 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━ 基础配置 ━━━━━━━━━━━━━${NC}"

# 域名
ask "请输入已解析到本 VPS 的域名（用于 SSL 证书和订阅链接，留空则使用 IP 访问）:"
read -r DOMAIN
if [ -n "$DOMAIN" ]; then
    info "域名: $DOMAIN"
else
    warn "未设置域名，将使用 IP + 端口直接访问"
fi

# 管理员密码
ask "请设置管理员登录密码:"
read -rs ADMIN_PASSWORD
echo ""
if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="admin$(openssl rand -hex 4)"
    warn "未输入密码，已自动生成: $ADMIN_PASSWORD"
fi

# 服务端口
ask "服务端口 (默认 3456):"
read -r PORT
PORT=${PORT:-3456}

# Cookie 密钥
COOKIE_SECRET=$(openssl rand -hex 16)

# s-ui 桥接 Token
SUI_BRIDGE_TOKEN=""
SUI_BRIDGE_URL=""
if [ "$SUI_FOUND" = true ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━ s-ui 桥接配置 ━━━━━━━━━━━━━${NC}"
    SUI_BRIDGE_TOKEN="subhub_bridge_$(openssl rand -hex 4)"
    SUI_BRIDGE_URL="http://${SUI_BRIDGE_HOST}:9876"
    info "s-ui 桥接地址: $SUI_BRIDGE_URL"
    info "s-ui 桥接 Token: $SUI_BRIDGE_TOKEN"
    warn "请确保 s-ui 服务器上的 s-ui-bridge 已启动并使用此 Token"
fi

# ==================== 3. 安装依赖 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━ 安装依赖 ━━━━━━━━━━━━━${NC}"

# Docker
if ! command -v docker &>/dev/null; then
    info "安装 Docker..."
    curl -fsSL https://get.docker.com | bash
    systemctl enable docker
    systemctl start docker
    info "Docker 安装完成"
else
    info "Docker 已安装: $(docker --version | head -1)"
fi

# Docker Compose
if ! docker compose version &>/dev/null; then
    info "安装 Docker Compose 插件..."
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin 2>/dev/null || {
        # 手动安装
        COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d '"' -f 4)
        curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
    }
    info "Docker Compose 安装完成"
else
    info "Docker Compose 已安装"
fi

# Git
if ! command -v git &>/dev/null; then
    info "安装 Git..."
    apt-get update -qq && apt-get install -y -qq git
fi

# Nginx（用于反代 + SSL）
if [ -n "$DOMAIN" ]; then
    if ! command -v nginx &>/dev/null; then
        info "安装 Nginx..."
        apt-get install -y -qq nginx
        systemctl enable nginx
    fi
    info "Nginx 已就绪"
fi

# Certbot（SSL 证书）
if [ -n "$DOMAIN" ]; then
    if ! command -v certbot &>/dev/null; then
        info "安装 Certbot..."
        apt-get install -y -qq certbot python3-certbot-nginx 2>/dev/null || {
            apt-get install -y -qq snapd && snap install certbot --classic
        }
    fi
    info "Certbot 已就绪"
fi

# frps（用于接收路由器的 frpc 连接）
if ! command -v frps &>/dev/null && [ ! -f /usr/local/bin/frps ]; then
    info "安装 frps（用于大陆网络 ping/拉取订阅）..."
    FRP_VERSION="0.52.3"
    ARCH=$(uname -m)
    case $ARCH in
        x86_64) FRP_ARCH="amd64" ;;
        aarch64) FRP_ARCH="arm64" ;;
        *) FRP_ARCH="amd64" ;;
    esac
    cd /tmp
    wget -q "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${FRP_ARCH}.tar.gz" -O frp.tar.gz
    tar -xzf frp.tar.gz
    cp "frp_${FRP_VERSION}_linux_${FRP_ARCH}/frps" /usr/local/bin/
    chmod +x /usr/local/bin/frps
    rm -rf frp.tar.gz "frp_${FRP_VERSION}_linux_${FRP_ARCH}"
    info "frps 安装完成"
else
    info "frps 已安装"
fi

# ==================== 4. 拉取代码 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━ 拉取项目 ━━━━━━━━━━━━━${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
    warn "$INSTALL_DIR 已存在，拉取最新代码..."
    cd "$INSTALL_DIR"
    git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true
else
    if [ -d "$INSTALL_DIR" ]; then
        warn "备份旧目录..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}.bak.$(date +%s)"
    fi
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi
info "代码就绪: $INSTALL_DIR"

# ==================== 5. 写入 .env ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━ 配置文件 ━━━━━━━━━━━━━${NC}"

cat > "$INSTALL_DIR/.env" << ENVEOF
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=${PORT}
COOKIE_SECRET=${COOKIE_SECRET}
SUI_BRIDGE_URL=${SUI_BRIDGE_URL}
SUI_BRIDGE_TOKEN=${SUI_BRIDGE_TOKEN}
ENVEOF
chmod 600 "$INSTALL_DIR/.env"
info ".env 已生成"

# ==================== 6. 配置 frps ====================
FRP_TOKEN="subhub_router_$(openssl rand -hex 4)"
FRP_PORT=17000

mkdir -p /etc/frps
cat > /etc/frps/frps.ini << FRPEOF
[common]
bind_port = ${FRP_PORT}
token = ${FRP_TOKEN}
FRPEOF

# frps systemd 服务
cat > /etc/systemd/system/frps.service << SVCEOF
[Unit]
Description=frps server for SubHub
After=network.target

[Service]
Type=simple
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

# ==================== 7. 启动 SubHub ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━ 启动服务 ━━━━━━━━━━━━━${NC}"

cd "$INSTALL_DIR"
docker compose up -d --build
info "SubHub 容器已启动"

# ==================== 8. 配置 Nginx + SSL ====================
if [ -n "$DOMAIN" ]; then
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━ 配置 Nginx + SSL ━━━━━━━━━━━━━${NC}"

    cat > /etc/nginx/sites-available/subhub << NGXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGXEOF

    ln -sf /etc/nginx/sites-available/subhub /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx

    info "申请 SSL 证书..."
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email 2>/dev/null || {
        warn "自动 SSL 申请失败，请手动执行: certbot --nginx -d $DOMAIN"
    }
    info "Nginx + SSL 配置完成"
fi

# ==================== 9. 输出汇总 ====================
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉  SubHub 安装完成！                         ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
if [ -n "$DOMAIN" ]; then
    echo -e "${GREEN}║  访问地址:  https://${DOMAIN}${NC}"
else
    echo -e "${GREEN}║  访问地址:  http://$(curl -s4 ifconfig.me):${PORT}${NC}"
fi
echo -e "${GREEN}║  管理密码:  ${ADMIN_PASSWORD}${NC}"
echo -e "${GREEN}║  安装目录:  ${INSTALL_DIR}${NC}"
if [ -n "$SUI_BRIDGE_URL" ]; then
    echo -e "${GREEN}║  s-ui桥接:  ${SUI_BRIDGE_URL}${NC}"
fi
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"

# ==================== 10. frpc 路由器配置指南 ====================
echo ""
echo -e "${YELLOW}━━━━━━━━━ 路由器 frpc 配置指南 ━━━━━━━━━${NC}"
echo -e "
${CYAN}为了让 SubHub 能通过大陆网络 ping 节点和拉取订阅，
需要在你的家庭路由器（OpenWrt）上部署 ping_api.py + frpc：${NC}

${YELLOW}步骤 1: 在路由器上安装 ping_api.py${NC}
${GREEN}# SSH 登录路由器后执行:
scp root@$(curl -s4 ifconfig.me 2>/dev/null || echo 'YOUR_VPS_IP'):${INSTALL_DIR}/ping_api.py /root/
nohup python3 /root/ping_api.py &>/dev/null &${NC}

${YELLOW}步骤 2: 在路由器上配置 frpc${NC}
${GREEN}# 创建 frpc 配置文件 /etc/frpc_subhub.ini:
cat > /etc/frpc_subhub.ini << 'EOF'
[common]
server_addr = $(curl -s4 ifconfig.me 2>/dev/null || echo 'YOUR_VPS_IP')
server_port = ${FRP_PORT}
token = ${FRP_TOKEN}

[ping-api]
type = tcp
local_ip = 127.0.0.1
local_port = 9877
remote_port = 9877
use_encryption = true
use_compression = true
EOF

# 启动 frpc:
frpc -c /etc/frpc_subhub.ini &${NC}

${YELLOW}步骤 3: 设置开机自启（OpenWrt）${NC}
${GREEN}# 在 /etc/rc.local 的 exit 0 前添加:
python3 /root/ping_api.py &
sleep 2
frpc -c /etc/frpc_subhub.ini &${NC}
"

echo -e "${GREEN}安装完成！如有问题请查看日志: docker logs subhub${NC}"
echo ""
