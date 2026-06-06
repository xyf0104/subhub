/**
 * SubHub Frontend Application v2 - White Theme + QR + Testing
 */

const API = '/api';
let currentPage = 'dashboard';
let _testResults = {};

// ---- Toast ----
function toast(msg, type = 'info') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:'✓',error:'✗',info:'ℹ'}[type]||'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 300); }, 3000);
}

// ---- API ----
async function api(path, opt = {}) {
  const res = await fetch(API + path, { headers: { 'Content-Type': 'application/json', ...opt.headers }, ...opt });
  if (res.status === 401) { showLogin(); throw new Error('未登录'); }
  const data = await res.json();
  if (!res.ok && !data.success) throw new Error(data.error || '请求失败');
  return data;
}

// ---- Auth ----
async function checkAuth() { try { await api('/auth/check'); showApp(); } catch { showLogin(); } }
function showLogin() { document.getElementById('loginPage').style.display='flex'; document.getElementById('appContainer').classList.remove('active'); }
function showApp() { document.getElementById('loginPage').style.display='none'; document.getElementById('appContainer').classList.add('active'); navigate('dashboard'); }

async function handleLogin(e) {
  e.preventDefault();
  const pw = document.getElementById('loginPassword').value;
  if (!pw) return toast('请输入密码','error');
  try { await api('/login',{method:'POST',body:JSON.stringify({password:pw})}); toast('登录成功','success'); showApp(); }
  catch (err) { toast(err.message,'error'); }
}

async function handleLogout() { try { await api('/logout',{method:'POST'}); } catch{} showLogin(); }

// ---- QR Code ----
function showQR(text, title) {
  document.getElementById('qrModalTitle').textContent = title || '二维码';
  document.getElementById('qrLabel').textContent = text;
  const canvas = document.getElementById('qrCanvas');
  try {
    new QRious({ element: canvas, value: text, size: 280, level: 'M',
      foreground: '#111827', background: '#ffffff' });
  } catch(e) { toast('二维码生成失败: ' + e.message, 'error'); return; }
  document.getElementById('qrModal').classList.add('active');
}

function downloadQR() {
  const canvas = document.getElementById('qrCanvas');
  const link = document.createElement('a');
  link.download = 'subhub-qrcode.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ---- Navigation ----
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  const titles = { dashboard:'仪表盘', nodes:'节点管理', subscriptions:'订阅源管理', shares:'分享管理', bridges:'Bridge 管理', settings:'设置' };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  const ha = document.getElementById('headerActions');
  ha.innerHTML = '';
  if (page === 'nodes') {
    ha.innerHTML = `
      <button class="btn btn-success btn-sm" onclick="testAllNodes()">⚡ 全部测速</button>
      <button class="btn btn-secondary btn-sm" onclick="openBatchImport()">📋 批量导入</button>
      <button class="btn btn-primary btn-sm" onclick="openAddNode()">+ 添加节点</button>`;
  } else if (page === 'subscriptions') {
    ha.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="refreshAllSubs()">🔄 全部刷新</button>
      <button class="btn btn-primary btn-sm" onclick="openAddSub()">+ 添加订阅</button>`;
  } else if (page === 'shares') {
    ha.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openCreateShare()">+ 创建分享</button>`;
  } else if (page === 'bridges') {
    ha.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openAddBridge()">+ 添加 Bridge</button>`;
  }

  if (page === 'dashboard') loadDashboard();
  else if (page === 'nodes') loadNodes();
  else if (page === 'subscriptions') loadSubscriptions();
  else if (page === 'shares') loadShares();
  else if (page === 'bridges') loadBridges();
  else if (page === 'settings') loadSettings();
  document.querySelector('.sidebar')?.classList.remove('open');
}

// ---- Dashboard ----
async function loadDashboard() {
  try {
    const { stats } = await api('/stats');
    const { token } = await api('/token');
    const host = window.location.origin;
    document.getElementById('dashboard-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">📡</div><div class="stat-value">${stats.totalNodes}</div><div class="stat-label">总节点数</div></div>
        <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-value">${stats.enabledNodes}</div><div class="stat-label">已启用</div></div>
        <div class="stat-card"><div class="stat-icon">🔗</div><div class="stat-value">${stats.subscriptions}</div><div class="stat-label">订阅源</div></div>
        <div class="stat-card"><div class="stat-icon">🌍</div><div class="stat-value">${Object.keys(stats.byRegion).length}</div><div class="stat-label">地区</div></div>
      </div>
      <div id="traffic-monitor" class="sub-links-card" style="margin-bottom:14px;">
        <h3>📈 日本服务器流量监控 <button class="btn btn-secondary btn-sm" onclick="loadTraffic()" style="margin-left:8px;">🔄 刷新</button></h3>
        <div id="traffic-content" style="padding:8px 0;color:var(--text-muted);">加载中...</div>
      </div>
      <div class="sub-links-card">
        <h3>🔗 订阅链接（点击二维码图标扫码导入）</h3>
        ${renderSubLinks(host, token)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        <div class="sub-links-card"><h3>📊 协议分布</h3>${renderTypeChart(stats.byType)}</div>
        <div class="sub-links-card"><h3>🌍 地区分布</h3>${renderRegionChart(stats.byRegion)}</div>
      </div>`;
    // 自动加载流量
    loadTraffic();
  } catch (err) { toast('加载失败: '+err.message,'error'); }
}

/**
 * 格式化字节为可读单位
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}天${h}小时${m}分`;
}

/**
 * 加载流量监控数据
 */
async function loadTraffic() {
  const el = document.getElementById('traffic-content');
  if (!el) return;
  try {
    const data = await api('/traffic');
    if (!data.success) {
      el.innerHTML = `<div style="color:var(--accent-red);">⚠️ ${data.error || '获取失败'}</div>`;
      return;
    }

    const { users, system } = data;
    const totalUserTraffic = users.reduce((s, u) => s + u.up + u.down, 0);
    // 系统网卡总量 - s-ui用户总量 = 其他流量（SSH、管理等）
    const sysTotal = system.rx + system.tx;
    const otherTraffic = Math.max(0, sysTotal - totalUserTraffic * 2);
    const avgPerDay = sysTotal / (system.uptimeSeconds / 86400);

    let html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px;">
        <div style="background:var(--accent-light);border:1px solid var(--border-color);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:12px;color:var(--accent);">🖥️ 系统运行</div>
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${formatUptime(system.uptimeSeconds)}</div>
        </div>
        <div style="background:var(--accent-light);border:1px solid var(--border-color);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:12px;color:var(--accent-orange);">📊 网卡总流量</div>
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${formatBytes(sysTotal)}</div>
        </div>
        <div style="background:var(--accent-light);border:1px solid var(--border-color);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:12px;color:var(--accent-green);">📈 日均消耗</div>
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${formatBytes(avgPerDay)}/天</div>
        </div>
        <div style="background:var(--accent-light);border:1px solid var(--border-color);border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:12px;color:var(--accent-pink);">⬇️ 接收 / ⬆️ 发送</div>
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);">${formatBytes(system.rx)} / ${formatBytes(system.tx)}</div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="border-bottom:2px solid var(--border-color);">
            <th style="text-align:left;padding:8px 4px;color:var(--text-secondary);">用户</th>
            <th style="text-align:left;padding:8px 4px;color:var(--text-secondary);">状态</th>
            <th style="text-align:right;padding:8px 4px;color:var(--text-secondary);">⬆️ 上传</th>
            <th style="text-align:right;padding:8px 4px;color:var(--text-secondary);">⬇️ 下载</th>
            <th style="text-align:right;padding:8px 4px;color:var(--text-secondary);">📊 总计</th>
            <th style="text-align:right;padding:8px 4px;color:var(--text-secondary);">限额</th>
            <th style="text-align:left;padding:8px 4px;color:var(--text-secondary);">用量占比</th>
          </tr>
        </thead>
        <tbody>`;

    // 按总流量排序
    const sorted = [...users].sort((a, b) => (b.up + b.down) - (a.up + a.down));
    for (const u of sorted) {
      const total = u.up + u.down;
      const pct = totalUserTraffic > 0 ? (total / totalUserTraffic * 100) : 0;
      const volumeStr = u.volume > 0 ? formatBytes(u.volume) : '无限';
      const usagePct = u.volume > 0 ? (total / u.volume * 100) : 0;
      const barColor = usagePct > 80 ? '#ef4444' : usagePct > 50 ? '#f59e0b' : '#10b981';
      const statusDot = u.enable ? '🟢' : '🔴';

      html += `
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:8px 4px;font-weight:600;color:var(--text-primary);">${u.name}</td>
            <td style="padding:8px 4px;">${statusDot}</td>
            <td style="text-align:right;padding:8px 4px;color:var(--text-secondary);">${formatBytes(u.up)}</td>
            <td style="text-align:right;padding:8px 4px;color:var(--text-secondary);">${formatBytes(u.down)}</td>
            <td style="text-align:right;padding:8px 4px;font-weight:700;color:var(--text-primary);">${formatBytes(total)}</td>
            <td style="text-align:right;padding:8px 4px;color:var(--text-muted);">${volumeStr}</td>
            <td style="padding:8px 4px;min-width:120px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden;">
                  <div style="height:100%;width:${Math.min(pct, 100)}%;background:${barColor};border-radius:3px;"></div>
                </div>
                <span style="font-size:12px;color:var(--text-muted);">${pct.toFixed(1)}%</span>
              </div>
            </td>
          </tr>`;
    }

    html += `</tbody></table>
      <div style="margin-top:10px;font-size:12px;color:var(--text-muted);">
        上次刷新: ${new Date().toLocaleTimeString()} · s-ui 用户总流量: ${formatBytes(totalUserTraffic)}
      </div>`;

    el.innerHTML = html;
  } catch (err) {
    el.innerHTML = `<div style="color:var(--accent-red);">⚠️ 加载失败: ${err.message}</div>`;
  }
}

function renderSubLinks(host, token) {
  const targets = [
    {label:'Clash / Meta',target:'clash',icon:'⚡'},
    {label:'OpenClash (路由器)',target:'openclash',icon:'🌐'},
    {label:'Sing-box',target:'singbox',icon:'📦'},
    {label:'V2Ray / Xray',target:'v2ray',icon:'🔷'},
    {label:'Shadowrocket',target:'shadowrocket',icon:'🚀'},
    {label:'Surge',target:'surge',icon:'🌊'},
    {label:'自动检测',target:'',icon:'🤖'},
  ];
  return targets.map(t => {
    const url = `${host}/sub/${token}${t.target?'?target='+t.target:''}`;
    return `<div class="sub-link-row">
      <span class="sub-link-label">${t.icon} ${t.label}</span>
      <span class="sub-link-url" title="${url}">${url}</span>
      <div class="sub-link-actions">
        <button class="btn btn-secondary btn-sm" onclick="showQR('${url}','${t.label} 订阅')">📱</button>
        <button class="btn btn-secondary btn-sm" onclick="copyText('${url}')">复制</button>
      </div>
    </div>`;
  }).join('');
}

function renderTypeChart(byType) {
  const colors = { hysteria2:'#6366f1', vless:'#3b82f6', vmess:'#0891b2', trojan:'#db2777', ss:'#d97706', tuic:'#059669' };
  const total = Object.values(byType).reduce((a,b)=>a+b,0)||1;
  return Object.entries(byType).map(([t,c])=>`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span class="type-badge ${t==='hysteria2'?'hy2':t}">${t}</span>
      <div style="flex:1;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden;">
        <div style="width:${c/total*100}%;height:100%;background:${colors[t]||'#888'};border-radius:3px;"></div>
      </div>
      <span style="font-size:0.82rem;color:var(--text-secondary);min-width:26px;text-align:right;">${c}</span>
    </div>`).join('')||'<p class="text-muted" style="padding:16px;text-align:center;">暂无节点</p>';
}

function renderRegionChart(byRegion) {
  const flags = {HK:'🇭🇰',JP:'🇯🇵',SG:'🇸🇬',US:'🇺🇸',TW:'🇹🇼',KR:'🇰🇷',UK:'🇬🇧',DE:'🇩🇪',AU:'🇦🇺',OTHER:'🌍'};
  const total = Object.values(byRegion).reduce((a,b)=>a+b,0)||1;
  return Object.entries(byRegion).map(([r,c])=>`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
      <span style="font-size:1.1rem;width:26px;text-align:center;">${flags[r]||'🌍'}</span>
      <span style="width:40px;font-size:0.82rem;font-weight:600;">${r}</span>
      <div style="flex:1;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden;">
        <div style="width:${c/total*100}%;height:100%;background:var(--accent);border-radius:3px;"></div>
      </div>
      <span style="font-size:0.82rem;color:var(--text-secondary);min-width:26px;text-align:right;">${c}</span>
    </div>`).join('')||'<p class="text-muted" style="padding:16px;text-align:center;">暂无节点</p>';
}

// ---- 拼音首字母匹配工具 ----
const PINYIN_MAP = {'香':'xiang','港':'gang','日':'ri','本':'ben','新':'xin','加':'jia','坡':'po','美':'mei','国':'guo','台':'tai','湾':'wan','韩':'han','英':'ying','德':'de','法':'fa','俄':'e','澳':'ao','大':'da','利':'li','亚':'ya','印':'yin','度':'du','荷':'he','兰':'lan','西':'xi','北':'bei','南':'nan','上':'shang','海':'hai','广':'guang','深':'shen','京':'jing','东':'dong','家':'jia','宽':'kuan','直':'zhi','连':'lian','剩':'sheng','余':'yu','流':'liu','量':'liang','套':'tao','餐':'can','到':'dao','期':'qi','长':'chang','有':'you','效':'xiao','超':'chao','时':'shi','请':'qing','重':'zhong','导':'dao','入':'ru','飞':'fei','兔':'tu','云':'yun','无':'wu','风':'feng','最':'zui','快':'kuai','高':'gao','速':'su'};

// NOTE: IME 组合输入状态标记，防止中文输入时被打断
let _isComposing = false;

/**
 * 模糊搜索：支持中文、拼音首字母、英文
 */
function fuzzyMatch(text, query) {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  // 直接包含
  if (t.includes(q)) return true;
  // 拼音首字母匹配
  let initials = '';
  for (const ch of text) {
    const py = PINYIN_MAP[ch];
    if (py) initials += py[0];
    else initials += ch.toLowerCase();
  }
  return initials.includes(q);
}

// ---- Nodes ----
let _allNodes = [];
let _allSubs = [];
let _nodeFilter = { sub: 'all', search: '' };

async function loadNodes() {
  try {
    const [nodesData, subsData] = await Promise.all([api('/nodes'), api('/subscriptions')]);
    _allNodes = nodesData.nodes;
    _allSubs = subsData.subscriptions || [];
    renderNodesPage();
  } catch (err) { toast('加载节点失败','error'); }
}

function renderNodesPage() {
  const container = document.getElementById('nodes-content');
  if (_allNodes.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📡</div><p>还没有添加任何节点</p><button class="btn btn-primary" onclick="openAddNode()">+ 添加第一个节点</button></div>`;
    return;
  }

  // 构建订阅源选项
  const subOptions = _allSubs.map(s => `<option value="sub-${s.id}" ${_nodeFilter.sub === 'sub-'+s.id ? 'selected' : ''}>${esc(s.name)} (${s.nodeCount || 0})</option>`).join('');

  // 统计手动节点数
  const manualCount = _allNodes.filter(n => n.group === 'manual').length;

  const toolbar = `
    <div class="nodes-toolbar">
      <div class="nodes-toolbar-left">
        <select class="form-input nodes-filter-select" id="nodeSubFilter" onchange="onNodeFilterChange()">
          <option value="all" ${_nodeFilter.sub==='all'?'selected':''}>📋 全部节点 (${_allNodes.length})</option>
          <option value="manual" ${_nodeFilter.sub==='manual'?'selected':''}>✋ 手动添加 (${manualCount})</option>
          ${subOptions}
        </select>
        <div class="nodes-search-wrap">
          <input class="form-input nodes-search" id="nodeSearchInput" placeholder="🔍 搜索节点（支持中文/拼音）" oninput="applyNodeFilter()">
        </div>
      </div>
      <div class="nodes-toolbar-right">
        <span class="nodes-count" id="filteredCount"></span>
      </div>
    </div>`;

  // NOTE: 一次渲染所有节点卡片，搜索/筛选只用 display 切换
  const allCards = `<div class="node-grid">${_allNodes.map(n => renderNodeCardV2(n)).join('')}</div>`;

  container.innerHTML = toolbar + allCards;
  applyNodeFilter();
}

function onNodeFilterChange() {
  _nodeFilter.sub = document.getElementById('nodeSubFilter').value;
  applyNodeFilter();
}

/**
 * 筛选/搜索 — 只切换卡片 display，不重渲染 DOM
 * NOTE: 不销毁搜索框，中文 IME 不会被打断
 */
function applyNodeFilter() {
  const searchEl = document.getElementById('nodeSearchInput');
  const searchVal = searchEl ? searchEl.value.trim() : '';
  const subVal = _nodeFilter.sub;

  const cards = document.querySelectorAll('.node-card-v2');
  let visibleCount = 0;

  cards.forEach((card, i) => {
    const n = _allNodes[i];
    if (!n) return;
    let show = true;

    if (subVal === 'manual' && n.group !== 'manual') show = false;
    else if (subVal.startsWith('sub-') && n.group !== subVal) show = false;

    if (show && searchVal && !fuzzyMatch(n.name + ' ' + n.server + ' ' + n.region + ' ' + n.type, searchVal)) show = false;

    card.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });

  const countEl = document.getElementById('filteredCount');
  if (countEl) countEl.textContent = `显示 ${visibleCount} / ${_allNodes.length}`;
}

function clearNodeSearch() {
  const input = document.getElementById('nodeSearchInput');
  if (input) input.value = '';
  applyNodeFilter();
}

function renderNodeCardV2(n) {
  const tc = n.type==='hysteria2'?'hy2':n.type;
  const flags = {HK:'🇭🇰',JP:'🇯🇵',SG:'🇸🇬',US:'🇺🇸',TW:'🇹🇼',KR:'🇰🇷',UK:'🇬🇧',DE:'🇩🇪',AU:'🇦🇺',OTHER:'🌍'};
  const tr = _testResults[n.id];
  let latencyHTML = '<span class="latency-badge fail">未测试</span>';
  if (tr === 'testing') latencyHTML = '<span class="latency-badge testing">测试中...</span>';
  else if (tr) {
    const ms = tr.tcp?.avgLatency;
    if (ms >= 0 && tr.tcp?.allSuccess) {
      const cls = ms < 100 ? 'fast' : ms < 300 ? 'medium' : 'slow';
      latencyHTML = `<span class="latency-badge ${cls}">${ms}ms</span>`;
    } else if (ms >= 0) {
      latencyHTML = `<span class="latency-badge medium">${ms}ms (${tr.tcp?.successRate})</span>`;
    } else {
      latencyHTML = '<span class="latency-badge fail">超时</span>';
    }
  }
  const isUDP = ['hysteria2','tuic'].includes(n.type);
  const groupLabel = n.group === 'manual' ? '手动' : '订阅';

  return `<div class="node-card-v2">
    <div class="node-card-header">
      <span class="dot ${n.enabled!==false?'active':'inactive'}"></span>
      <span class="node-card-name">${esc(n.name)}</span>
      <div class="node-card-latency">${latencyHTML}</div>
    </div>
    <div class="node-card-tags">
      <span class="type-badge ${tc}">${n.type}</span>
      <span class="region-tag">${flags[n.region]||'🌍'} ${n.region}</span>
      ${isUDP ? '<span class="proto-tag">UDP</span>' : ''}
      <span class="group-tag ${n.group==='manual'?'manual':'sub'}">${groupLabel}</span>
    </div>
    <div class="node-card-server">${esc(n.server)}:${n.port}</div>
    <div class="node-card-actions">
      <button class="btn btn-success btn-xs" onclick="testSingleNode('${n.id}')">⚡ 测速</button>
      <button class="btn btn-secondary btn-xs" onclick="showNodeQR('${n.id}')">📱</button>
      <button class="btn btn-secondary btn-xs" onclick="toggleNode('${n.id}')">${n.enabled!==false?'⏸':'▶'}</button>
      <button class="btn btn-secondary btn-xs" onclick="openEditNode('${n.id}')">✏️</button>
      <button class="btn btn-danger btn-xs" onclick="deleteNode('${n.id}')">🗑</button>
    </div>
  </div>`;
}

function renderNodeCard(n) {
  const tc = n.type==='hysteria2'?'hy2':n.type;
  const flags = {HK:'🇭🇰',JP:'🇯🇵',SG:'🇸🇬',US:'🇺🇸',TW:'🇹🇼',KR:'🇰🇷',UK:'🇬🇧',DE:'🇩🇪',OTHER:'🌍'};
  const tr = _testResults[n.id];
  let latencyHTML = '<span class="latency-badge fail">未测试</span>';
  if (tr === 'testing') latencyHTML = '<span class="latency-badge testing">测试中...</span>';
  else if (tr) {
    const ms = tr.tcp?.avgLatency;
    const note = tr.tcp?.note || '';
    if (ms >= 0 && tr.tcp?.allSuccess) {
      const cls = ms < 100 ? 'fast' : ms < 300 ? 'medium' : 'slow';
      latencyHTML = `<span class="latency-badge ${cls}">${ms}ms</span>`;
      if (note) latencyHTML += `<span style="font-size:0.78rem;color:var(--text-muted);margin-left:6px;">${note}</span>`;
    } else if (ms >= 0) {
      latencyHTML = `<span class="latency-badge medium">${ms}ms (${tr.tcp?.successRate})</span>`;
    } else {
      latencyHTML = `<span class="latency-badge fail">超时</span>`;
    }
  }
  const isUDP = ['hysteria2','tuic'].includes(n.type);
  return `<div class="node-card">
    <div class="node-status"><span class="dot ${n.enabled!==false?'active':'inactive'}"></span></div>
    <div class="node-info">
      <div class="node-name">${esc(n.name)}</div>
      <div class="node-meta">
        <span class="type-badge ${tc}">${n.type}</span>
        <span>${esc(n.server)}:${n.port}</span>
        <span>${flags[n.region]||'🌍'} ${n.region}</span>
        <span class="group-badge ${n.group==='manual'?'manual':'sub'}">${n.group==='manual'?'手动添加':'订阅导入'}</span>
        ${isUDP ? '<span style="color:var(--accent-blue);font-weight:600;">UDP/QUIC</span>' : ''}
      </div>
    </div>
    <div class="node-latency">${latencyHTML}</div>
    <div class="node-actions">
      <button class="btn btn-success btn-sm" onclick="testSingleNode('${n.id}')">⚡ 测速</button>
      <button class="btn btn-secondary btn-sm" onclick="showNodeQR('${n.id}')">📱 二维码</button>
      <button class="btn btn-secondary btn-sm" onclick="toggleNode('${n.id}')">${n.enabled!==false?'⏸ 禁用':'▶ 启用'}</button>
      <button class="btn btn-secondary btn-sm" onclick="openEditNode('${n.id}')">✏️ 编辑</button>
      <button class="btn btn-danger btn-sm" onclick="deleteNode('${n.id}')">🗑 删除</button>
    </div>
  </div>`;
}

async function toggleNode(id) {
  try { await api(`/nodes/${id}/toggle`,{method:'PATCH'}); toast('状态已更新','success'); loadNodes(); } catch(e) { toast(e.message,'error'); }
}
async function deleteNode(id) {
  if (!confirm('确定删除？')) return;
  try { await api(`/nodes/${id}`,{method:'DELETE'}); toast('已删除','success'); loadNodes(); } catch(e) { toast(e.message,'error'); }
}

// ---- Node Testing ----
async function testSingleNode(id) {
  _testResults[id] = 'testing';
  renderNodesPage();
  try {
    const { result } = await api(`/nodes/${id}/test`, { method: 'POST' });
    _testResults[id] = result;
    toast(`${result.nodeName}: ${result.tcp.avgLatency >= 0 ? result.tcp.avgLatency + 'ms' : '超时'}`, result.tcp.allSuccess ? 'success' : 'error');
  } catch (e) {
    _testResults[id] = { tcp: { avgLatency: -1, allSuccess: false } };
    toast('测试失败: ' + e.message, 'error');
  }
  renderNodesPage();
}

async function testAllNodes() {
  toast('正在测试所有节点...', 'info');
  try {
    _allNodes.forEach(n => { _testResults[n.id] = 'testing'; });
    renderNodesPage();

    const { results } = await api('/nodes/test-all', { method: 'POST' });
    results.forEach(r => { _testResults[r.nodeId] = r; });

    const ok = results.filter(r => r.tcp.allSuccess).length;
    toast(`测试完成: ${ok}/${results.length} 可用`, ok === results.length ? 'success' : 'info');
  } catch (e) {
    toast('测试失败: ' + e.message, 'error');
  }
  renderNodesPage();
}

async function showNodeQR(id) {
  try {
    const { uri } = await api(`/nodes/${id}/uri`);
    if (!uri) return toast('该节点无法生成 URI', 'error');
    showQR(uri, '节点二维码');
  } catch (e) { toast(e.message, 'error'); }
}

// ---- Node Modal ----
function openAddNode() {
  document.getElementById('nodeModalTitle').textContent = '添加节点';
  document.getElementById('nodeForm').reset();
  document.getElementById('nodeFormId').value = '';
  document.getElementById('nodeAddMode').value = 'uri';
  switchNodeAddMode('uri');
  document.getElementById('nodeModal').classList.add('active');
}

function openBatchImport() {
  document.getElementById('batchText').value = '';
  document.getElementById('batchModal').classList.add('active');
}

function switchNodeAddMode(mode) {
  document.getElementById('nodeAddMode').value = mode;
  document.querySelectorAll('.node-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('uriInput').style.display = mode === 'uri' ? 'block' : 'none';
  document.getElementById('manualInput').style.display = mode === 'manual' ? 'block' : 'none';
  if (mode === 'manual') updateManualFields();
}

function updateManualFields() {
  const type = document.getElementById('nodeType').value;
  const f = document.getElementById('dynamicFields');
  const tls = `<div class="form-row"><div class="form-group"><label>SNI</label><input class="form-input" id="nodeSNI" placeholder="留空默认"></div><div class="form-group"><label>跳过证书验证</label><select class="form-input" id="nodeInsecure"><option value="false">否</option><option value="true">是</option></select></div></div>`;
  let html = '';
  switch (type) {
    case 'hysteria2':
      html = `<div class="form-group"><label>密码 *</label><input class="form-input" id="nodePassword" required></div>${tls}<div class="form-row"><div class="form-group"><label>混淆类型</label><select class="form-input" id="nodeObfs"><option value="">无</option><option value="salamander">salamander</option></select></div><div class="form-group"><label>混淆密码</label><input class="form-input" id="nodeObfsPassword"></div></div>`; break;
    case 'vless':
      html = `<div class="form-group"><label>UUID *</label><input class="form-input" id="nodeUUID" required></div><div class="form-row"><div class="form-group"><label>传输协议</label><select class="form-input" id="nodeNetwork" onchange="updateTransportFields()"><option value="tcp">TCP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option><option value="h2">HTTP/2</option></select></div><div class="form-group"><label>安全类型</label><select class="form-input" id="nodeSecurity" onchange="updateSecurityFields()"><option value="tls">TLS</option><option value="reality">Reality</option><option value="none">无</option></select></div></div>${tls}<div class="form-group"><label>Flow</label><select class="form-input" id="nodeFlow"><option value="">无</option><option value="xtls-rprx-vision">xtls-rprx-vision</option></select></div><div id="transportFields"></div><div id="securityFields"></div>`; break;
    case 'vmess':
      html = `<div class="form-group"><label>UUID *</label><input class="form-input" id="nodeUUID" required></div><div class="form-row"><div class="form-group"><label>AlterID</label><input class="form-input" id="nodeAlterID" type="number" value="0"></div><div class="form-group"><label>加密方式</label><select class="form-input" id="nodeCipher"><option value="auto">auto</option><option value="aes-128-gcm">aes-128-gcm</option><option value="chacha20-poly1305">chacha20-poly1305</option><option value="none">none</option></select></div></div><div class="form-group"><label>传输协议</label><select class="form-input" id="nodeNetwork" onchange="updateTransportFields()"><option value="tcp">TCP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option></select></div>${tls}<div id="transportFields"></div>`; break;
    case 'trojan':
      html = `<div class="form-group"><label>密码 *</label><input class="form-input" id="nodePassword" required></div><div class="form-group"><label>传输协议</label><select class="form-input" id="nodeNetwork" onchange="updateTransportFields()"><option value="tcp">TCP</option><option value="ws">WebSocket</option><option value="grpc">gRPC</option></select></div>${tls}<div id="transportFields"></div>`; break;
    case 'ss':
      html = `<div class="form-row"><div class="form-group"><label>加密方式 *</label><select class="form-input" id="nodeCipher"><option value="aes-256-gcm">aes-256-gcm</option><option value="aes-128-gcm">aes-128-gcm</option><option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option><option value="2022-blake3-aes-128-gcm">2022-blake3-aes-128-gcm</option><option value="2022-blake3-aes-256-gcm">2022-blake3-aes-256-gcm</option></select></div><div class="form-group"><label>密码 *</label><input class="form-input" id="nodePassword" required></div></div>`; break;
    case 'tuic':
      html = `<div class="form-row"><div class="form-group"><label>UUID *</label><input class="form-input" id="nodeUUID" required></div><div class="form-group"><label>密码 *</label><input class="form-input" id="nodePassword" required></div></div>${tls}<div class="form-row"><div class="form-group"><label>拥塞控制</label><select class="form-input" id="nodeCongestion"><option value="bbr">BBR</option><option value="cubic">Cubic</option></select></div><div class="form-group"><label>UDP 中继</label><select class="form-input" id="nodeUDPRelay"><option value="native">native</option><option value="quic">quic</option></select></div></div>`; break;
  }
  f.innerHTML = html;
}

function updateTransportFields() {
  const n = document.getElementById('nodeNetwork')?.value;
  const c = document.getElementById('transportFields');
  if (!c) return;
  if (n === 'ws') c.innerHTML = `<div class="form-row"><div class="form-group"><label>WS 路径</label><input class="form-input" id="nodeWSPath" value="/"></div><div class="form-group"><label>WS Host</label><input class="form-input" id="nodeWSHost"></div></div>`;
  else if (n === 'grpc') c.innerHTML = `<div class="form-group"><label>gRPC Service</label><input class="form-input" id="nodeGRPCService"></div>`;
  else c.innerHTML = '';
}

function updateSecurityFields() {
  const s = document.getElementById('nodeSecurity')?.value;
  const c = document.getElementById('securityFields');
  if (!c) return;
  if (s === 'reality') c.innerHTML = `<div class="form-row"><div class="form-group"><label>Public Key *</label><input class="form-input" id="nodeRealityPBK" required></div><div class="form-group"><label>Short ID</label><input class="form-input" id="nodeRealitySID"></div></div><div class="form-group"><label>Fingerprint</label><select class="form-input" id="nodeFingerprint"><option value="chrome">chrome</option><option value="firefox">firefox</option><option value="safari">safari</option><option value="random">random</option></select></div>`;
  else c.innerHTML = '';
}

async function submitNode(e) {
  e.preventDefault();
  const mode = document.getElementById('nodeAddMode').value;
  const editId = document.getElementById('nodeFormId').value;
  try {
    if (mode === 'uri') {
      const uri = document.getElementById('nodeURI').value.trim();
      if (!uri) return toast('请输入节点 URI','error');
      await api('/nodes',{method:'POST',body:JSON.stringify({uri})});
      toast('节点添加成功','success');
    } else {
      const body = buildNodeFromForm();
      if (editId) { await api(`/nodes/${editId}`,{method:'PUT',body:JSON.stringify(body)}); toast('已更新','success'); }
      else { await api('/nodes',{method:'POST',body:JSON.stringify(body)}); toast('添加成功','success'); }
    }
    closeModal('nodeModal'); loadNodes();
    if (currentPage === 'dashboard') loadDashboard();
  } catch (err) { toast(err.message,'error'); }
}

function buildNodeFromForm() {
  const type = document.getElementById('nodeType').value;
  const b = { name:document.getElementById('nodeName').value, type, server:document.getElementById('nodeServer').value, port:parseInt(document.getElementById('nodePort').value)||443, region:document.getElementById('nodeRegion').value, sni:document.getElementById('nodeSNI')?.value||'', skipCertVerify:document.getElementById('nodeInsecure')?.value==='true' };
  if (['hysteria2','trojan','ss','tuic'].includes(type)) b.password = document.getElementById('nodePassword')?.value||'';
  if (['vless','vmess','tuic'].includes(type)) b.uuid = document.getElementById('nodeUUID')?.value||'';
  if (type==='vmess') { b.alterId = parseInt(document.getElementById('nodeAlterID')?.value)||0; b.cipher = document.getElementById('nodeCipher')?.value||'auto'; }
  if (type==='ss') b.cipher = document.getElementById('nodeCipher')?.value||'aes-256-gcm';
  if (['vless','vmess','trojan'].includes(type)) { b.network = document.getElementById('nodeNetwork')?.value||'tcp'; b.wsPath = document.getElementById('nodeWSPath')?.value||''; b.wsHost = document.getElementById('nodeWSHost')?.value||''; b.grpcServiceName = document.getElementById('nodeGRPCService')?.value||''; }
  if (type==='vless') { b.flow = document.getElementById('nodeFlow')?.value||''; const sec = document.getElementById('nodeSecurity')?.value; b.tls = sec!=='none'; if (sec==='reality') { b.realityPublicKey = document.getElementById('nodeRealityPBK')?.value||''; b.realityShortId = document.getElementById('nodeRealitySID')?.value||''; b.fingerprint = document.getElementById('nodeFingerprint')?.value||'chrome'; } }
  if (type==='hysteria2') { b.obfs = document.getElementById('nodeObfs')?.value||''; b.obfsPassword = document.getElementById('nodeObfsPassword')?.value||''; }
  if (type==='tuic') { b.congestionControl = document.getElementById('nodeCongestion')?.value||'bbr'; b.udpRelayMode = document.getElementById('nodeUDPRelay')?.value||'native'; }
  return b;
}

async function openEditNode(id) {
  try {
    const { nodes } = await api('/nodes');
    const node = nodes.find(n => n.id === id);
    if (!node) return toast('节点不存在','error');
    document.getElementById('nodeModalTitle').textContent = '编辑节点';
    document.getElementById('nodeFormId').value = id;
    switchNodeAddMode('manual');
    document.getElementById('nodeName').value = node.name;
    document.getElementById('nodeType').value = node.type;
    document.getElementById('nodeServer').value = node.server;
    document.getElementById('nodePort').value = node.port;
    document.getElementById('nodeRegion').value = node.region;
    updateManualFields();
    setTimeout(() => {
      const el = (x) => document.getElementById(x);
      if (el('nodeSNI')) el('nodeSNI').value = node.sni||'';
      if (el('nodeInsecure')) el('nodeInsecure').value = String(node.skipCertVerify||false);
      if (el('nodePassword')) el('nodePassword').value = node.password||'';
      if (el('nodeUUID')) el('nodeUUID').value = node.uuid||'';
      if (el('nodeAlterID')) el('nodeAlterID').value = node.alterId||0;
      if (el('nodeCipher')) el('nodeCipher').value = node.cipher||'auto';
      if (el('nodeNetwork')) { el('nodeNetwork').value = node.network||'tcp'; updateTransportFields(); }
      if (el('nodeFlow')) el('nodeFlow').value = node.flow||'';
      if (el('nodeSecurity')) { el('nodeSecurity').value = node.realityPublicKey?'reality':(node.tls?'tls':'none'); updateSecurityFields(); }
      if (el('nodeObfs')) el('nodeObfs').value = node.obfs||'';
      if (el('nodeObfsPassword')) el('nodeObfsPassword').value = node.obfsPassword||'';
      if (el('nodeCongestion')) el('nodeCongestion').value = node.congestionControl||'bbr';
      if (el('nodeUDPRelay')) el('nodeUDPRelay').value = node.udpRelayMode||'native';
      setTimeout(() => {
        if (el('nodeWSPath')) el('nodeWSPath').value = node.wsPath||'';
        if (el('nodeWSHost')) el('nodeWSHost').value = node.wsHost||'';
        if (el('nodeGRPCService')) el('nodeGRPCService').value = node.grpcServiceName||'';
        if (el('nodeRealityPBK')) el('nodeRealityPBK').value = node.realityPublicKey||'';
        if (el('nodeRealitySID')) el('nodeRealitySID').value = node.realityShortId||'';
        if (el('nodeFingerprint')) el('nodeFingerprint').value = node.fingerprint||'chrome';
      }, 50);
    }, 50);
    document.getElementById('nodeModal').classList.add('active');
  } catch (err) { toast(err.message,'error'); }
}

async function submitBatch() {
  const text = document.getElementById('batchText').value.trim();
  if (!text) return toast('请输入节点信息','error');
  try { const {count} = await api('/nodes/batch',{method:'POST',body:JSON.stringify({text})}); toast(`成功导入 ${count} 个节点`,'success'); closeModal('batchModal'); loadNodes(); }
  catch (err) { toast(err.message,'error'); }
}

// ---- Subscriptions ----
async function loadSubscriptions() {
  try {
    const { subscriptions } = await api('/subscriptions');
    const c = document.getElementById('subs-content');
    if (subscriptions.length === 0) { c.innerHTML = `<div class="empty-state"><div class="icon">🔗</div><p>还没有添加任何订阅源</p><button class="btn btn-primary" onclick="openAddSub()">+ 添加订阅源</button></div>`; return; }
    c.innerHTML = subscriptions.map(s => `<div class="sub-source-card"><div class="sub-source-info"><h4>${esc(s.name)}</h4><p>${esc(s.url)}</p><div class="sub-source-meta"><span>📡 ${s.nodeCount||0} 个节点</span><span>🕐 ${s.lastUpdate?new Date(s.lastUpdate).toLocaleString('zh-CN'):'未刷新'}</span></div></div><div class="sub-source-actions"><button class="btn btn-secondary btn-sm" onclick="refreshSub('${s.id}')">🔄</button><button class="btn btn-danger btn-sm" onclick="deleteSub('${s.id}')">🗑</button></div></div>`).join('');
  } catch (err) { toast('加载失败','error'); }
}

function openAddSub() { document.getElementById('subName').value=''; document.getElementById('subURL').value=''; document.getElementById('subFetchMode').value='direct'; document.getElementById('subModal').classList.add('active'); }

async function submitSub() {
  const name = document.getElementById('subName').value.trim();
  const url = document.getElementById('subURL').value.trim();
  const fetchMode = document.getElementById('subFetchMode').value;
  if (!name||!url) return toast('请填写名称和 URL','error');
  try {
    toast(fetchMode === 'china' ? '正在通过国内网络拉取...' : '正在直连拉取...', 'info');
    const r = await api('/subscriptions',{method:'POST',body:JSON.stringify({name,url,fetchMode})});
    toast(`已添加，获取到 ${r.nodeCount||0} 个节点`,'success');
    if (r.warning) toast(r.warning,'info');
    closeModal('subModal'); loadSubscriptions();
  } catch (err) { toast(err.message,'error'); }
}

async function refreshSub(id) { try { toast('刷新中...','info'); const {count}=await api(`/subscriptions/${id}/refresh`,{method:'POST'}); toast(`获取到 ${count} 个节点`,'success'); loadSubscriptions(); } catch(e){ toast(e.message,'error'); } }
async function refreshAllSubs() { try { toast('刷新所有...','info'); const {results}=await api('/subscriptions/refresh-all',{method:'POST'}); const ok=results.filter(r=>r.success).length; toast(`${ok}/${results.length} 成功`,'success'); loadSubscriptions(); } catch(e){ toast(e.message,'error'); } }
async function deleteSub(id) { if(!confirm('删除此订阅源？'))return; try { await api(`/subscriptions/${id}`,{method:'DELETE'}); toast('已删除','success'); loadSubscriptions(); } catch(e){ toast(e.message,'error'); } }

// ---- Settings ----
async function loadSettings() {
  try {
    const { token } = await api('/token');
    const host = window.location.origin;
    const autoUrl = `${host}/sub/${token}`;
    document.getElementById('settings-content').innerHTML = `
      <div class="settings-section"><h3>🔑 订阅 Token</h3>
        <div class="settings-row"><div><label>当前 Token</label><p style="font-family:monospace;margin-top:4px;color:var(--accent);">${token}</p></div>
        <div class="flex gap-2"><button class="btn btn-secondary btn-sm" onclick="showQR('${autoUrl}','通用订阅')">📱 二维码</button><button class="btn btn-secondary btn-sm" onclick="copyText('${token}')">复制</button><button class="btn btn-danger btn-sm" onclick="regenerateToken()">重新生成</button></div></div></div>
      <div class="settings-section"><h3>🔒 修改密码</h3><form onsubmit="changePassword(event)"><div class="form-group"><label>当前密码</label><input class="form-input" type="password" id="oldPass" required></div><div class="form-group"><label>新密码</label><input class="form-input" type="password" id="newPass" required></div><button class="btn btn-primary" type="submit">更改密码</button></form></div>
      <div class="settings-section"><h3>ℹ️ 关于</h3><div class="settings-row"><div><label>SubHub v1.0.0</label><p>自托管代理订阅管理服务</p></div></div></div>`;
  } catch (err) { toast('加载失败','error'); }
}

async function regenerateToken() { if(!confirm('重新生成后旧链接失效，确定吗？'))return; try { await api('/token/regenerate',{method:'POST'}); toast('Token 已重新生成','success'); loadSettings(); } catch(e){ toast(e.message,'error'); } }
async function changePassword(e) { e.preventDefault(); try { await api('/password',{method:'POST',body:JSON.stringify({oldPassword:document.getElementById('oldPass').value,newPassword:document.getElementById('newPass').value})}); toast('密码已更改','success'); loadSettings(); } catch(e){ toast(e.message,'error'); } }

// ---- 分享管理 ----
async function loadShares() {
  try {
    const { shares } = await api('/shares');
    const c = document.getElementById('shares-content');
    if (shares.length === 0) {
      c.innerHTML = `<div class="empty-state"><div class="icon">🎁</div><p>还没有创建任何分享</p><button class="btn btn-primary" onclick="openCreateShare()">+ 创建第一个分享</button></div>`;
      return;
    }
    const host = window.location.origin;
    c.innerHTML = shares.map(s => {
      const expired = s.expireAt && new Date(s.expireAt) < new Date();
      const overTraffic = s.trafficLimit > 0 && s.trafficUsed >= s.trafficLimit;
      const status = !s.enabled ? '已禁用' : expired ? '已过期' : overTraffic ? '流量用完' : '正常';
      const statusCls = status === '正常' ? 'active' : 'inactive';
      // NOTE: URL fragment (#标题) 让 Shadowrocket 等客户端显示自定义订阅名
      const url = `${host}/s/${s.token}#${encodeURIComponent(s.title)}`;
      const trafficStr = s.trafficLimit > 0 ? `${formatBytes(s.trafficUsed)} / ${formatBytes(s.trafficLimit)}` : '不限流量';
      const expireStr = s.expireAt ? new Date(s.expireAt).toLocaleDateString('zh-CN') : '永久有效';
      return `<div class="sub-source-card">
        <div class="sub-source-info">
          <h4><span class="dot ${statusCls}" style="display:inline-block;margin-right:6px;"></span>${esc(s.title)}</h4>
          <p style="font-family:monospace;font-size:0.82rem;color:var(--accent);cursor:pointer;" onclick="copyText('${url}')" title="点击复制">${url}</p>
          <div class="sub-source-meta">
            <span>📡 ${(s.nodeIds || []).filter(id => !id.startsWith('sui_')).length + (s.suiBridges ? Object.values(s.suiBridges).reduce((sum, b) => sum + (b.inboundIds || []).length, 0) : (s.suiInboundIds || []).length)} 个节点</span>
            <span>📊 ${trafficStr}</span>
            <span>⏰ ${expireStr}</span>
            <span>📅 ${new Date(s.createdAt).toLocaleDateString('zh-CN')} 创建</span>
          </div>
        </div>
        <div class="sub-source-actions">
          <button class="btn btn-secondary btn-sm" onclick="showShareLinks('${s.token}','${esc(s.title)}')">📋 链接</button>
          <button class="btn btn-secondary btn-sm" onclick="openEditShare('${s.id}')">✏️ 编辑</button>
          <button class="btn btn-secondary btn-sm" onclick="showQR('${url}','${esc(s.title)}')">📱 二维码</button>
          <button class="btn btn-danger btn-sm" onclick="deleteShare('${s.id}')">🗑 删除</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) { toast('加载分享列表失败','error'); }
}

function formatBytes(b) {
  if (!b || b === 0) return '0';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
}

/**
 * s-ui 入站列表（动态从 bridge 获取，不再硬编码）
 */
let SUI_INBOUNDS = [];

/**
 * 从后端动态获取 s-ui 入站列表
 * NOTE: 每次打开分享弹窗时调用，确保与 s-ui 后台同步
 */
async function loadSuiInbounds() {
  try {
    const data = await api('/sui-inbounds');
    if (data.success && data.inbounds.length > 0) {
      SUI_INBOUNDS = data.inbounds.map(ib => ({
        id: ib.id, name: ib.tag || `inbound-${ib.id}`, type: ib.type,
        region: ib.region || 'jp', label: ib.label || '',
      }));
    }
  } catch (e) {
    console.error('获取 s-ui 入站失败:', e.message);
  }
}

/**
 * 生成 s-ui 入站选择区域 HTML（按 region 分组显示）
 * @param checkedMap 已勾选的入站，格式: { jp: [3,5], us: [2] } 或旧版 [id,...]
 */
function renderSuiInboundSelector(checkedMap, inputName = 'suiInbound', containerId = '') {
  if (SUI_INBOUNDS.length === 0) {
    return '<div style="margin-top:12px;padding:12px;background:var(--bg-input);border-radius:8px;color:var(--text-muted);font-size:0.85rem;">⚠️ 无法获取自建节点入站列表（bridge 不可用）</div>';
  }
  const regionFlags = { jp: '🇯🇵', hk: '🇭🇰', sg: '🇸🇬', us: '🇺🇸' };
  const regionLabels = { jp: '日本', hk: '香港', sg: '新加坡', us: '美国' };
  // NOTE: 兼容多种格式 — 旧版纯数组、新版 { region: [ids] }、suiBridgesData { region: { inboundIds, ... } }
  let checked = {};
  if (Array.isArray(checkedMap)) {
    checked = { jp: new Set(checkedMap) };
  } else if (checkedMap && typeof checkedMap === 'object') {
    for (const [r, val] of Object.entries(checkedMap)) {
      if (Array.isArray(val)) {
        checked[r] = new Set(val);
      } else if (val && val.inboundIds) {
        checked[r] = new Set(val.inboundIds);
      }
    }
  }
  const changeHandler = containerId ? ` onchange="onShareCheckChange('${containerId}');updateRegionConfigVisibility()"` : '';

  // 按 region 分组
  const groups = {};
  for (const ib of SUI_INBOUNDS) {
    if (!groups[ib.region]) groups[ib.region] = [];
    groups[ib.region].push(ib);
  }

  return Object.entries(groups).map(([region, inbounds]) => {
    const flag = regionFlags[region] || regionFlags[region.split('-')[0]] || '🌍';
    // NOTE: 优先使用 Bridge 返回的 label（如"日本徕卡云"），其次用硬编码映射
    const bridgeLabel = inbounds[0]?.label;
    const label = bridgeLabel || regionLabels[region] || regionLabels[region.split('-')[0]] || region.toUpperCase();
    const checkedSet = checked[region] || new Set();
    return `
    <div style="margin-top:6px;padding:8px 10px;background:var(--bg-input);border-radius:8px;border:1px solid var(--border-color);">
      <div style="font-weight:600;margin-bottom:4px;font-size:0.88em">${flag} ${label}自建节点</div>
      <p style="font-size:0.75rem;color:var(--text-muted);margin:0 0 4px;">
        勾选入站协议，保存后自动同步到${label} s-ui 服务器
      </p>
      ${inbounds.map(ib => `
        <label class="share-node-item sui-inbound-item" data-region="${region}">
          <input type="checkbox" name="${inputName}" value="${ib.id}" data-region="${region}" ${checkedSet.has(ib.id) ? 'checked' : ''}${changeHandler}>
          <span>${flag}</span>
          <span>${esc(ib.name)}</span>
          <span class="type-badge ${ib.type==='hysteria2'?'hy2':ib.type}" style="font-size:0.72rem;">${ib.type}</span>
        </label>`).join('')}
    </div>`;
  }).join('');
}

/**
 * 生成区域独立的 s-ui 配置行 HTML（流量 + 到期）
 * NOTE: 放在编辑/创建模态框的全局配置行下方
 * @param suiBridgesData 已有的区域配置
 * @param globalTrafficId 全局流量输入框 ID，用于自动求和
 */
function buildRegionConfigRows(suiBridgesData = {}, globalTrafficId = 'shareTraffic') {
  const regionFlags = { jp: '🇯🇵', hk: '🇭🇰', sg: '🇸🇬', us: '🇺🇸' };
  const regionLabels = { jp: '日本', hk: '香港', sg: '新加坡', us: '美国' };
  const regions = [...new Set(SUI_INBOUNDS.map(ib => ib.region))];
  if (regions.length === 0) return '';

  return regions.map(region => {
    const flag = regionFlags[region] || regionFlags[region.split('-')[0]] || '🌍';
    // NOTE: 优先从 SUI_INBOUNDS 获取 Bridge 的 label
    const bridgeLabel = SUI_INBOUNDS.find(ib => ib.region === region)?.label;
    const label = bridgeLabel || regionLabels[region] || regionLabels[region.split('-')[0]] || region.toUpperCase();
    const data = suiBridgesData[region] || {};
    // NOTE: trafficLimitGB === 0 表示无限，undefined 表示未设置
    const trafficVal = (data.trafficLimitGB && data.trafficLimitGB > 0) ? data.trafficLimitGB : '';
    let expireVal = '';
    if (data.expireAt) {
      expireVal = new Date(data.expireAt).toISOString().split('T')[0];
    }
    const trafficId = `regionTraffic_${region}`;
    const expireId = `regionExpire_${region}`;
    return `
    <div class="edit-share-form sui-region-config" data-region="${region}">
      <div class="form-group">
        <label>${flag} ${label} s-ui</label>
        <input class="form-input" disabled value="${label}自建节点配置" style="opacity:0.5;font-size:0.8rem;">
      </div>
      <div class="form-group">
        <label>📊 ${label}流量 (GB)</label>
        <div class="input-with-btn">
          <input class="form-input sui-region-traffic" id="${trafficId}" data-region="${region}" type="number" step="1" min="0" value="${trafficVal}" placeholder="不限"
            oninput="recalcGlobalTraffic('${globalTrafficId}')">
          <button type="button" class="btn-infinity" title="设为无限" onclick="document.getElementById('${trafficId}').value='';recalcGlobalTraffic('${globalTrafficId}');toast('${label}流量已设为无限','success')">♾️</button>
        </div>
      </div>
      <div class="form-group">
        <label>⏰ ${label}到期</label>
        <div class="input-with-btn">
          <input class="form-input sui-region-expire" id="${expireId}" data-region="${region}" type="date" value="${expireVal}">
          <button type="button" class="btn-infinity" title="设为永久" onclick="document.getElementById('${expireId}').value='';toast('${label}已设为永久有效','success')">♾️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/**
 * 根据底部入站勾选状态，动态显示/隐藏区域配置行
 * NOTE: 同时触发全局流量重算
 */
function updateRegionConfigVisibility() {
  const configs = document.querySelectorAll('.sui-region-config');
  for (const cfg of configs) {
    const region = cfg.dataset.region;
    const hasChecked = document.querySelector(`input[type=checkbox][data-region="${region}"]:checked`);
    cfg.style.display = hasChecked ? '' : 'none';
  }
  // NOTE: 尝试更新两个可能的全局流量输入框
  recalcGlobalTraffic('shareTraffic');
  recalcGlobalTraffic('editShareTraffic');
}

/**
 * 自动计算全局流量 = 各区域流量之和
 * NOTE: 无区域勾选时默认 100，有区域但全部无限时全局也设为无限
 */
function recalcGlobalTraffic(globalId) {
  const globalInput = document.getElementById(globalId);
  if (!globalInput) return;
  const configs = document.querySelectorAll('.sui-region-config');
  let total = 0;
  let hasVisible = false;
  let allUnlimited = true;
  for (const cfg of configs) {
    if (cfg.style.display === 'none') continue;
    hasVisible = true;
    const input = cfg.querySelector('.sui-region-traffic');
    const val = parseFloat(input?.value);
    if (val > 0) { total += val; allUnlimited = false; }
  }
  if (!hasVisible) {
    // 没有勾选任何自建区域，保持用户手动输入或默认 100
    if (!globalInput.value) globalInput.value = '100';
    return;
  }
  globalInput.value = allUnlimited ? '' : total;
}

let _shareNodes = [];
let _shareFilter = { sub: 'all', search: '' };

async function openCreateShare() {
  try {
    // NOTE: 并行加载节点、订阅源、s-ui 入站
    const [nodesData, subsData] = await Promise.all([api('/nodes'), api('/subscriptions'), loadSuiInbounds()]);
    _shareNodes = nodesData.nodes.filter(n => n.enabled !== false);
    _allSubs = subsData.subscriptions || [];

    document.getElementById('shareTitle').value = '';
    document.getElementById('shareTraffic').value = '100';
    document.getElementById('shareExpireDays').value = '30';
    // NOTE: 渲染区域独立的 s-ui 配置行（日本/美国流量+到期）
    document.getElementById('shareRegionConfigs').innerHTML = buildRegionConfigRows();
    // 默认全选节点，不勾选 s-ui 入站
    buildShareNodeSelector('shareNodeList', 'shareNode', _shareNodes, new Set(_shareNodes.map(n => n.id)), []);
    document.getElementById('shareModal').classList.add('active');
  } catch (e) { toast(e.message, 'error'); }
}

/**
 * 一次性构建节点选择器 DOM（不会再重渲染）
 * NOTE: 筛选/搜索只切换 display，不销毁/重建元素
 */
function buildShareNodeSelector(containerId, inputName, nodes, checkedSet, suiInboundIds = []) {
  const container = document.getElementById(containerId);
  const flags = {HK:'🇭🇰',JP:'🇯🇵',SG:'🇸🇬',US:'🇺🇸',TW:'🇹🇼',KR:'🇰🇷',UK:'🇬🇧',DE:'🇩🇪',AU:'🇦🇺',OTHER:'🌍'};

  // 构建订阅源选项
  const subOpts = _allSubs.map(s => `<option value="sub-${s.id}">${esc(s.name)} (${s.nodeCount||0})</option>`).join('');
  const manualCount = nodes.filter(n => n.group === 'manual').length;

  // 一次性生成所有节点（全部渲染到 DOM）
  const allNodeItems = nodes.map(n => `
    <label class="share-node-item" data-group="${n.group}" data-search="${esc(n.name)} ${n.server} ${n.region} ${n.type}">
      <input type="checkbox" name="${inputName}" value="${n.id}" ${checkedSet.has(n.id) ? 'checked' : ''} onchange="onShareCheckChange('${containerId}')">
      <span>${flags[n.region]||'🌍'}</span>
      <span class="share-node-name">${esc(n.name)}</span>
      <span class="type-badge ${n.type==='hysteria2'?'hy2':n.type}" style="font-size:0.72rem;">${n.type}</span>
    </label>
  `).join('');

  // NOTE: 传入已保存的 s-ui 入站 ID，编辑时能正确回显勾选状态
  const suiInputName = inputName === 'shareNode' ? 'suiInbound' : 'editSuiInbound';

  container.innerHTML = `
    <div class="share-node-toolbar">
      <select class="form-input share-node-filter" data-container="${containerId}" onchange="applyShareFilter('${containerId}')">
        <option value="all">全部 (${nodes.length})</option>
        <option value="manual">手动 (${manualCount})</option>
        ${subOpts}
      </select>
      <div class="share-node-search-wrap">
        <input class="form-input share-node-search" data-container="${containerId}" placeholder="🔍 搜索..." oninput="applyShareFilter('${containerId}')">
      </div>
      <div class="share-node-btns">
        <button type="button" class="btn btn-sm btn-xs" onclick="toggleVisibleShareNodes('${containerId}',true)">全选</button>
        <button type="button" class="btn btn-sm btn-xs" onclick="toggleVisibleShareNodes('${containerId}',false)">全不选</button>
        <span class="share-node-count">已选 <strong class="share-checked-count">${checkedSet.size}</strong></span>
      </div>
    </div>
    <div class="share-node-grid">${allNodeItems}</div>
    ${renderSuiInboundSelector(suiInboundIds, suiInputName, containerId)}
  `;
  // NOTE: 用实际 DOM 勾选数刷新计数，checkedSet 可能含不在列表中的 sui_ 节点
  onShareCheckChange(containerId);
  // NOTE: 根据已勾选的入站动态显示/隐藏区域配置行
  setTimeout(() => updateRegionConfigVisibility(), 0);
}

/**
 * 筛选/搜索 — 只切换 display，不重渲染 DOM
 * NOTE: 这样 IME 不会被打断，checkbox 选中状态不会丢失
 */
function applyShareFilter(containerId) {
  const container = document.getElementById(containerId);
  const filterEl = container.querySelector('.share-node-filter');
  const searchEl = container.querySelector('.share-node-search');
  const subVal = filterEl ? filterEl.value : 'all';
  const searchVal = searchEl ? searchEl.value.trim() : '';

  const items = container.querySelectorAll('.share-node-item');
  let visibleCount = 0;

  items.forEach(item => {
    const group = item.dataset.group;
    const searchText = item.dataset.search;
    let show = true;

    // 订阅源筛选
    if (subVal === 'manual' && group !== 'manual') show = false;
    else if (subVal.startsWith('sub-') && group !== subVal) show = false;

    // 搜索过滤
    if (show && searchVal && !fuzzyMatch(searchText, searchVal)) show = false;

    item.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });
}

/**
 * checkbox 状态变化 — 更新计数
 */
function onShareCheckChange(containerId) {
  const container = document.getElementById(containerId);
  // NOTE: 用 class 区分普通节点和 s-ui 入站，避免 name 大小写问题
  const nodeCount = [...container.querySelectorAll('.share-node-item:not(.sui-inbound-item) input:checked')].length;
  const suiCount = [...container.querySelectorAll('.sui-inbound-item input:checked')].length;
  const countEl = container.querySelector('.share-checked-count');
  if (countEl) countEl.textContent = nodeCount + suiCount;
}

/**
 * 全选/全不选 — 仅影响当前可见的节点
 */
function toggleVisibleShareNodes(containerId, checked) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.share-node-item').forEach(item => {
    if (item.style.display !== 'none') {
      const cb = item.querySelector('input[type=checkbox]');
      if (cb) cb.checked = checked;
    }
  });
  onShareCheckChange(containerId);
}

/**
 * 从容器中获取所有选中的节点 ID
 */
function getShareCheckedIds(containerId) {
  const container = document.getElementById(containerId);
  // NOTE: 用 :not(.sui-inbound-item) 排除 s-ui checkbox，避免 name 大小写问题
  return [...container.querySelectorAll('.share-node-item:not(.sui-inbound-item) input:checked')]
    .map(i => i.value);
}

async function submitShare() {
  const title = document.getElementById('shareTitle').value.trim();
  if (!title) return toast('请填写标题', 'error');
  const nodeIds = getShareCheckedIds('shareNodeList');
  // NOTE: 按 region 分组收集勾选的入站 ID
  const suiBridges = collectSuiBridges('suiInbound');
  const hasSui = Object.keys(suiBridges).length > 0;
  if (nodeIds.length === 0 && !hasSui) return toast('请至少选择一个节点或自建入站', 'error');
  const trafficLimitGB = parseFloat(document.getElementById('shareTraffic').value) || 0;
  const expireDays = parseInt(document.getElementById('shareExpireDays').value) || 0;

  try {
    const { share } = await api('/shares', {
      method: 'POST',
      body: JSON.stringify({
        title, nodeIds, trafficLimitGB,
        expireDays: expireDays || null,
        suiBridges: hasSui ? suiBridges : undefined,
      })
    });
    toast(`分享「${share.title}」创建成功`, 'success');
    closeModal('shareModal');
    loadShares();
    setTimeout(() => showShareLinks(share.token, share.title), 300);
  } catch (e) { toast(e.message, 'error'); }
}

/**
 * 按 region 分组收集勾选的入站 ID + 区域独立流量/到期
 * @returns { jp: { inboundIds: [3,5], trafficLimitGB: 100, expireAt: '...' }, us: { ... } }
 */
function collectSuiBridges(inputName) {
  const result = {};
  const checkedInputs = [...document.querySelectorAll(`input[name=${inputName}]:checked`)];
  for (const input of checkedInputs) {
    const region = input.dataset.region;
    if (!region) continue;
    if (!result[region]) result[region] = { inboundIds: [] };
    result[region].inboundIds.push(parseInt(input.value));
  }
  // NOTE: 收集每个区域的独立流量设置（空 = 0 = 无限）
  const trafficInputs = document.querySelectorAll('.sui-region-traffic');
  for (const input of trafficInputs) {
    const region = input.dataset.region;
    if (!region || !result[region]) continue;
    const val = parseFloat(input.value);
    result[region].trafficLimitGB = (val > 0) ? val : 0;
  }
  // NOTE: 收集每个区域的独立到期日期
  const expireInputs = document.querySelectorAll('.sui-region-expire');
  for (const input of expireInputs) {
    const region = input.dataset.region;
    if (!region || !result[region]) continue;
    if (input.value) {
      result[region].expireAt = new Date(input.value + 'T23:59:59').toISOString();
    }
  }
  return result;
}

function showShareLinks(token, title) {
  const host = window.location.origin;
  const targets = [
    {label:'Clash / Meta', target:'clash', icon:'⚡'},
    {label:'OpenClash (路由器)', target:'openclash', icon:'🌐'},
    {label:'V2Ray / Xray', target:'v2ray', icon:'🔷'},
    {label:'Shadowrocket', target:'shadowrocket', icon:'🚀'},
    {label:'Sing-box', target:'singbox', icon:'📦'},
    {label:'自动检测', target:'', icon:'🤖'},
  ];
  const links = targets.map(t => {
    // NOTE: URL fragment (#标题) 让 Shadowrocket 等客户端显示自定义订阅名
    const url = `${host}/s/${token}${t.target ? '?target=' + t.target : ''}#${encodeURIComponent(title)}`;
    return `<div class="sub-link-row">
      <span class="sub-link-label">${t.icon} ${t.label}</span>
      <span class="sub-link-url" title="${url}">${url}</span>
      <div class="sub-link-actions">
        <button class="btn btn-secondary btn-sm" onclick="showQR('${url}','${title} - ${t.label}')">📱</button>
        <button class="btn btn-secondary btn-sm" onclick="copyText('${url}')">复制</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('shareLinkTitle').textContent = `${title} - 订阅链接`;
  document.getElementById('shareLinkList').innerHTML = links;
  document.getElementById('shareLinkModal').classList.add('active');
}

async function deleteShare(id) {
  if (!confirm('确定删除此分享？')) return;
  try { await api(`/shares/${id}`, {method:'DELETE'}); toast('已删除','success'); loadShares(); }
  catch(e) { toast(e.message, 'error'); }
}

function toggleShareAll(checked) {
  document.querySelectorAll('input[name=shareNode]').forEach(i => i.checked = checked);
}

function toggleEditShareAll(checked) {
  document.querySelectorAll('input[name=editShareNode]').forEach(i => i.checked = checked);
}

let _editShareNodes = [];
let _editShareFilter = { sub: 'all', search: '' };

/**
 * 打开编辑分享 — 紧凑单页版
 * NOTE: 顶部一行基本配置+自建节点，下方节点选择器占满空间
 */
let _currentEditShareId = '';
let _currentNodeOverrides = {};
let _currentSuiOverrides = {};

async function openEditShare(shareId) {
  try {
    const [sharesData, nodesData, subsData] = await Promise.all([
      api('/shares'), api('/nodes'), api('/subscriptions'), loadSuiInbounds(),
    ]);
    _editShareNodes = nodesData.nodes;
    _allSubs = subsData.subscriptions || [];
    const share = sharesData.shares.find(s => s.id === shareId);
    if (!share) return toast('分享不存在', 'error');

    _currentEditShareId = shareId;
    _currentNodeOverrides = share.nodeOverrides ? JSON.parse(JSON.stringify(share.nodeOverrides)) : {};
    _currentSuiOverrides = share.suiNodeOverrides ? JSON.parse(JSON.stringify(share.suiNodeOverrides)) : {};

    const currentIds = new Set(share.nodeIds || []);
    const trafficGB = share.trafficLimit > 0 ? (share.trafficLimit / 1073741824).toFixed(1) : '';
    const expireDate = share.expireAt ? new Date(share.expireAt).toISOString().split('T')[0] : '';
    const suiBridgesData = share.suiBridges || (share.suiClientName ? { jp: { clientName: share.suiClientName, inboundIds: share.suiInboundIds || [] } } : {});
    const selectedNodes = _editShareNodes.filter(n => currentIds.has(n.id));
    const selectedSui = SUI_INBOUNDS.filter(ib => {
      const regionInfo = suiBridgesData[ib.region];
      return regionInfo && (regionInfo.inboundIds || []).includes(ib.id);
    });

    // 切换到编辑页面
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    document.getElementById('page-edit-share').classList.add('active');
    document.getElementById('pageTitle').textContent = `编辑 - ${share.title}`;
    document.getElementById('headerActions').innerHTML = `<button class="btn btn-primary btn-sm" onclick="submitEditShare('${shareId}')">💾 保存</button>`;

    const el = document.getElementById('edit-share-content');
    el.innerHTML = `
      <!-- 顶部：返回 + 基本配置（一行紧凑） -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="navigate('shares')">← 返回</button>
        <div style="display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap">
          <input class="form-input" id="editShareTitle" value="${esc(share.title)}" placeholder="标题" style="max-width:160px;font-size:0.85em">
          <div class="input-with-btn" style="max-width:140px">
            <input class="form-input" id="editShareTraffic" type="number" step="0.1" value="${trafficGB}" placeholder="流量GB" style="font-size:0.85em">
            <button type="button" class="btn-infinity" onclick="document.getElementById('editShareTraffic').value=''">♾️</button>
          </div>
          <div class="input-with-btn" style="max-width:160px">
            <input class="form-input" id="editShareExpire" type="date" value="${expireDate}" style="font-size:0.85em">
            <button type="button" class="btn-infinity" onclick="document.getElementById('editShareExpire').value=''">♾️</button>
          </div>
        </div>
      </div>

      <!-- 自建节点（可折叠，减少占用空间） -->
      ${SUI_INBOUNDS.length > 0 ? `
      <details open style="background:var(--card-bg);border-radius:10px;border:1px solid var(--border-color);margin-bottom:10px">
        <summary style="padding:8px 14px;cursor:pointer;font-weight:600;font-size:0.88em;user-select:none">
          🔗 自建节点（点击折叠/展开）
        </summary>
        <div style="padding:4px 14px 10px;display:flex;flex-wrap:wrap;gap:0">
          ${renderSuiInboundSelector(suiBridgesData, 'editSuiInbound', 'editShareNodeList')}
        </div>
      </details>` : ''}
      ${buildRegionConfigRows(suiBridgesData, 'editShareTraffic')}

      <!-- 节点选择器（占满剩余空间） -->
      <div id="editShareNodeList" class="share-node-list"></div>

      <!-- 底部保存 -->
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;padding-bottom:12px">
        <button class="btn btn-secondary" onclick="navigate('shares')">取消</button>
        <button class="btn btn-primary" onclick="submitEditShare('${shareId}')">💾 保存修改</button>
      </div>
    `;

    buildShareNodeSelector('editShareNodeList', 'editShareNode', _editShareNodes, currentIds, suiBridgesData);
  } catch (e) { toast(e.message, 'error'); }
}

/**
 * 测速指定节点（利用服务器网络）
 */
async function testShareNode(nodeId) {
  const row = document.getElementById('sel-node-' + nodeId);
  const btn = row?.querySelector('.node-actions button');
  if (btn) { btn.textContent = '⏳ 测速中...'; btn.disabled = true; }
  try {
    // NOTE: API 返回 { success, result: { tcp: { avgLatency } } }
    const data = await api(`/nodes/${nodeId}/test`, { method: 'POST' });
    const ms = data.result?.tcp?.avgLatency;
    if (btn) {
      btn.textContent = ms > 0 ? `✅ ${ms}ms` : '❌ 超时';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = '⚡ 测速'; }, 8000);
    }
  } catch (e) {
    if (btn) { btn.textContent = '❌ 失败'; btn.disabled = false; }
  }
}

/**
 * 编辑单个节点的覆盖配置（仅对此分享有效）
 */
function editShareNodeOverride(nodeId, shareId) {
  const node = _editShareNodes.find(n => n.id === nodeId);
  if (!node) return toast('节点不存在', 'error');

  // 合并原始节点数据和已有覆盖
  const ov = _currentNodeOverrides[nodeId] || {};
  const vals = { ...node, ...ov };

  let overrideModal = document.getElementById('nodeOverrideModal');
  if (!overrideModal) {
    overrideModal = document.createElement('div');
    overrideModal.id = 'nodeOverrideModal';
    overrideModal.className = 'modal-overlay';
    document.body.appendChild(overrideModal);
  }

  overrideModal.innerHTML = `
    <div class="modal" style="max-width:500px;width:90vw;">
      <div class="modal-header"><h3 style="margin:0;font-size:1rem;">✏️ 节点配置覆盖（仅此分享）</h3><button class="modal-close" onclick="closeModal('nodeOverrideModal')">✕</button></div>
      <div class="modal-body" style="padding:12px 16px;">
        <p style="font-size:0.78rem;color:var(--text-muted);margin:0 0 12px;">修改仅影响「${esc(node.name)}」在此分享链接的输出，不影响其他分享和节点管理</p>
        <div class="node-edit-form">
          <div class="form-group">
            <label>节点名称</label>
            <input class="form-input" id="ovName" value="${esc(vals.name)}" placeholder="${esc(node.name)}">
          </div>
          <div class="form-group">
            <label>节点类型</label>
            <input class="form-input" id="ovType" value="${vals.type}" readonly style="opacity:0.6;">
          </div>
          <div class="form-group">
            <label>服务器地址</label>
            <input class="form-input" id="ovServer" value="${esc(vals.server||'')}" placeholder="IP 或域名">
          </div>
          <div class="form-group">
            <label>端口</label>
            <input class="form-input" id="ovPort" type="number" value="${vals.port||''}" placeholder="端口">
          </div>
          <div class="form-group">
            <label>UUID / 密码</label>
            <input class="form-input" id="ovPassword" value="${esc(vals.uuid||vals.password||'')}" placeholder="认证凭据">
          </div>
          <div class="form-group">
            <label>SNI / Host</label>
            <input class="form-input" id="ovSni" value="${esc(vals.sni||vals.host||'')}" placeholder="TLS SNI">
          </div>
          <div class="form-group full-width" style="margin-top:4px;">
            <button class="btn btn-secondary btn-sm" onclick="clearNodeOverride('${nodeId}')">🔄 恢复默认</button>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="padding:8px 16px;">
        <button class="btn btn-secondary" onclick="closeModal('nodeOverrideModal')">取消</button>
        <button class="btn btn-primary" onclick="saveNodeOverride('${nodeId}')">确认覆盖</button>
      </div>
    </div>`;
  overrideModal.classList.add('active');
}

/**
 * 保存节点覆盖配置到内存（最终随 submitEditShare 一起提交）
 */
function saveNodeOverride(nodeId) {
  const node = _editShareNodes.find(n => n.id === nodeId);
  const override = {};
  const name = document.getElementById('ovName').value.trim();
  const server = document.getElementById('ovServer').value.trim();
  const port = parseInt(document.getElementById('ovPort').value);
  const password = document.getElementById('ovPassword').value.trim();
  const sni = document.getElementById('ovSni').value.trim();

  // NOTE: 只记录与原始值不同的字段
  if (name && name !== node.name) override.name = name;
  if (server && server !== node.server) override.server = server;
  if (port && port !== node.port) override.port = port;
  if (password && password !== (node.uuid || node.password)) {
    if (node.uuid) override.uuid = password;
    else override.password = password;
  }
  if (sni && sni !== (node.sni || node.host)) {
    if (node.sni !== undefined) override.sni = sni;
    else override.host = sni;
  }

  if (Object.keys(override).length > 0) {
    _currentNodeOverrides[nodeId] = { ...(_currentNodeOverrides[nodeId] || {}), ...override };
    // 更新已选节点的显示名称
    const nameEl = document.querySelector(`#sel-node-${nodeId} .node-name`);
    if (nameEl) nameEl.innerHTML = `${esc(override.name || node.name)} <span style="color:var(--accent);font-size:0.7rem;">已定制</span>`;
    toast('覆盖配置已暂存（保存分享后生效）', 'success');
  } else {
    delete _currentNodeOverrides[nodeId];
    toast('无变更', 'info');
  }
  closeModal('nodeOverrideModal');
}

/**
 * 清除节点覆盖，恢复默认
 */
function clearNodeOverride(nodeId) {
  delete _currentNodeOverrides[nodeId];
  const node = _editShareNodes.find(n => n.id === nodeId);
  const nameEl = document.querySelector(`#sel-node-${nodeId} .node-name`);
  if (nameEl && node) nameEl.textContent = node.name;
  toast('已恢复默认配置', 'success');
  closeModal('nodeOverrideModal');
}

/**
 * 编辑自建节点覆盖（名称/端口/服务器）
 * NOTE: 仅在本条订阅链接有效，不影响其他分享
 */
function editSuiNodeOverride(region, inboundId, shareId) {
  const ovKey = `${region}_${inboundId}`;
  const ov = _currentSuiOverrides[ovKey] || {};
  const ib = SUI_INBOUNDS.find(i => i.id === inboundId && i.region === region);
  const origName = ib ? ib.name : `inbound-${inboundId}`;
  const regionLabels = { jp: '日本', us: '美国', hk: '香港', sg: '新加坡' };
  const regionLabel = regionLabels[region] || region;

  let modal = document.getElementById('suiOverrideModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'suiOverrideModal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-header"><h3>编辑自建节点 - ${regionLabel}</h3><button class="modal-close" onclick="closeModal('suiOverrideModal')">✕</button></div>
      <div class="modal-body">
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:12px;">修改仅对本条分享链接生效，不影响其他订阅</p>
        <div class="node-edit-form">
          <div class="form-group">
            <label>节点名称</label>
            <input class="form-input" id="suiOvName" value="${esc(ov.name || origName)}" placeholder="${esc(origName)}">
          </div>
          <div class="form-group">
            <label>端口</label>
            <input class="form-input" id="suiOvPort" type="number" value="${ov.port || ''}" placeholder="留空=默认">
          </div>
          <div class="form-group">
            <label>服务器地址</label>
            <input class="form-input" id="suiOvServer" value="${esc(ov.server || '')}" placeholder="留空=默认">
          </div>
          <div class="form-group">
            <label>SNI</label>
            <input class="form-input" id="suiOvSni" value="${esc(ov.sni || '')}" placeholder="留空=默认">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" onclick="clearSuiOverride('${ovKey}')">🔄 恢复默认</button>
        <button class="btn btn-secondary" onclick="closeModal('suiOverrideModal')">取消</button>
        <button class="btn btn-primary" onclick="saveSuiOverride('${ovKey}')">💾 保存</button>
      </div>
    </div>`;
  modal.classList.add('active');
}

function saveSuiOverride(ovKey) {
  const override = {};
  const name = document.getElementById('suiOvName').value.trim();
  const port = document.getElementById('suiOvPort').value.trim();
  const server = document.getElementById('suiOvServer').value.trim();
  const sni = document.getElementById('suiOvSni').value.trim();
  if (name) override.name = name;
  if (port) override.port = parseInt(port);
  if (server) override.server = server;
  if (sni) override.sni = sni;
  if (Object.keys(override).length > 0) {
    _currentSuiOverrides[ovKey] = override;
    toast('自建节点已定制（保存分享后生效）', 'success');
  }
  closeModal('suiOverrideModal');
}

function clearSuiOverride(ovKey) {
  delete _currentSuiOverrides[ovKey];
  toast('已恢复默认配置', 'success');
  closeModal('suiOverrideModal');
}

/**
 * 提交编辑分享（标题/流量/到期 + 节点 + s-ui + nodeOverrides）
 */
async function submitEditShare(shareId) {
  const nodeIds = getShareCheckedIds('editShareNodeList');
  // NOTE: 按 region 分组收集勾选的入站
  const suiBridges = collectSuiBridges('editSuiInbound');
  const title = document.getElementById('editShareTitle').value.trim();
  const trafficVal = document.getElementById('editShareTraffic').value;
  const expireDate = document.getElementById('editShareExpire').value;

  const hasSui = Object.keys(suiBridges).length > 0;
  if (nodeIds.length === 0 && !hasSui) return toast('请至少选择一个节点', 'error');
  if (!title) return toast('请填写标题', 'error');

  const trafficLimitGB = trafficVal === '' ? 0 : parseFloat(trafficVal) || 0;

  try {
    await api(`/shares/${shareId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title,
        nodeIds,
        suiBridges,
        trafficLimitGB,
        expireAt: expireDate ? new Date(expireDate + 'T23:59:59').toISOString() : null,
        nodeOverrides: Object.keys(_currentNodeOverrides).length > 0 ? _currentNodeOverrides : undefined,
        suiNodeOverrides: Object.keys(_currentSuiOverrides).length > 0 ? _currentSuiOverrides : undefined,
      })
    });
    toast('分享已更新', 'success');
    navigate('shares');
    loadShares();
  } catch (e) { toast(e.message, 'error'); }
}


// ---- Utils ----
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function copyText(t) { navigator.clipboard.writeText(t).then(()=>toast('已复制','success'),()=>{ const a=document.createElement('textarea'); a.value=t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); toast('已复制','success'); }); }
function esc(s) { const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function toggleMobileMenu() { document.querySelector('.sidebar').classList.toggle('open'); }

// ==================== Bridge 管理 ====================

/**
 * 加载并展示 Bridge 列表
 * NOTE: 卡片式展示，每个 Bridge 为独立视觉单元
 */
async function loadBridges() {
  const el = document.getElementById('bridges-content');
  el.innerHTML = '<div class="empty-state"><div class="icon" style="animation:pulse 1.5s infinite">⏳</div><p>加载中...</p></div>';
  try {
    const { bridges } = await api('/bridges');
    if (bridges.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="icon" style="font-size:3em">🔗</div>
          <h3 style="margin-top:12px">暂无 Bridge 连接</h3>
          <p style="opacity:0.6;margin-bottom:20px">Bridge 用于连接自建节点服务器的 S-UI，实现按用户精确追踪流量</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="openAddBridge()">➕ 手动添加</button>
            <button class="btn btn-secondary" onclick="openJsonImport()">📋 JSON 导入</button>
          </div>
        </div>`;
      return;
    }

    const regionEmoji = (r) => {
      const code = (r || '').split('-')[0].toLowerCase();
      const map = {jp:'🇯🇵',us:'🇺🇸',hk:'🇭🇰',sg:'🇸🇬',tw:'🇹🇼',kr:'🇰🇷',de:'🇩🇪',gb:'🇬🇧',fr:'🇫🇷',nl:'🇳🇱',au:'🇦🇺',ca:'🇨🇦',in:'🇮🇳',ru:'🇷🇺',tr:'🇹🇷'};
      return map[code] || '🌐';
    };

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="openAddBridge()">➕ 添加</button>
          <button class="btn btn-secondary" onclick="openJsonImport()">📋 JSON 导入</button>
        </div>
        <button class="btn btn-secondary" onclick="testAllBridges()" id="testAllBtn">🔄 全部测试</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">`;

    for (const b of bridges) {
      const isOnline = b.status === 'online';
      const borderColor = isOnline ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.3)';
      const glowColor = isOnline ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.1)';
      const statusText = isOnline ? '在线' : '离线';
      const statusColor = isOnline ? '#22c55e' : '#ef4444';
      const latencyText = isOnline ? `${b.latency}ms` : '-';
      const latencyColor = isOnline ? (b.latency < 200 ? '#22c55e' : b.latency < 500 ? '#f59e0b' : '#ef4444') : '#666';
      const emoji = regionEmoji(b.region);

      html += `
      <div class="bridge-card" id="bridge-${b.id}" style="
        background:var(--card-bg);border:1px solid ${borderColor};border-radius:14px;
        padding:20px;position:relative;overflow:hidden;
        box-shadow:0 4px 24px ${glowColor};
        transition:all 0.3s ease;cursor:default;
      " onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 32px ${glowColor}'"
         onmouseleave="this.style.transform='';this.style.boxShadow='0 4px 24px ${glowColor}'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.8em">${emoji}</span>
            <div>
              <div style="font-weight:700;font-size:1.05em">${esc(b.label)}</div>
              <div style="font-size:0.78em;opacity:0.5;font-family:monospace">${esc(b.region)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};
              box-shadow:0 0 8px ${statusColor};display:inline-block;
              ${isOnline ? 'animation:bridgePulse 2s infinite' : ''}"></span>
            <span style="font-size:0.75em;color:${statusColor};font-weight:600">${statusText}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:var(--bg-color);border-radius:8px;padding:8px 12px;text-align:center">
            <div style="font-size:0.68em;opacity:0.5;margin-bottom:2px">延迟</div>
            <div style="font-weight:700;color:${latencyColor}">${latencyText}</div>
          </div>
          <div style="background:var(--bg-color);border-radius:8px;padding:8px 12px;text-align:center">
            <div style="font-size:0.68em;opacity:0.5;margin-bottom:2px">客户端</div>
            <div style="font-weight:700">${b.clients ?? '-'}</div>
          </div>
        </div>
        <div style="font-size:0.78em;opacity:0.6;font-family:monospace;margin-bottom:14px;
          background:var(--bg-color);padding:6px 10px;border-radius:6px;word-break:break-all">
          ${esc(b.hostname)}:${b.port}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" style="flex:1" onclick="testBridge('${b.id}')">🔍 测试</button>
          <button class="btn btn-sm btn-secondary" onclick="copyBridgeJson('${b.id}')" title="复制配置">📋</button>
          <button class="btn btn-sm btn-danger" onclick="deleteBridge('${b.id}','${esc(b.label)}')">🗑</button>
        </div>
      </div>`;
    }
    html += '</div>';
    if (!document.getElementById('bridge-pulse-style')) {
      const style = document.createElement('style');
      style.id = 'bridge-pulse-style';
      style.textContent = '@keyframes bridgePulse{0%,100%{opacity:1;box-shadow:0 0 8px currentColor}50%{opacity:0.4;box-shadow:0 0 4px currentColor}}';
      document.head.appendChild(style);
    }
    el.innerHTML = html;
    window._bridgesData = bridges;
  } catch (e) { el.innerHTML = `<div class="empty-state"><p>加载失败: ${esc(e.message)}</p></div>`; }
}

/** 打开添加 Bridge 弹窗 */
function openAddBridge() {
  // 动态创建弹窗
  let modal = document.getElementById('bridgeModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bridgeModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <h3>添加 Bridge</h3>
          <button class="modal-close" onclick="closeModal('bridgeModal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="info-card" style="margin-bottom:16px;padding:12px;border-radius:8px;">
            <p style="margin:0;font-size:0.85em;opacity:0.8;">📌 请先在目标服务器运行一键部署脚本：</p>
            <code style="display:block;margin-top:6px;padding:8px;border-radius:6px;font-size:0.8em;word-break:break-all;cursor:pointer;" onclick="copyText(this.textContent)">bash <(curl -sL https://raw.githubusercontent.com/xyf0104/subhub/main/sui-bridge/install_bridge.sh)</code>
          </div>
          <form id="bridgeForm" onsubmit="submitBridge(event)">
            <div class="form-group">
              <label>区域标识 *</label>
              <input class="form-input" id="bridgeRegion" placeholder="如: sg / hk / kr (英文小写)" required>
            </div>
            <div class="form-group">
              <label>显示名称 *</label>
              <input class="form-input" id="bridgeLabel" placeholder="如: 新加坡 / 香港 / 韩国" required>
            </div>
            <div class="form-group">
              <label>服务器地址 *</label>
              <input class="form-input" id="bridgeHost" placeholder="IP 或域名，如: 1.2.3.4" required>
            </div>
            <div class="form-group">
              <label>端口</label>
              <input class="form-input" id="bridgePort" type="number" value="9876" placeholder="默认 9876">
            </div>
            <div class="form-group">
              <label>通信密钥 *</label>
              <input class="form-input" id="bridgeToken" placeholder="部署脚本输出的 Bridge 密钥" required>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" onclick="closeModal('bridgeModal')">取消</button>
              <button type="submit" class="btn btn-primary" id="bridgeSubmitBtn">添加并测试连接</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  // 清空表单
  document.getElementById('bridgeRegion').value = '';
  document.getElementById('bridgeLabel').value = '';
  document.getElementById('bridgeHost').value = '';
  document.getElementById('bridgePort').value = '9876';
  document.getElementById('bridgeToken').value = '';
  modal.classList.add('active');
}

/** 提交添加 Bridge */
async function submitBridge(e) {
  e.preventDefault();
  const btn = document.getElementById('bridgeSubmitBtn');
  btn.disabled = true;
  btn.textContent = '连接测试中...';
  try {
    const data = {
      region: document.getElementById('bridgeRegion').value.trim().toLowerCase(),
      label: document.getElementById('bridgeLabel').value.trim(),
      hostname: document.getElementById('bridgeHost').value.trim(),
      port: parseInt(document.getElementById('bridgePort').value) || 9876,
      token: document.getElementById('bridgeToken').value.trim(),
    };
    const result = await api('/bridges', { method: 'POST', body: JSON.stringify(data) });
    toast(`Bridge "${data.label}" 添加成功 (${result.test.latency}ms)`, 'success');
    closeModal('bridgeModal');
    loadBridges();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '添加并测试连接';
  }
}

/** 测试 Bridge 连接 */
async function testBridge(bridgeId) {
  toast('测试连接中...', 'info');
  try {
    const result = await api(`/bridges/${bridgeId}/test`, { method: 'POST' });
    if (result.success) {
      toast(`连接正常 | 延迟: ${result.latency}ms | 客户端: ${result.clients}`, 'success');
    } else {
      toast(`连接失败: ${result.error}`, 'error');
    }
  } catch (e) { toast(e.message, 'error'); }
}

/** 删除 Bridge */
async function deleteBridge(bridgeId, label) {
  if (!confirm(`确定删除 Bridge "${label}"？\n\n注意：删除后该区域的自建节点将无法在分享中使用。`)) return;
  try {
    await api(`/bridges/${bridgeId}`, { method: 'DELETE' });
    toast(`Bridge "${label}" 已删除`, 'success');
    loadBridges();
  } catch (e) { toast(e.message, 'error'); }
}

/**
 * 复制 Bridge 的 JSON 配置
 * NOTE: 方便用户备份或迁移 Bridge 配置
 */
function copyBridgeJson(bridgeId) {
  const b = (window._bridgesData || []).find(x => x.id === bridgeId);
  if (!b) { toast('未找到配置', 'error'); return; }
  const json = JSON.stringify({
    region: b.region, label: b.label,
    hostname: b.hostname, port: b.port, token: b.token
  });
  copyText(json);
}

/**
 * 全部测试 Bridge
 */
async function testAllBridges() {
  const btn = document.getElementById('testAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 测试中...'; }
  toast('正在测试所有 Bridge...', 'info');
  try {
    await loadBridges();
    toast('全部测试完成', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🔄 全部测试'; } }
}

/**
 * 打开 JSON 导入弹窗
 * NOTE: 支持粘贴单个 JSON 或 JSON 数组批量导入
 */
function openJsonImport() {
  let modal = document.getElementById('jsonImportModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'jsonImportModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <div class="modal-header">
          <h3>📋 JSON 快速导入</h3>
          <button class="modal-close" onclick="closeModal('jsonImportModal')">✕</button>
        </div>
        <div class="modal-body">
          <div class="info-card" style="margin-bottom:16px;padding:12px;border-radius:8px;">
            <p style="margin:0;font-size:0.82em;opacity:0.7;">
              粘贴安装脚本输出的 JSON 配置，支持单个或数组格式：
            </p>
            <code style="display:block;margin-top:8px;padding:8px;border-radius:6px;font-size:0.75em;word-break:break-all;opacity:0.6;">
              {"region":"jp-xx","label":"日本","hostname":"1.2.3.4","port":9876,"token":"subhub_bridge_xxx"}
            </code>
          </div>
          <div class="form-group">
            <label>JSON 配置</label>
            <textarea class="form-input" id="jsonImportInput" rows="5" 
              placeholder='粘贴 JSON 配置...'
              style="font-family:monospace;font-size:0.85em;resize:vertical;"></textarea>
          </div>
          <div id="jsonPreview" style="display:none;margin-bottom:12px;"></div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeModal('jsonImportModal')">取消</button>
            <button type="button" class="btn btn-primary" id="jsonImportBtn" onclick="submitJsonImport()">🚀 导入并测试</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // 粘贴时自动解析预览
    document.getElementById('jsonImportInput').addEventListener('input', previewJsonImport);
  }
  document.getElementById('jsonImportInput').value = '';
  document.getElementById('jsonPreview').style.display = 'none';
  modal.classList.add('active');
  setTimeout(() => document.getElementById('jsonImportInput').focus(), 100);
}

/**
 * 预览粘贴的 JSON
 */
function previewJsonImport() {
  const input = document.getElementById('jsonImportInput').value.trim();
  const preview = document.getElementById('jsonPreview');
  if (!input) { preview.style.display = 'none'; return; }
  try {
    let items = JSON.parse(input);
    if (!Array.isArray(items)) items = [items];
    const valid = items.filter(i => i.hostname && i.token && !i.token.includes('*'));
    if (valid.length === 0) { 
      preview.innerHTML = '<div style="color:#ef4444;font-size:0.85em;padding:8px;background:rgba(239,68,68,0.1);border-radius:8px">⚠️ 未找到有效配置（需要 hostname 和完整 token，token 不能含 * 号）</div>';
      preview.style.display = 'block';
      return;
    }
    let html = '<div style="font-size:0.85em;padding:10px;background:var(--bg-color);border-radius:8px">';
    html += `<div style="margin-bottom:6px;font-weight:600;color:#22c55e">✅ 识别到 ${valid.length} 个 Bridge：</div>`;
    for (const v of valid) {
      html += `<div style="padding:4px 0;opacity:0.8">• <strong>${esc(v.label || v.region || '未知')}</strong> — ${esc(v.hostname)}:${v.port || 9876}</div>`;
    }
    html += '</div>';
    preview.innerHTML = html;
    preview.style.display = 'block';
  } catch {
    preview.innerHTML = '<div style="color:#ef4444;font-size:0.85em;padding:8px;background:rgba(239,68,68,0.1);border-radius:8px">⚠️ JSON 格式错误，请检查</div>';
    preview.style.display = 'block';
  }
}

/**
 * 提交 JSON 导入
 * NOTE: 支持批量导入多个 Bridge
 */
async function submitJsonImport() {
  const input = document.getElementById('jsonImportInput').value.trim();
  const btn = document.getElementById('jsonImportBtn');
  if (!input) { toast('请粘贴 JSON 配置', 'error'); return; }
  
  let items;
  try {
    items = JSON.parse(input);
    if (!Array.isArray(items)) items = [items];
  } catch { toast('JSON 格式错误', 'error'); return; }

  const valid = items.filter(i => i.hostname && i.token && !i.token.includes('*'));
  if (valid.length === 0) { toast('未找到有效配置（token 不能包含 * 号）', 'error'); return; }

  btn.disabled = true;
  btn.textContent = '⏳ 导入中...';
  let success = 0, fail = 0;

  for (const item of valid) {
    try {
      const data = {
        region: (item.region || 'custom').trim().toLowerCase(),
        label: (item.label || item.region || '未知').trim(),
        hostname: item.hostname.trim(),
        port: parseInt(item.port) || 9876,
        token: item.token.trim(),
      };
      await api('/bridges', { method: 'POST', body: JSON.stringify(data) });
      success++;
    } catch { fail++; }
  }

  btn.disabled = false;
  btn.textContent = '🚀 导入并测试';
  
  if (success > 0) {
    toast(`成功导入 ${success} 个 Bridge${fail > 0 ? `，${fail} 个失败` : ''}`, success > 0 ? 'success' : 'error');
    closeModal('jsonImportModal');
    loadBridges();
  } else {
    toast(`导入失败：${fail} 个 Bridge 添加失败`, 'error');
  }
}


// ---- 日夜模式 ----
function initTheme() {
  const saved = localStorage.getItem('subhub-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('subhub-theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

// 页面加载前立即应用主题，避免白屏闪烁
initTheme();

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  document.querySelectorAll('.nav-item').forEach(i => i.addEventListener('click', () => navigate(i.dataset.page)));
});
