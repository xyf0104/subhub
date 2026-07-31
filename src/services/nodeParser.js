/**
 * nodeParser.js - Parse proxy share URIs into internal node format
 * Supports: Hysteria 2, VLESS, VMess, Trojan, Shadowsocks, TUIC
 */

const { randomUUID } = require('crypto');

/**
 * Internal node format:
 * {
 *   id, name, type, server, port, enabled, region, group, createdAt,
 *   // Auth
 *   password, uuid, alterId, cipher,
 *   // TLS
 *   tls, skipCertVerify, sni, alpn, fingerprint,
 *   // Transport
 *   network, wsPath, wsHost, grpcServiceName, httpPath,
 *   // Protocol-specific
 *   flow, realityPublicKey, realityShortId,
 *   obfs, obfsPassword, up, down,
 *   congestionControl, udpRelayMode, reduceTtt
 * }
 */

function createBaseNode() {
  return {
    id: randomUUID(),
    name: '',
    type: '',
    server: '',
    port: 443,
    enabled: true,
    region: '',
    group: 'manual',
    createdAt: new Date().toISOString(),
    // Auth
    password: '',
    uuid: '',
    alterId: 0,
    cipher: 'auto',
    // TLS
    tls: true,
    skipCertVerify: false,
    sni: '',
    alpn: [],
    fingerprint: '',
    // Transport
    network: 'tcp',
    wsPath: '',
    wsHost: '',
    grpcServiceName: '',
    httpPath: '',
    // VLESS specific
    flow: '',
    realityPublicKey: '',
    realityShortId: '',
    // Hysteria 2 specific
    obfs: '',
    obfsPassword: '',
    up: '',
    down: '',
    // TUIC specific
    congestionControl: 'bbr',
    udpRelayMode: 'native',
    reduceRtt: true
  };
}

function detectRegion(name, server) {
  const text = (name + ' ' + server).toLowerCase();
  // NOTE: 按匹配优先级排列，长关键词优先避免误匹配（如 'in' 不会匹配到其他词）
  const regionMap = {
    'HK': ['hongkong', 'hong kong', '香港', 'hk', '港'],
    'JP': ['japan', 'tokyo', '日本', '东京', '大阪', 'jp', 'osaka'],
    'SG': ['singapore', '新加坡', '狮城', 'sg'],
    'US': ['united states', 'america', '美国', 'los angeles', 'san jose', 'new york', 'seattle', 'dallas', 'chicago', 'miami', 'silicon', 'virginia', 'usa', 'us'],
    'TW': ['taiwan', '台湾', '台北', 'tw'],
    'KR': ['korea', '韩国', '首尔', 'seoul', 'kr'],
    'UK': ['united kingdom', 'london', '英国', 'uk', 'gb', '伦敦'],
    'DE': ['germany', 'frankfurt', '德国', 'de', '法兰克福'],
    'AU': ['australia', '澳大利亚', '澳洲', 'sydney', 'au', '悉尼'],
    'IN': ['india', 'mumbai', '印度', 'bangalore', 'chennai'],
    'CA': ['canada', '加拿大', 'toronto', 'vancouver', 'montreal'],
    'FR': ['france', 'paris', '法国', 'fr', '巴黎'],
    'NL': ['netherlands', '荷兰', 'amsterdam', 'nl', '阿姆斯特丹'],
    'RU': ['russia', '俄罗斯', 'moscow', 'ru', '莫斯科'],
    // NOTE: 南美洲
    'AR': ['argentina', '阿根廷', 'buenos aires'],
    'BR': ['brazil', '巴西', 'sao paulo', 'br'],
    'CL': ['chile', '智利'],
    'CO': ['colombia', '哥伦比亚'],
    'UY': ['uruguay', '乌拉圭'],
    'PE': ['peru', '秘鲁'],
    'MX': ['mexico', '墨西哥'],
    'EC': ['ecuador', '厄瓜多尔'],
    // NOTE: 东南亚
    'TH': ['thailand', '泰国', 'bangkok', '曼谷'],
    'VN': ['vietnam', '越南', 'ho chi minh'],
    'PH': ['philippines', '菲律宾', 'manila'],
    'MY': ['malaysia', '马来西亚', 'kuala lumpur'],
    'ID': ['indonesia', '印尼', '印度尼西亚', 'jakarta'],
    // NOTE: 中东/非洲
    'TR': ['turkey', '土耳其', 'istanbul', 'türkiye', 'turkiye'],
    'AE': ['emirates', '阿联酋', 'dubai', '迪拜'],
    'IL': ['israel', '以色列'],
    'ZA': ['south africa', '南非', 'johannesburg'],
    // NOTE: 欧洲其他
    'IT': ['italy', '意大利', 'milan', 'rome'],
    'ES': ['spain', '西班牙', 'madrid'],
    'SE': ['sweden', '瑞典', 'stockholm'],
    'CH': ['switzerland', '瑞士', 'zurich'],
    'PL': ['poland', '波兰', 'warsaw'],
    'IE': ['ireland', '爱尔兰', 'dublin'],
    'PT': ['portugal', '葡萄牙', 'lisbon'],
    'FI': ['finland', '芬兰', 'helsinki'],
    'NO': ['norway', '挪威', 'oslo'],
    'DK': ['denmark', '丹麦'],
    'AT': ['austria', '奥地利', 'vienna'],
    'BE': ['belgium', '比利时', 'brussels'],
    'CZ': ['czech', '捷克', 'prague'],
    'RO': ['romania', '罗马尼亚'],
    'HU': ['hungary', '匈牙利', 'budapest'],
    'BG': ['bulgaria', '保加利亚'],
    'LU': ['luxembourg', '卢森堡'],
    // NOTE: 其他亚洲
    'KZ': ['kazakhstan', '哈萨克斯坦'],
    'PK': ['pakistan', '巴基斯坦'],
    'BD': ['bangladesh', '孟加拉'],
  };

  // NOTE: 先检测 emoji 国旗（最可靠），格式为两个 regional indicator symbols
  const flagMatch = name.match(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/);
  if (flagMatch) {
    const flag = flagMatch[0];
    const c1 = flag.codePointAt(0) - 0x1F1E6 + 65;
    const c2 = flag.codePointAt(2) - 0x1F1E6 + 65;
    const code = String.fromCharCode(c1) + String.fromCharCode(c2);
    // 验证是否是已知地区码
    if (regionMap[code]) return code;
    // 未知但有效的国旗码也返回
    return code;
  }

  for (const [code, keywords] of Object.entries(regionMap)) {
    for (const kw of keywords) {
      // NOTE: 对两字符的关键词使用词边界匹配，避免 'in' 匹配到 'china' 等
      if (kw.length <= 2) {
        const regex = new RegExp(`(?:^|[^a-z])${kw}(?:$|[^a-z])`);
        if (regex.test(text)) return code;
      } else {
        if (text.includes(kw)) return code;
      }
    }
  }
  return 'OTHER';
}

/**
 * Parse a Hysteria 2 URI: hy2://password@host:port?params#name
 */
function parseHysteria2(uri) {
  const node = createBaseNode();
  node.type = 'hysteria2';

  // Remove scheme
  let rest = uri.replace(/^hy2:\/\/|^hysteria2:\/\//, '');

  // Extract fragment (name)
  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  // Extract query params
  const qIdx = rest.indexOf('?');
  let params = {};
  if (qIdx !== -1) {
    const qs = rest.substring(qIdx + 1);
    params = Object.fromEntries(new URLSearchParams(qs));
    rest = rest.substring(0, qIdx);
  }

  // Extract auth@host:port
  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    node.password = decodeURIComponent(rest.substring(0, atIdx));
    const hostPort = rest.substring(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    } else {
      node.server = hostPort;
    }
  }

  // Apply params
  node.sni = params.sni || params.peer || node.server;
  node.skipCertVerify = params.insecure === '1';
  if (params.obfs) {
    node.obfs = params.obfs;
    node.obfsPassword = params['obfs-password'] || '';
  }
  if (params.alpn) node.alpn = params.alpn.split(',');
  // NOTE: s-ui 用 upmbps/downmbps，其他客户端用 up/down
  if (params.up || params.upmbps) node.up = params.up || params.upmbps;
  if (params.down || params.downmbps) node.down = params.down || params.downmbps;

  if (!node.name) node.name = `HY2-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a VLESS URI，支持两种格式：
 * 1. 标准格式: vless://uuid@host:port?params#name
 * 2. Shadowrocket 格式: vless://base64(auto:uuid@host:port)?remark=xxx&xtls=2&sni=xxx
 * NOTE: 飞兔云等机场使用 Shadowrocket 格式，需先检测 Base64 编码并解码
 */
function parseVLESS(uri) {
  const node = createBaseNode();
  node.type = 'vless';
  node.cipher = 'none';

  let rest = uri.replace(/^vless:\/\//, '');

  // NOTE: 先提取查询参数（两种格式共用）
  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  const qIdx = rest.indexOf('?');
  let params = {};
  if (qIdx !== -1) {
    const qs = rest.substring(qIdx + 1);
    params = Object.fromEntries(new URLSearchParams(qs));
    rest = rest.substring(0, qIdx);
  }

  // NOTE: 检测 Shadowrocket Base64 格式 — 特征是 rest 部分是有效 Base64 且不含 @
  // 标准格式的 rest 一定含 @（uuid@host:port），而 Shadowrocket 格式 rest 是纯 Base64
  let isShadowrocket = false;
  if (!rest.includes('@') || (rest.match(/^[A-Za-z0-9+/=]+$/) && rest.length > 20)) {
    try {
      const decoded = Buffer.from(rest, 'base64').toString();
      // Shadowrocket 解码后格式: auto:uuid@host:port 或 uuid@host:port
      if (decoded.includes('@') && decoded.includes(':')) {
        isShadowrocket = true;
        rest = decoded;
      }
    } catch {
      // 不是 Base64，走标准解析
    }
  }

  // 解析 uuid@host:port（可能带 auto: 前缀）
  if (isShadowrocket) {
    // 去掉 "auto:" 前缀
    rest = rest.replace(/^auto:/, '');
  }

  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    node.uuid = rest.substring(0, atIdx);
    const hostPort = rest.substring(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    } else {
      node.server = hostPort;
    }
  }

  // NOTE: Shadowrocket 格式用 remark 做节点名称
  if (params.remark && !node.name) {
    node.name = decodeURIComponent(params.remark);
  }

  // Transport
  node.network = params.type || 'tcp';
  if (params.path) node.wsPath = decodeURIComponent(params.path);
  if (params.host) node.wsHost = decodeURIComponent(params.host);
  if (params.serviceName) node.grpcServiceName = params.serviceName;

  // Security — 支持标准格式和 Shadowrocket 的 xtls 参数
  const security = params.security || '';
  // NOTE: Shadowrocket 用 xtls=2 表示 Reality，xtls=1 表示 XTLS
  const xtls = params.xtls || '';

  if (security === 'tls' || (params.tls === '1' && !xtls)) {
    node.tls = true;
    node.sni = params.sni || node.server;
    if (params.fp) node.fingerprint = params.fp;
    if (params.alpn) node.alpn = params.alpn.split(',');
  } else if (security === 'reality' || xtls === '2') {
    // NOTE: xtls=2 是 Shadowrocket 表示 Reality 的方式
    node.tls = true;
    node.sni = params.sni || '';
    node.fingerprint = params.fp || 'chrome';
    node.realityPublicKey = params.pbk || '';
    node.realityShortId = params.sid || '';
    if (!node.flow) node.flow = 'xtls-rprx-vision';
  } else if (xtls === '1') {
    node.tls = true;
    node.sni = params.sni || node.server;
    node.flow = 'xtls-rprx-vision';
  } else if (params.tls === '1') {
    node.tls = true;
    node.sni = params.sni || node.server;
  } else {
    node.tls = false;
  }

  if (params.flow) node.flow = params.flow;
  node.skipCertVerify = params.allowInsecure === '1' || params.insecure === '1';

  if (!node.name) node.name = `VLESS-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a VMess URI: vmess://base64(json)
 */
function parseVMess(uri) {
  const node = createBaseNode();
  node.type = 'vmess';

  const b64 = uri.replace(/^vmess:\/\//, '');
  let json;
  try {
    json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  } catch {
    throw new Error('Invalid VMess URI: cannot decode base64 JSON');
  }

  node.name = json.ps || json.remarks || `VMess-${json.add}`;
  node.server = json.add || '';
  node.port = parseInt(json.port) || 443;
  node.uuid = json.id || '';
  node.alterId = parseInt(json.aid) || 0;
  node.cipher = json.scy || json.cipher || 'auto';
  node.network = json.net || 'tcp';

  // TLS
  node.tls = json.tls === 'tls';
  node.sni = json.sni || json.host || node.server;
  node.skipCertVerify = json.allowInsecure === '1' || json.allowInsecure === true;
  if (json.fp) node.fingerprint = json.fp;
  if (json.alpn) {
    node.alpn = typeof json.alpn === 'string' ? json.alpn.split(',') : json.alpn;
  }

  // Transport
  if (node.network === 'ws') {
    node.wsPath = json.path || '/';
    node.wsHost = json.host || '';
  } else if (node.network === 'grpc') {
    node.grpcServiceName = json.path || '';
  } else if (node.network === 'h2') {
    node.httpPath = json.path || '/';
    node.wsHost = json.host || '';
  }

  node.region = detectRegion(node.name, node.server);
  return node;
}

/**
 * Parse a Trojan URI: trojan://password@host:port?params#name
 */
function parseTrojan(uri) {
  const node = createBaseNode();
  node.type = 'trojan';

  let rest = uri.replace(/^trojan:\/\//, '');

  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  const qIdx = rest.indexOf('?');
  let params = {};
  if (qIdx !== -1) {
    const qs = rest.substring(qIdx + 1);
    params = Object.fromEntries(new URLSearchParams(qs));
    rest = rest.substring(0, qIdx);
  }

  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    node.password = decodeURIComponent(rest.substring(0, atIdx));
    const hostPort = rest.substring(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    } else {
      node.server = hostPort;
    }
  }

  node.sni = params.sni || params.peer || node.server;
  node.skipCertVerify = params.allowInsecure === '1' || params.insecure === '1';
  node.network = params.type || 'tcp';
  if (params.path) node.wsPath = decodeURIComponent(params.path);
  if (params.host) node.wsHost = decodeURIComponent(params.host);
  if (params.serviceName) node.grpcServiceName = params.serviceName;
  if (params.fp) node.fingerprint = params.fp;
  if (params.alpn) node.alpn = params.alpn.split(',');

  if (!node.name) node.name = `Trojan-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a Shadowsocks URI: ss://base64(method:password)@host:port#name
 * Also supports SIP002: ss://base64@host:port/?plugin=xxx#name
 */
function parseShadowsocks(uri) {
  const node = createBaseNode();
  node.type = 'ss';

  let rest = uri.replace(/^ss:\/\//, '');

  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  // Try SIP002 format first: base64(method:password)@host:port
  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    const userInfo = rest.substring(0, atIdx);
    const hostPart = rest.substring(atIdx + 1);

    // Remove query string
    const qIdx = hostPart.indexOf('?');
    const cleanHostPart = qIdx !== -1 ? hostPart.substring(0, qIdx) : hostPart;

    const colonIdx = cleanHostPart.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = cleanHostPart.substring(0, colonIdx);
      node.port = parseInt(cleanHostPart.substring(colonIdx + 1)) || 443;
    }

    // Decode userInfo
    let decoded;
    try {
      decoded = Buffer.from(userInfo, 'base64').toString('utf-8');
    } catch {
      decoded = decodeURIComponent(userInfo);
    }

    const sepIdx = decoded.indexOf(':');
    if (sepIdx !== -1) {
      node.cipher = decoded.substring(0, sepIdx);
      node.password = decoded.substring(sepIdx + 1);
    }
  } else {
    // Legacy format: base64(method:password@host:port)
    let decoded;
    try {
      decoded = Buffer.from(rest, 'base64').toString('utf-8');
    } catch {
      throw new Error('Invalid SS URI: cannot decode');
    }
    const atIdx2 = decoded.lastIndexOf('@');
    if (atIdx2 !== -1) {
      const auth = decoded.substring(0, atIdx2);
      const hostPort = decoded.substring(atIdx2 + 1);
      const sepIdx = auth.indexOf(':');
      node.cipher = auth.substring(0, sepIdx);
      node.password = auth.substring(sepIdx + 1);
      const colonIdx = hostPort.lastIndexOf(':');
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    }
  }

  node.tls = false;
  if (!node.name) node.name = `SS-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a TUIC URI: tuic://uuid:password@host:port?params#name
 */
function parseTUIC(uri) {
  const node = createBaseNode();
  node.type = 'tuic';

  let rest = uri.replace(/^tuic:\/\//, '');

  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  const qIdx = rest.indexOf('?');
  let params = {};
  if (qIdx !== -1) {
    const qs = rest.substring(qIdx + 1);
    params = Object.fromEntries(new URLSearchParams(qs));
    rest = rest.substring(0, qIdx);
  }

  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    const auth = rest.substring(0, atIdx);
    const hostPort = rest.substring(atIdx + 1);

    const authSep = auth.indexOf(':');
    if (authSep !== -1) {
      node.uuid = auth.substring(0, authSep);
      node.password = auth.substring(authSep + 1);
    }

    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    }
  }

  node.sni = params.sni || node.server;
  node.skipCertVerify = params.allowInsecure === '1' || params.insecure === '1';
  node.congestionControl = params.congestion_control || params.cc || 'bbr';
  if (params.alpn) node.alpn = params.alpn.split(',');
  if (params.udp_relay_mode) node.udpRelayMode = params.udp_relay_mode;
  if (params.reduce_rtt) node.reduceRtt = params.reduce_rtt === '1';

  if (!node.name) node.name = `TUIC-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse an AnyTLS URI: anytls://password@host:port?params#name
 * NOTE: AnyTLS 是一种新型代理协议，常见于飞兔云等机场
 */
function parseAnyTLS(uri) {
  const node = createBaseNode();
  node.type = 'anytls';

  let rest = uri.replace(/^anytls:\/\//, '');

  const hashIdx = rest.lastIndexOf('#');
  if (hashIdx !== -1) {
    node.name = decodeURIComponent(rest.substring(hashIdx + 1));
    rest = rest.substring(0, hashIdx);
  }

  const qIdx = rest.indexOf('?');
  let params = {};
  if (qIdx !== -1) {
    const qs = rest.substring(qIdx + 1);
    params = Object.fromEntries(new URLSearchParams(qs));
    rest = rest.substring(0, qIdx);
  }

  const atIdx = rest.lastIndexOf('@');
  if (atIdx !== -1) {
    node.password = decodeURIComponent(rest.substring(0, atIdx));
    const hostPort = rest.substring(atIdx + 1);
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx !== -1) {
      node.server = hostPort.substring(0, colonIdx);
      node.port = parseInt(hostPort.substring(colonIdx + 1)) || 443;
    } else {
      node.server = hostPort;
    }
  }

  node.sni = params.sni || params.peer || node.server;
  node.skipCertVerify = params.insecure === '1' || params.allowInsecure === '1';
  if (params.alpn) node.alpn = params.alpn.split(',');
  if (params.fp) node.fingerprint = params.fp;
  // AnyTLS 特有参数
  node.network = params.type || 'tcp';
  node.tls = true;

  if (!node.name) node.name = `AnyTLS-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a single proxy URI into internal node format
 */
function parseURI(uri) {
  uri = uri.trim();
  if (!uri) return null;

  try {
    if (uri.startsWith('hy2://') || uri.startsWith('hysteria2://')) {
      return parseHysteria2(uri);
    } else if (uri.startsWith('vless://')) {
      return parseVLESS(uri);
    } else if (uri.startsWith('vmess://')) {
      return parseVMess(uri);
    } else if (uri.startsWith('trojan://')) {
      return parseTrojan(uri);
    } else if (uri.startsWith('ss://')) {
      return parseShadowsocks(uri);
    } else if (uri.startsWith('tuic://')) {
      return parseTUIC(uri);
    } else if (uri.startsWith('anytls://')) {
      return parseAnyTLS(uri);
    }
  } catch (e) {
    console.error(`Failed to parse URI: ${uri.substring(0, 50)}... Error: ${e.message}`);
    return null;
  }

  return null;
}

/**
 * Parse multiple URIs (one per line, or base64 encoded block)
 */
function parseMultipleURIs(text) {
  // Try base64 decode first
  let decoded = text;
  try {
    const test = Buffer.from(text.trim(), 'base64').toString('utf-8');
    if (test.includes('://')) {
      decoded = test;
    }
  } catch {}

  const lines = decoded.split(/[\r\n]+/).filter(l => l.trim());
  const nodes = [];
  for (const line of lines) {
    const node = parseURI(line);
    if (node) nodes.push(node);
  }
  return nodes;
}

/**
 * Convert internal node to share URI
 */
/**
 * 格式化主机地址用于 URI 构建
 * NOTE: IPv6 地址必须用方括号包裹，否则冒号会被误解析为端口分隔符
 * @param {string} host - 域名或 IP 地址
 * @returns {string} 格式化后的主机地址
 */
function formatHost(host) {
  if (!host) return host;
  // 已经有方括号的不重复添加
  if (host.startsWith('[')) return host;
  // 包含冒号说明是 IPv6 地址
  if (host.includes(':')) return `[${host}]`;
  return host;
}

function nodeToURI(node) {
  const host = formatHost(node.server);
  switch (node.type) {
    case 'hysteria2': {
      const params = new URLSearchParams();
      // NOTE: Passwall 需要 security=tls 才能识别 TLS 连接
      params.set('security', 'tls');
      if (node.sni) params.set('sni', node.sni);
      if (node.skipCertVerify) params.set('insecure', '1');
      if (node.up) params.set('upmbps', node.up);
      if (node.down) params.set('downmbps', node.down);
      if (node.obfs) {
        params.set('obfs', node.obfs);
        if (node.obfsPassword) params.set('obfs-password', node.obfsPassword);
      }
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      const qs = params.toString();
      // NOTE: 使用标准 hysteria2:// 而非 hy2://，兼容 Passwall 等路由器客户端
      return `hysteria2://${encodeURIComponent(node.password)}@${host}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name)}`;
    }
    case 'vless': {
      const params = new URLSearchParams();
      params.set('type', node.network || 'tcp');
      if (node.realityPublicKey) {
        params.set('security', 'reality');
        params.set('pbk', node.realityPublicKey);
        if (node.realityShortId) params.set('sid', node.realityShortId);
      } else if (node.tls) {
        params.set('security', 'tls');
      } else {
        params.set('security', 'none');
      }
      if (node.sni) params.set('sni', node.sni);
      if (node.fingerprint) params.set('fp', node.fingerprint);
      if (node.flow) params.set('flow', node.flow);
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.network === 'ws') {
        if (node.wsPath) params.set('path', node.wsPath);
        if (node.wsHost) params.set('host', node.wsHost);
      } else if (node.network === 'grpc') {
        if (node.grpcServiceName) params.set('serviceName', node.grpcServiceName);
      }
      const qs = params.toString();
      return `vless://${node.uuid}@${host}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
    }
    case 'vmess': {
      const json = {
        v: '2', ps: node.name, add: node.server, port: String(node.port),
        id: node.uuid, aid: String(node.alterId), scy: node.cipher,
        net: node.network, type: 'none', host: node.wsHost || '', path: node.wsPath || '',
        tls: node.tls ? 'tls' : '', sni: node.sni || '', fp: node.fingerprint || ''
      };
      return 'vmess://' + Buffer.from(JSON.stringify(json)).toString('base64');
    }
    case 'trojan': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      params.set('type', node.network || 'tcp');
      if (node.fingerprint) params.set('fp', node.fingerprint);
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.network === 'ws') {
        if (node.wsPath) params.set('path', node.wsPath);
        if (node.wsHost) params.set('host', node.wsHost);
      }
      const qs = params.toString();
      return `trojan://${encodeURIComponent(node.password)}@${host}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
    }
    case 'ss': {
      const userInfo = Buffer.from(`${node.cipher}:${node.password}`).toString('base64');
      return `ss://${userInfo}@${host}:${node.port}#${encodeURIComponent(node.name)}`;
    }
    case 'tuic': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      params.set('congestion_control', node.congestionControl || 'bbr');
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.udpRelayMode) params.set('udp_relay_mode', node.udpRelayMode);
      const qs = params.toString();
      return `tuic://${node.uuid}:${node.password}@${host}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
    }
    case 'anytls': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.skipCertVerify) params.set('insecure', '1');
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.fingerprint) params.set('fp', node.fingerprint);
      const qs = params.toString();
      return `anytls://${encodeURIComponent(node.password)}@${host}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name)}`;
    }
    default:
      return null;
  }
}

module.exports = { parseURI, parseMultipleURIs, nodeToURI, createBaseNode, detectRegion };
