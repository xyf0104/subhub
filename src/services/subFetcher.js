/**
 * subFetcher.js - Fetch and parse remote subscription links
 */

const fetch = require('node-fetch');
const https = require('https');
const { parseMultipleURIs } = require('./nodeParser');
const nodeManager = require('./nodeManager');
const { v4: uuidv4 } = require('uuid');

// NOTE: 跳过自签证书验证，SubHub 订阅源可能使用自签证书
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Fetch a remote subscription URL, parse nodes, and store them
 * @param {string} subId - Subscription ID (for grouping)
 * @param {string} url - Remote subscription URL
 * @param {string} name - Display name for this subscription
 * @returns {Object} Result with node count
 */
async function fetchAndParse(subId, url, name, fetchMode) {
  let text;
  // NOTE: 提取原始订阅源的流量信息，用于客户端展示用量
  let userinfo = null;

  if (fetchMode === 'china') {
    // 用户明确选择国内中转
    console.log(`[Sub] 使用国内中转拉取: ${url}`);
    try {
      const result = await chinaProxyFetch(url);
      text = result.text;
      userinfo = result.userinfo;
    } catch (err) {
      throw new Error(`国内中转拉取失败: ${err.message}`);
    }
  } else {
    // 直连，失败时自动 fallback 到国内中转
    try {
      const result = await directFetch(url);
      text = result.text;
      userinfo = result.userinfo;
    } catch (directErr) {
      console.log(`[Sub] 直连失败 (${directErr.message})，尝试大陆中转: ${url}`);
      try {
        const result = await chinaProxyFetch(url);
        text = result.text;
        userinfo = result.userinfo;
      } catch (proxyErr) {
        throw new Error(`直连失败: ${directErr.message}; 中转也失败: ${proxyErr.message}`);
      }
    }
  }

  // 解析订阅内容
  const nodes = parseMultipleURIs(text);
  if (nodes.length > 0) {
    return await storeNodes(subId, name, nodes, userinfo);
  }

  // 尝试 Clash YAML 格式
  const yamlNodes = parseClashYAML(text);
  if (yamlNodes.length > 0) {
    return await storeNodes(subId, name, yamlNodes, userinfo);
  }

  throw new Error('No valid nodes found in subscription');
}

/**
 * 解析 Subscription-Userinfo 响应头
 * NOTE: 格式为 upload=xxx; download=xxx; total=xxx; expire=xxx
 * @param {string|null} header - 响应头原始值
 * @returns {Object|null} 解析后的流量信息
 */
function parseSubscriptionUserinfo(header) {
  if (!header) return null;
  const info = {};
  for (const part of header.split(';')) {
    const [key, val] = part.trim().split('=');
    if (key && val) {
      info[key.trim()] = parseInt(val.trim(), 10) || 0;
    }
  }
  // 至少包含 total 或 download 才算有效
  if (info.total || info.download) return info;
  return null;
}

/**
 * 直接拉取订阅
 */
async function directFetch(url) {
  const fetchOpts = {
    headers: {
      'User-Agent': 'Shadowrocket/1980 CFNetwork/1496.0.7 Darwin/23.5.0',
      'Accept': '*/*'
    },
    timeout: 15000,
  };
  if (url.startsWith('https://')) {
    fetchOpts.agent = insecureAgent;
  }

  const response = await fetch(url, fetchOpts);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // NOTE: 提取 Subscription-Userinfo 响应头（流量信息）
  const userinfo = parseSubscriptionUserinfo(response.headers.get('subscription-userinfo'));

  const text = await response.text();
  // 检查是否为错误响应（飞兔云等返回 JSON 错误）
  if (text.startsWith('{') && text.includes('"fail"')) {
    try {
      const json = JSON.parse(text);
      if (json.status === 'fail') {
        throw new Error(json.message || 'Subscription API error');
      }
    } catch (e) {
      if (e.message !== 'Unexpected token' && !e.message.includes('JSON')) throw e;
    }
  }
  return { text, userinfo };
}

/**
 * 通过大陆服务器中转拉取订阅
 * NOTE: 解决国内订阅源限制海外 IP 的问题
 */
// NOTE: 通过 FRP 隧道连接路由器（国内家庭宽带），用于中转拉取国内订阅
// Docker 容器内通过 host.docker.internal 访问宿主机的 FRP 隧道端口
const CHINA_PROXY_API = 'http://host.docker.internal:9877';
const CHINA_PROXY_TOKEN = 'subhub_ping_2026';

async function chinaProxyFetch(url) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ url });
    const reqUrl = new URL(`${CHINA_PROXY_API}/fetch-sub?token=${CHINA_PROXY_TOKEN}`);
    const options = {
      hostname: reqUrl.hostname,
      port: reqUrl.port,
      path: reqUrl.pathname + reqUrl.search,
      method: 'POST',
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.content) {
            // NOTE: 中转模式下 userinfo 由路由器端提取并透传
            const userinfo = parseSubscriptionUserinfo(json.userinfo || null);
            resolve({ text: json.content, userinfo });
          } else {
            reject(new Error(json.error || 'China proxy fetch failed'));
          }
        } catch {
          reject(new Error('China proxy response parse error'));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('China proxy timeout')); });
    req.on('error', (err) => { reject(new Error(`China proxy: ${err.message}`)); });
    req.write(body);
    req.end();
  });
}

/**
 * Store parsed nodes, replacing any existing nodes from this subscription
 */
async function storeNodes(subId, name, nodes, userinfo = null) {
  const groupName = `sub-${subId}`;

  // Delete old nodes from this subscription
  nodeManager.deleteNodesByGroup(groupName);

  // Tag nodes with subscription group
  for (const node of nodes) {
    node.group = groupName;
    node.id = uuidv4();
  }

  // Add new nodes
  nodeManager.addNodes(nodes);

  // NOTE: 保存订阅元数据，包含从上游获取的流量信息
  const updateData = {
    lastUpdate: new Date().toISOString(),
    nodeCount: nodes.length
  };
  if (userinfo) {
    updateData.userinfo = userinfo;
  }
  nodeManager.updateSubscription(subId, updateData);

  return { count: nodes.length, nodes, userinfo };
}

/**
 * Try to parse proxies from a Clash YAML config
 */
function parseClashYAML(text) {
  try {
    const yaml = require('js-yaml');
    const config = yaml.load(text);
    if (!config || !config.proxies) return [];

    return config.proxies.map(p => {
      const node = require('./nodeParser').createBaseNode();
      node.name = p.name || '';
      node.type = mapClashType(p.type);
      node.server = p.server || '';
      node.port = p.port || 443;

      switch (p.type) {
        case 'hysteria2':
          node.password = p.password || '';
          node.sni = p.sni || p.server;
          node.skipCertVerify = p['skip-cert-verify'] || false;
          if (p.obfs) node.obfs = p.obfs;
          if (p['obfs-password']) node.obfsPassword = p['obfs-password'];
          if (p.alpn) node.alpn = Array.isArray(p.alpn) ? p.alpn : [p.alpn];
          break;
        case 'vless':
          node.uuid = p.uuid || '';
          node.network = p.network || 'tcp';
          node.tls = p.tls !== false;
          node.sni = p.servername || p.sni || p.server;
          node.flow = p.flow || '';
          node.fingerprint = p['client-fingerprint'] || '';
          if (p['reality-opts']) {
            node.realityPublicKey = p['reality-opts']['public-key'] || '';
            node.realityShortId = p['reality-opts']['short-id'] || '';
          }
          if (p['ws-opts']) {
            node.wsPath = p['ws-opts'].path || '';
            node.wsHost = p['ws-opts'].headers?.Host || '';
          }
          if (p['grpc-opts']) {
            node.grpcServiceName = p['grpc-opts']['grpc-service-name'] || '';
          }
          break;
        case 'vmess':
          node.uuid = p.uuid || '';
          node.alterId = p.alterId || 0;
          node.cipher = p.cipher || 'auto';
          node.network = p.network || 'tcp';
          node.tls = p.tls || false;
          node.sni = p.servername || p.server;
          if (p['ws-opts']) {
            node.wsPath = p['ws-opts'].path || '';
            node.wsHost = p['ws-opts'].headers?.Host || '';
          }
          break;
        case 'trojan':
          node.password = p.password || '';
          node.sni = p.sni || p.server;
          node.skipCertVerify = p['skip-cert-verify'] || false;
          node.network = p.network || 'tcp';
          break;
        case 'ss':
          node.cipher = p.cipher || 'aes-256-gcm';
          node.password = p.password || '';
          break;
        case 'tuic':
          node.uuid = p.uuid || '';
          node.password = p.password || '';
          node.congestionControl = p['congestion-controller'] || 'bbr';
          if (p.alpn) node.alpn = Array.isArray(p.alpn) ? p.alpn : [p.alpn];
          break;
      }

      const { detectRegion } = require('./nodeParser');
      node.region = detectRegion(node.name, node.server);
      return node;
    });
  } catch {
    return [];
  }
}

function mapClashType(type) {
  const map = { 'hy2': 'hysteria2', 'hysteria2': 'hysteria2' };
  return map[type] || type;
}

/**
 * Refresh all subscriptions
 */
async function refreshAll() {
  const subs = nodeManager.getAllSubscriptions();
  const results = [];
  for (const sub of subs) {
    try {
      const result = await fetchAndParse(sub.id, sub.url, sub.name, sub.fetchMode);
      results.push({ id: sub.id, name: sub.name, success: true, count: result.count });
    } catch (error) {
      results.push({ id: sub.id, name: sub.name, success: false, error: error.message });
    }
  }
  return results;
}

module.exports = { fetchAndParse, refreshAll, parseClashYAML };
