'use strict';

/**
 * Shadowrocket CONF 解析器
 * NOTE: 只读取 [Proxy]，避免规则、DNS 和策略组被误识别为节点。
 */

const { createBaseNode, detectRegion } = require('./nodeParser');

const SUPPORTED_PROTOCOLS = new Map([
  ['ss', 'ss'],
  ['shadowsocks', 'ss'],
  ['vmess', 'vmess'],
  ['vless', 'vless'],
  ['trojan', 'trojan'],
  ['hysteria2', 'hysteria2'],
  ['hy2', 'hysteria2'],
  ['tuic', 'tuic'],
]);

const BYTE_UNITS = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
};

/**
 * 按 CSV 规则拆分字段，保留引号内的逗号。
 * @param {string} value 待拆分文本
 * @returns {string[]} 字段列表
 */
function splitCsv(value) {
  const fields = [];
  let current = '';
  let quote = '';
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  fields.push(current.trim());
  return fields;
}

/**
 * 把 Shadowrocket 参数名统一为小写短横线格式。
 * @param {string} key 原参数名
 * @returns {string} 规范化参数名
 */
function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/_/g, '-');
}

/**
 * 解析节点参数，等号之后的内容保持原样以兼容密码中的等号。
 * @param {string[]} fields 参数字段
 * @returns {Record<string, string>} 参数对象
 */
function parseOptions(fields) {
  const options = {};
  for (const field of fields) {
    const equalIndex = field.indexOf('=');
    if (equalIndex <= 0) continue;
    const key = normalizeKey(field.slice(0, equalIndex));
    const value = field.slice(equalIndex + 1).trim();
    options[key] = value;
  }
  return options;
}

/**
 * 兼容 Shadowrocket 常见布尔值。
 * @param {unknown} value 原始值
 * @param {boolean} fallback 缺省值
 * @returns {boolean} 布尔值
 */
function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * 获取第一个存在的参数。
 * @param {Record<string, string>} options 参数对象
 * @param {...string} keys 候选参数名
 * @returns {string} 参数值
 */
function pickOption(options, ...keys) {
  for (const key of keys) {
    const value = options[normalizeKey(key)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

/**
 * 解析以逗号、竖线或分号分隔的列表。
 * @param {string} value 原始列表
 * @returns {string[]} 非空条目
 */
function parseList(value) {
  if (!value) return [];
  return value.split(/[|;,]/).map(item => item.trim()).filter(Boolean);
}

/**
 * 优先按文字地区识别，修正部分机场旗帜与名称不一致的问题。
 * @param {string} name 节点名称
 * @param {string} server 服务器地址
 * @returns {string} 地区码
 */
function detectConfRegion(name, server) {
  const nameWithoutFlags = name.replace(/[\uD83C][\uDDE6-\uDDFF][\uD83C][\uDDE6-\uDDFF]/g, '');
  const textRegion = detectRegion(nameWithoutFlags, server);
  return textRegion !== 'OTHER' ? textRegion : detectRegion(name, server);
}

/**
 * 从 WebSocket 请求头中提取 Host。
 * @param {string} value 请求头文本
 * @returns {string} Host 值
 */
function parseWsHost(value) {
  if (!value) return '';
  const match = value.match(/(?:^|[|;\s])host\s*[:=]\s*([^|;\s]+)/i);
  return match ? match[1].trim() : '';
}

/**
 * 将单条 [Proxy] 配置映射到 SubHub 节点模型。
 * @param {string} name 节点名称
 * @param {string} protocol 协议名称
 * @param {string} server 服务器地址
 * @param {number} port 端口
 * @param {Record<string, string>} options 协议参数
 * @returns {object} SubHub 节点
 */
function buildNode(name, protocol, server, port, options) {
  const node = createBaseNode();
  node.name = name;
  node.type = protocol;
  node.server = server;
  node.port = port;
  node.region = detectConfRegion(name, server);
  node.sni = pickOption(options, 'sni', 'peer', 'servername', 'server-name') || server;
  node.skipCertVerify = toBoolean(
    pickOption(options, 'skip-cert-verify', 'allow-insecure', 'insecure'),
    false,
  );
  node.fingerprint = pickOption(options, 'fingerprint', 'client-fingerprint', 'fp');
  node.alpn = parseList(pickOption(options, 'alpn'));

  const transport = pickOption(options, 'network', 'transport', 'type').toLowerCase();
  if (toBoolean(options.ws)) node.network = 'ws';
  else if (toBoolean(options.grpc)) node.network = 'grpc';
  else if (transport) node.network = transport;

  node.wsPath = pickOption(options, 'ws-path', 'path');
  node.wsHost = pickOption(options, 'ws-host', 'host') || parseWsHost(options['ws-headers']);
  node.grpcServiceName = pickOption(options, 'grpc-service-name', 'service-name', 'serviceName');

  switch (protocol) {
    case 'trojan':
      node.password = pickOption(options, 'password');
      node.tls = toBoolean(options.tls, true);
      break;
    case 'ss':
      node.password = pickOption(options, 'password');
      node.cipher = pickOption(options, 'encrypt-method', 'method', 'cipher') || 'aes-256-gcm';
      node.tls = false;
      node.obfs = pickOption(options, 'obfs');
      node.obfsPassword = pickOption(options, 'obfs-password', 'obfs-host');
      break;
    case 'vmess':
      node.uuid = pickOption(options, 'uuid', 'username');
      node.alterId = Number.parseInt(pickOption(options, 'alter-id', 'alterid', 'aid'), 10) || 0;
      node.cipher = pickOption(options, 'method', 'cipher') || 'auto';
      node.tls = toBoolean(options.tls, false);
      break;
    case 'vless': {
      node.uuid = pickOption(options, 'uuid', 'username');
      node.cipher = 'none';
      node.flow = pickOption(options, 'flow');
      node.realityPublicKey = pickOption(options, 'public-key', 'reality-public-key', 'pbk');
      node.realityShortId = pickOption(options, 'short-id', 'reality-short-id', 'sid');
      const security = pickOption(options, 'security', 'xtls').toLowerCase();
      node.tls = Boolean(node.realityPublicKey)
        || ['tls', 'reality', '1', '2'].includes(security)
        || toBoolean(options.tls, false);
      break;
    }
    case 'hysteria2':
      node.password = pickOption(options, 'password', 'auth', 'auth-str');
      node.tls = true;
      node.obfs = pickOption(options, 'obfs');
      node.obfsPassword = pickOption(options, 'obfs-password');
      node.up = pickOption(options, 'up', 'upmbps');
      node.down = pickOption(options, 'down', 'downmbps');
      break;
    case 'tuic':
      node.uuid = pickOption(options, 'uuid', 'username');
      node.password = pickOption(options, 'password');
      node.tls = true;
      node.congestionControl = pickOption(options, 'congestion-controller', 'congestion-control', 'cc') || 'bbr';
      node.udpRelayMode = pickOption(options, 'udp-relay-mode') || 'native';
      node.reduceRtt = toBoolean(pickOption(options, 'reduce-rtt'), true);
      break;
    default:
      break;
  }

  return node;
}

/**
 * 校验节点是否包含协议必需字段。
 * @param {object} node 待校验节点
 * @returns {boolean} 是否有效
 */
function isValidNode(node) {
  if (!node.name || !node.server || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    return false;
  }
  if (['trojan', 'ss', 'hysteria2'].includes(node.type) && !node.password) return false;
  if (['vmess', 'vless'].includes(node.type) && !node.uuid) return false;
  if (node.type === 'tuic' && (!node.uuid || !node.password)) return false;
  if (node.type === 'ss' && !node.cipher) return false;
  return true;
}

/**
 * 将流量数字转换为字节。
 * @param {string} amount 数值
 * @param {string} unit 单位
 * @returns {number} 字节数
 */
function toBytes(amount, unit) {
  const multiplier = BYTE_UNITS[unit.toLowerCase()] || 1;
  return Math.round(Number.parseFloat(amount) * multiplier);
}

/**
 * 解析机场放在伪节点名称里的流量和到期信息。
 * @param {string} name 配置名称
 * @param {object} metadata 当前元数据
 * @returns {boolean} 是否为元数据行
 */
function parseMetadataLine(name, metadata) {
  const trafficMatch = name.match(/^\s*(?:traffic|流量|剩余流量)\s*:\s*([\d.]+)\s*(B|KB|MB|GB|TB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB|TB)\s*$/i);
  if (trafficMatch) {
    metadata.userinfo.upload = 0;
    metadata.userinfo.download = toBytes(trafficMatch[1], trafficMatch[2]);
    metadata.userinfo.total = toBytes(trafficMatch[3], trafficMatch[4]);
    metadata.trafficLabel = name.trim();
    return true;
  }

  const expireMatch = name.match(/^\s*(?:expire|expiry|到期|有效期)\s*:\s*(\d{4}-\d{1,2}-\d{1,2})\s*$/i);
  if (expireMatch) {
    const timestamp = Date.parse(`${expireMatch[1]}T23:59:59Z`);
    if (Number.isFinite(timestamp)) {
      metadata.userinfo.expire = Math.floor(timestamp / 1000);
      metadata.expireDate = expireMatch[1];
    }
    return true;
  }

  return false;
}

/**
 * 判断内容是否为 Shadowrocket 配置。
 * @param {string} text 配置文本
 * @returns {boolean} 是否包含 [Proxy] 段
 */
function isShadowrocketConf(text) {
  return typeof text === 'string' && /^\s*\[Proxy\]\s*$/im.test(text);
}

/**
 * 解析 Shadowrocket CONF。
 * @param {string} text 配置文本
 * @returns {{nodes: object[], userinfo: object|null, metadata: object, stats: object}}
 */
function parseShadowrocketConf(text) {
  const nodes = [];
  const metadata = {
    updateUrl: '',
    trafficLabel: '',
    expireDate: '',
    userinfo: {},
  };
  const stats = {
    proxyLines: 0,
    parsedNodes: 0,
    ignoredMetadata: 0,
    invalidLines: 0,
    unsupportedProtocols: {},
  };

  if (typeof text !== 'string' || !text.trim()) {
    return { nodes, userinfo: null, metadata, stats };
  }

  let section = '';
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    if (!metadata.updateUrl) {
      const updateMatch = line.match(/^update-url\s*=\s*(https?:\/\/\S+)\s*$/i);
      if (updateMatch) metadata.updateUrl = updateMatch[1];
    }

    if (section !== 'proxy' || !line || line.startsWith('#') || line.startsWith(';')) continue;
    stats.proxyLines += 1;

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      stats.invalidLines += 1;
      continue;
    }

    const name = line.slice(0, equalIndex).trim();
    if (parseMetadataLine(name, metadata)) {
      stats.ignoredMetadata += 1;
      continue;
    }

    const fields = splitCsv(line.slice(equalIndex + 1));
    if (fields.length < 3) {
      stats.invalidLines += 1;
      continue;
    }

    const rawProtocol = fields[0].trim().toLowerCase();
    const protocol = SUPPORTED_PROTOCOLS.get(rawProtocol);
    if (!protocol) {
      const safeProtocol = rawProtocol || 'empty';
      stats.unsupportedProtocols[safeProtocol] = (stats.unsupportedProtocols[safeProtocol] || 0) + 1;
      continue;
    }

    const server = fields[1].trim().replace(/^\[|]$/g, '');
    const port = Number.parseInt(fields[2], 10);
    const options = parseOptions(fields.slice(3));
    const node = buildNode(name, protocol, server, port, options);
    if (!isValidNode(node)) {
      stats.invalidLines += 1;
      continue;
    }

    nodes.push(node);
  }

  stats.parsedNodes = nodes.length;
  const userinfo = Object.keys(metadata.userinfo).length > 0 ? metadata.userinfo : null;
  return { nodes, userinfo, metadata, stats };
}

module.exports = {
  isShadowrocketConf,
  parseShadowrocketConf,
  splitCsv,
};
