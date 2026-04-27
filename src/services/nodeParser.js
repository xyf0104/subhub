/**
 * nodeParser.js - Parse proxy share URIs into internal node format
 * Supports: Hysteria 2, VLESS, VMess, Trojan, Shadowsocks, TUIC
 */

const { v4: uuidv4 } = require('uuid');

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
    id: uuidv4(),
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
  const regionMap = {
    'HK': ['hk', 'hong', 'hongkong', '香港', '港'],
    'JP': ['jp', 'japan', 'tokyo', '日本', '东京', '大阪'],
    'SG': ['sg', 'singapore', '新加坡', '狮城'],
    'US': ['us', 'usa', 'united', 'america', '美国', '美', 'los', 'san', 'new york', 'seattle'],
    'TW': ['tw', 'taiwan', '台湾', '台'],
    'KR': ['kr', 'korea', '韩国', '首尔'],
    'UK': ['uk', 'london', '英国'],
    'DE': ['de', 'germany', 'frankfurt', '德国'],
    'AU': ['au', 'australia', '澳大利亚'],
    'IN': ['in', 'india', 'mumbai', '印度'],
    'CA': ['ca', 'canada', '加拿大'],
    'FR': ['fr', 'france', 'paris', '法国'],
    'NL': ['nl', 'netherlands', '荷兰'],
    'RU': ['ru', 'russia', '俄罗斯'],
  };
  for (const [code, keywords] of Object.entries(regionMap)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return code;
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
  if (params.up) node.up = params.up;
  if (params.down) node.down = params.down;

  if (!node.name) node.name = `HY2-${node.server}`;
  node.region = detectRegion(node.name, node.server);

  return node;
}

/**
 * Parse a VLESS URI: vless://uuid@host:port?params#name
 */
function parseVLESS(uri) {
  const node = createBaseNode();
  node.type = 'vless';
  node.cipher = 'none';

  let rest = uri.replace(/^vless:\/\//, '');

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

  // Transport
  node.network = params.type || 'tcp';
  if (params.path) node.wsPath = decodeURIComponent(params.path);
  if (params.host) node.wsHost = decodeURIComponent(params.host);
  if (params.serviceName) node.grpcServiceName = params.serviceName;

  // Security
  const security = params.security || '';
  if (security === 'tls') {
    node.tls = true;
    node.sni = params.sni || node.server;
    if (params.fp) node.fingerprint = params.fp;
    if (params.alpn) node.alpn = params.alpn.split(',');
  } else if (security === 'reality') {
    node.tls = true;
    node.sni = params.sni || '';
    node.fingerprint = params.fp || 'chrome';
    node.realityPublicKey = params.pbk || '';
    node.realityShortId = params.sid || '';
  } else {
    node.tls = false;
  }

  if (params.flow) node.flow = params.flow;
  node.skipCertVerify = params.allowInsecure === '1';

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
function nodeToURI(node) {
  switch (node.type) {
    case 'hysteria2': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.skipCertVerify) params.set('insecure', '1');
      if (node.obfs) {
        params.set('obfs', node.obfs);
        if (node.obfsPassword) params.set('obfs-password', node.obfsPassword);
      }
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      const qs = params.toString();
      return `hy2://${encodeURIComponent(node.password)}@${node.server}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name)}`;
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
      return `vless://${node.uuid}@${node.server}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
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
      return `trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
    }
    case 'ss': {
      const userInfo = Buffer.from(`${node.cipher}:${node.password}`).toString('base64');
      return `ss://${userInfo}@${node.server}:${node.port}#${encodeURIComponent(node.name)}`;
    }
    case 'tuic': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      params.set('congestion_control', node.congestionControl || 'bbr');
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.udpRelayMode) params.set('udp_relay_mode', node.udpRelayMode);
      const qs = params.toString();
      return `tuic://${node.uuid}:${node.password}@${node.server}:${node.port}?${qs}#${encodeURIComponent(node.name)}`;
    }
    case 'anytls': {
      const params = new URLSearchParams();
      if (node.sni) params.set('sni', node.sni);
      if (node.skipCertVerify) params.set('insecure', '1');
      if (node.alpn?.length) params.set('alpn', node.alpn.join(','));
      if (node.fingerprint) params.set('fp', node.fingerprint);
      const qs = params.toString();
      return `anytls://${encodeURIComponent(node.password)}@${node.server}:${node.port}${qs ? '?' + qs : ''}#${encodeURIComponent(node.name)}`;
    }
    default:
      return null;
  }
}

module.exports = { parseURI, parseMultipleURIs, nodeToURI, createBaseNode, detectRegion };
