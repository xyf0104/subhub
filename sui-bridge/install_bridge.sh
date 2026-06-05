#!/bin/bash
# ============================================================
#  🔗 SubHub Bridge — 一键部署脚本
#  在已安装 S-UI 的服务器上部署流量监控桥接服务
#  用法: bash <(curl -sL https://raw.githubusercontent.com/xyf0104/subhub/main/sui-bridge/install_bridge.sh)
# ============================================================

set -e

# ==================== 颜色工具 ====================
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; PURPLE='\033[0;35m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; exit 1; }
ask()   { echo -ne "${CYAN}[?]${NC} $* "; }

BRIDGE_SCRIPT="/opt/sui_bridge.py"
SERVICE_NAME="sui-bridge"
SCRIPT_URL="https://gitee.com/ranxiaoer/subhub/raw/main/sui-bridge/sui_bridge.py"
VPS_IP=$(curl -s4 --connect-timeout 5 ifconfig.me 2>/dev/null || curl -s4 --connect-timeout 5 ip.sb 2>/dev/null || echo "YOUR_VPS_IP")

echo ""
echo -e "${PURPLE}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${PURPLE}║     🔗  SubHub Bridge — 一键部署程序             ║${NC}"
echo -e "${PURPLE}║     在 S-UI 服务器上启用流量监控桥接             ║${NC}"
echo -e "${PURPLE}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ==================== 0. 环境检查 ====================
[ "$(id -u)" -ne 0 ] && error "请使用 root 用户运行"

# 检查 S-UI 是否已安装
SUI_DB="/usr/local/s-ui/db/s-ui.db"
if [ ! -f "$SUI_DB" ]; then
    echo -e "${RED}未检测到 S-UI 数据库 ($SUI_DB)${NC}"
    ask "请输入 S-UI 数据库路径（或回车退出）:"
    read -r CUSTOM_DB
    [ -z "$CUSTOM_DB" ] && error "未找到 S-UI，请先安装 S-UI 后再运行此脚本"
    [ ! -f "$CUSTOM_DB" ] && error "路径不存在: $CUSTOM_DB"
    SUI_DB="$CUSTOM_DB"
fi
info "检测到 S-UI 数据库: $SUI_DB"

# 检查 Python3
command -v python3 >/dev/null 2>&1 || error "需要 Python3，请先安装"
info "Python3: $(python3 --version 2>&1)"

# 检查现有入站
INBOUND_COUNT=$(python3 -c "
import sqlite3
conn = sqlite3.connect('$SUI_DB', timeout=5)
count = conn.execute('SELECT COUNT(*) FROM inbounds').fetchone()[0]
print(count)
conn.close()
" 2>/dev/null || echo "0")
info "当前 S-UI 入站数: $INBOUND_COUNT"

# ==================== 1. 交互配置 ====================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━ 配置参数 ━━━━━━━━━━━━━━━${NC}"
echo ""

# Bridge Token
DEFAULT_TOKEN="subhub_bridge_$(openssl rand -hex 4 2>/dev/null || head -c 8 /dev/urandom | xxd -p)"
ask "Bridge 通信密钥 (直接回车使用随机密钥):"
read -r BRIDGE_TOKEN
[ -z "$BRIDGE_TOKEN" ] && BRIDGE_TOKEN="$DEFAULT_TOKEN"
info "密钥: $BRIDGE_TOKEN"

# 端口
ask "Bridge 监听端口 [默认 9876]:"
read -r BRIDGE_PORT
[ -z "$BRIDGE_PORT" ] && BRIDGE_PORT="9876"
info "端口: $BRIDGE_PORT"

# 区域标签
ask "区域标签（如 jp/us/hk/sg，用于 SubHub 识别）:"
read -r REGION
[ -z "$REGION" ] && REGION="custom"
info "区域: $REGION"

# 区域显示名
ask "区域显示名（如 日本/美国/香港，显示在 SubHub 前端）:"
read -r LABEL
[ -z "$LABEL" ] && LABEL="$REGION"
info "显示名: $LABEL"

# S-UI 域名（关键！生成节点地址用）
ask "S-UI 域名（如 us.example.com，必填，节点地址用）:"
read -r SUI_DOMAIN
while [ -z "$SUI_DOMAIN" ]; do
    warn "域名不能为空，否则节点地址将显示为 your-sui-domain.com"
    ask "S-UI 域名:"
    read -r SUI_DOMAIN
done
info "域名: $SUI_DOMAIN"

# NOTE: sui_bridge.py 通过 base64 内嵌，避免 Gitee 内容审查拦截
info "释放 sui_bridge.py ..."

# 下载或更新
if [ -f "$BRIDGE_SCRIPT" ]; then
    warn "已存在 $BRIDGE_SCRIPT，将备份并更新"
    cp "$BRIDGE_SCRIPT" "${BRIDGE_SCRIPT}.bak.$(date +%Y%m%d%H%M%S)"
fi

# 尝试下载最新版 sui_bridge.py（GitHub 优先 -> Gitee -> 内嵌 base64）
DOWNLOADED=false
GITHUB_URL="https://raw.githubusercontent.com/xyf0104/subhub/main/sui-bridge/sui_bridge.py"
GITEE_URL="https://gitee.com/ranxiaoer/subhub/raw/main/sui-bridge/sui_bridge.py"

for URL in "$GITHUB_URL" "$GITEE_URL"; do
    if curl -sL --connect-timeout 10 "$URL" -o "$BRIDGE_SCRIPT.tmp" 2>/dev/null && [ -s "$BRIDGE_SCRIPT.tmp" ]; then
        if python3 -c "import ast; ast.parse(open('$BRIDGE_SCRIPT.tmp').read())" 2>/dev/null; then
            mv "$BRIDGE_SCRIPT.tmp" "$BRIDGE_SCRIPT"
            info "下载成功（最新版）"
            DOWNLOADED=true
            break
        else
            rm -f "$BRIDGE_SCRIPT.tmp"
        fi
    fi
done

if [ "$DOWNLOADED" = false ]; then
    error "无法下载 sui_bridge.py，请检查网络连接（需要能访问 GitHub 或 Gitee）"
fi

chmod +x "$BRIDGE_SCRIPT"

# 验证脚本可运行
python3 -c "import ast; ast.parse(open('$BRIDGE_SCRIPT').read())" 2>/dev/null || error "脚本语法错误"
info "脚本验证通过"

# ==================== 3. 创建 systemd 服务 ====================
info "创建 systemd 服务..."
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=SubHub S-UI Bridge ($REGION)
After=network.target

[Service]
Type=simple
Environment=SUI_DB_PATH=$SUI_DB
Environment=BRIDGE_TOKEN=$BRIDGE_TOKEN
Environment=BRIDGE_PORT=$BRIDGE_PORT
Environment=SUI_DOMAIN=$SUI_DOMAIN
ExecStart=/usr/bin/python3 $BRIDGE_SCRIPT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 停止旧服务（如果存在）
systemctl stop ${SERVICE_NAME} 2>/dev/null || true
systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl start ${SERVICE_NAME}
sleep 2

# 验证
if systemctl is-active --quiet ${SERVICE_NAME}; then
    info "Bridge 服务启动成功"
else
    error "Bridge 服务启动失败，查看日志: journalctl -u ${SERVICE_NAME} -n 20"
fi

# ==================== 4. 健康检查 ====================
echo ""
HEALTH=$(curl -s --max-time 3 "http://127.0.0.1:${BRIDGE_PORT}/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
    info "健康检查通过: $HEALTH"
else
    warn "健康检查异常: $HEALTH"
fi

# ==================== 5. 防火墙 ====================
if command -v ufw >/dev/null 2>&1; then
    ufw allow ${BRIDGE_PORT}/tcp >/dev/null 2>&1
    info "UFW 已放行端口 ${BRIDGE_PORT}"
elif command -v firewall-cmd >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port=${BRIDGE_PORT}/tcp >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1
    info "Firewalld 已放行端口 ${BRIDGE_PORT}"
fi

# ==================== 6. Watchdog ====================
WATCHDOG_SCRIPT="/opt/bridge_watchdog.sh"
cat > "$WATCHDOG_SCRIPT" << 'WEOF'
#!/bin/bash
# SubHub Bridge Watchdog
HEALTH=$(curl -s --max-time 5 http://127.0.0.1:BRIDGE_PORT_PLACEHOLDER/health 2>/dev/null)
if ! echo "$HEALTH" | grep -q '"ok"'; then
    echo "[$(date)] Bridge 异常，重启..." >> /var/log/bridge_watchdog.log
    systemctl restart SERVICE_NAME_PLACEHOLDER
fi
WEOF
sed -i "s/BRIDGE_PORT_PLACEHOLDER/${BRIDGE_PORT}/g" "$WATCHDOG_SCRIPT"
sed -i "s/SERVICE_NAME_PLACEHOLDER/${SERVICE_NAME}/g" "$WATCHDOG_SCRIPT"
chmod +x "$WATCHDOG_SCRIPT"

# 添加 crontab（避免重复）
CRON_CMD="*/5 * * * * $WATCHDOG_SCRIPT"
(crontab -l 2>/dev/null | grep -v "bridge_watchdog" ; echo "$CRON_CMD") | crontab -
info "Watchdog 已设置（每 5 分钟检测）"

# ==================== 7. 完成 ====================
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━ ✅ 部署完成 ━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Bridge 地址: ${CYAN}http://${VPS_IP}:${BRIDGE_PORT}${NC}"
echo -e "  Bridge 密钥: ${CYAN}${BRIDGE_TOKEN}${NC}"
echo -e "  健康检查:    ${CYAN}curl http://${VPS_IP}:${BRIDGE_PORT}/health${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━ 📋 SubHub 配置（复制到 SubHub 的 SUI_BRIDGES 环境变量中） ━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}将以下 JSON 添加到 SUI_BRIDGES 数组:${NC}"
echo ""
echo -e "  ${CYAN}{\"region\":\"${REGION}\",\"label\":\"${LABEL}\",\"hostname\":\"${VPS_IP}\",\"port\":${BRIDGE_PORT},\"token\":\"${BRIDGE_TOKEN}\"}${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━ 📌 常用命令 ━━━━━━━━━━━━${NC}"
echo ""
echo -e "  查看状态:  ${CYAN}systemctl status ${SERVICE_NAME}${NC}"
echo -e "  查看日志:  ${CYAN}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "  重启服务:  ${CYAN}systemctl restart ${SERVICE_NAME}${NC}"
echo -e "  卸载服务:  ${CYAN}systemctl stop ${SERVICE_NAME} && systemctl disable ${SERVICE_NAME} && rm /etc/systemd/system/${SERVICE_NAME}.service${NC}"
echo ""

# 如果此服务器通过其他服务器中转访问（如 JP 转发 US），提示 socat
echo -e "${YELLOW}━━━━━━━━━━━━ 💡 提示 ━━━━━━━━━━━━${NC}"
echo ""
echo -e "  如果 SubHub 无法直连此服务器，可在中转机上运行 socat 转发:"
echo -e "  ${CYAN}socat TCP-LISTEN:<中转端口>,fork,reuseaddr TCP:${VPS_IP}:${BRIDGE_PORT}${NC}"
echo ""
