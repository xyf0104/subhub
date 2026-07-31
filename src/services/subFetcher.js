/**
 * subFetcher.js - Fetch and parse remote subscription links
 */

const fetch = require('node-fetch');
const https = require('https');
const { parseMultipleURIs } = require('./nodeParser');
const nodeManager = require('./nodeManager');
const {
  isShadowrocketConf,
  parseShadowrocketConf,
} = require('./shadowrocket-conf-parser');

// NOTE: 仅在显式兼容开关开启时使用，默认保持 HTTPS 证书严格校验。
const insecureAgent = new https.Agent({ rejectUnauthorized: false });
const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024;
const subscriptionRefreshes = new Map();
let refreshAllPromise = null;
let autoRefreshTimer = null;
let initialRefreshTimer = null;

/**
 * 校验订阅 URL，并迁移西部数据已停用的旧接口域名。
 * @param {string} rawUrl 用户保存的订阅 URL
 * @returns {string} 可请求的 URL
 */
function normalizeSubscriptionUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('订阅 URL 格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('订阅 URL 仅支持 http 或 https');
  }
  if (parsed.hostname.toLowerCase() === 'api.wd-blue.com') {
    parsed.hostname = 'api.sublink.dev';
  }
  return parsed.toString();
}

/**
 * 日志只显示源站主机名，避免查询参数中的订阅凭据泄露。
 * @param {string} url 订阅 URL
 * @returns {string} 安全的源站描述
 */
function getSafeSourceLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-source';
  }
}

/**
 * 清除底层网络错误中可能包含的完整订阅 URL。
 * @param {unknown} error 原始错误
 * @returns {string} 脱敏错误信息
 */
function getSafeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(/https?:\/\/[^\s;]+/gi, '[订阅地址]');
}

/**
 * 合并响应头和 CONF 内的流量信息，响应头优先。
 * @param {object|null} headerInfo 响应头元数据
 * @param {object|null} confInfo CONF 元数据
 * @returns {object|null} 合并后的元数据
 */
function mergeSubscriptionUserinfo(headerInfo, confInfo) {
  if (!headerInfo && !confInfo) return null;
  return { ...(confInfo || {}), ...(headerInfo || {}) };
}

/**
 * 获取、解析并原子更新一个远程订阅。
 * @param {string} subId 订阅 ID
 * @param {string} url 远程订阅 URL
 * @param {string} name 订阅显示名称
 * @param {string} fetchMode 拉取方式
 * @returns {Promise<object>} 更新结果
 */
async function fetchAndParse(subId, url, name, fetchMode) {
  if (subscriptionRefreshes.has(subId)) {
    return subscriptionRefreshes.get(subId);
  }

  const refreshPromise = (async () => {
    try {
      return await fetchAndParseInternal(subId, url, name, fetchMode);
    } catch (error) {
      const safeMessage = getSafeErrorMessage(error);
      nodeManager.updateSubscription(subId, {
        lastAttempt: new Date().toISOString(),
        lastError: safeMessage,
      });
      throw new Error(safeMessage);
    }
  })();
  subscriptionRefreshes.set(subId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    if (subscriptionRefreshes.get(subId) === refreshPromise) {
      subscriptionRefreshes.delete(subId);
    }
  }
}

/**
 * 执行远程订阅拉取和格式识别。
 */
async function fetchAndParseInternal(subId, url, name, fetchMode) {
  const normalizedUrl = normalizeSubscriptionUrl(url);
  const safeSource = getSafeSourceLabel(normalizedUrl);
  let text;
  let userinfo = null;

  if (normalizedUrl !== url) {
    console.log('[Sub] 已将西部数据旧接口自动迁移到 api.sublink.dev');
  }

  if (fetchMode === 'china') {
    console.log(`[Sub] 使用国内中转拉取: ${safeSource}`);
    try {
      const result = await chinaProxyFetch(normalizedUrl);
      text = result.text;
      userinfo = result.userinfo;
    } catch (error) {
      throw new Error(`国内中转拉取失败: ${getSafeErrorMessage(error)}`);
    }
  } else {
    try {
      const result = await directFetch(normalizedUrl);
      text = result.text;
      userinfo = result.userinfo;
    } catch (directError) {
      console.log(`[Sub] 直连 ${safeSource} 失败，尝试国内中转: ${getSafeErrorMessage(directError)}`);
      try {
        const result = await chinaProxyFetch(normalizedUrl);
        text = result.text;
        userinfo = result.userinfo;
      } catch (proxyError) {
        throw new Error(`直连失败: ${getSafeErrorMessage(directError)}; 中转也失败: ${getSafeErrorMessage(proxyError)}`);
      }
    }
  }

  if (isShadowrocketConf(text)) {
    const confResult = parseShadowrocketConf(text);
    if (confResult.nodes.length === 0) {
      throw new Error('Shadowrocket CONF 的 [Proxy] 段未解析到有效节点，已保留原节点');
    }
    const mergedUserinfo = mergeSubscriptionUserinfo(userinfo, confResult.userinfo);
    return storeNodes(subId, name, confResult.nodes, mergedUserinfo, {
      sourceType: 'shadowrocket-conf',
      resolvedUrl: normalizedUrl,
      parseStats: confResult.stats,
      confMetadata: {
        expireDate: confResult.metadata.expireDate || null,
        trafficLabel: confResult.metadata.trafficLabel || null,
      },
    });
  }

  const nodes = parseMultipleURIs(text);
  if (nodes.length > 0) {
    return storeNodes(subId, name, nodes, userinfo, {
      sourceType: 'remote-uri',
      resolvedUrl: normalizedUrl,
    });
  }

  const yamlNodes = parseClashYAML(text);
  if (yamlNodes.length > 0) {
    return storeNodes(subId, name, yamlNodes, userinfo, {
      sourceType: 'clash-yaml',
      resolvedUrl: normalizedUrl,
    });
  }

  throw new Error('订阅中未找到有效节点，已保留原节点');
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
  if (url.startsWith('https://') && process.env.ALLOW_INSECURE_SUBSCRIPTION_TLS === 'true') {
    // NOTE: 默认严格验证证书；仅为明确配置的历史自签名订阅提供兼容开关。
    fetchOpts.agent = insecureAgent;
  }

  const response = await fetch(url, fetchOpts);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const declaredLength = Number.parseInt(response.headers.get('content-length'), 10);
  if (declaredLength > MAX_SUBSCRIPTION_BYTES) {
    throw new Error('订阅内容超过 5MB 安全限制');
  }

  // NOTE: 提取 Subscription-Userinfo 响应头（流量信息）
  const userinfo = parseSubscriptionUserinfo(response.headers.get('subscription-userinfo'));

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of response.body) {
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_SUBSCRIPTION_BYTES) {
      response.body.destroy();
      throw new Error('订阅内容超过 5MB 安全限制');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks, receivedBytes).toString('utf-8');
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
      res.on('data', chunk => {
        data += chunk;
        if (Buffer.byteLength(data) > MAX_SUBSCRIPTION_BYTES) {
          req.destroy(new Error('China proxy response exceeds 5MB limit'));
        }
      });
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

async function storeNodes(subId, name, nodes, userinfo = null, sourceInfo = {}) {
  const savedNodes = nodeManager.replaceSubscriptionNodes(subId, nodes);

  // NOTE: 节点文件先成功落盘，再更新订阅状态，避免出现数量已更新但节点未写入。
  const updateData = {
    lastUpdate: new Date().toISOString(),
    lastAttempt: new Date().toISOString(),
    lastError: null,
    nodeCount: savedNodes.length,
  };
  if (userinfo) updateData.userinfo = userinfo;
  if (sourceInfo.sourceType) updateData.sourceType = sourceInfo.sourceType;
  if (sourceInfo.resolvedUrl) updateData.url = sourceInfo.resolvedUrl;
  if (sourceInfo.parseStats) updateData.parseStats = sourceInfo.parseStats;
  if (sourceInfo.confMetadata) updateData.confMetadata = sourceInfo.confMetadata;
  nodeManager.updateSubscription(subId, updateData);

  console.log(`[Sub] ${name} 更新成功: ${savedNodes.length} 个节点 (${sourceInfo.sourceType || 'unknown'})`);
  return {
    count: savedNodes.length,
    nodes: savedNodes,
    userinfo,
    sourceType: sourceInfo.sourceType || null,
    parseStats: sourceInfo.parseStats || null,
  };
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

async function refreshAll() {
  if (refreshAllPromise) return refreshAllPromise;

  refreshAllPromise = (async () => {
    const subs = nodeManager.getAllSubscriptions();
    const results = [];
    for (const sub of subs) {
      try {
        const result = await fetchAndParse(sub.id, sub.url, sub.name, sub.fetchMode);
        results.push({
          id: sub.id,
          name: sub.name,
          success: true,
          count: result.count,
          sourceType: result.sourceType,
        });
      } catch (error) {
        results.push({
          id: sub.id,
          name: sub.name,
          success: false,
          error: getSafeErrorMessage(error),
        });
      }
    }
    return results;
  })();

  try {
    return await refreshAllPromise;
  } finally {
    refreshAllPromise = null;
  }
}

/**
 * 启动进程内订阅定时刷新。
 * NOTE: 首次延迟执行，避免服务刚监听时与初始化竞争；unref 不阻止进程退出。
 * @returns {() => void} 停止刷新器的方法
 */
function startAutoRefresh() {
  if (autoRefreshTimer || initialRefreshTimer) {
    return stopAutoRefresh;
  }

  const configuredHours = Number.parseFloat(process.env.SUBSCRIPTION_REFRESH_HOURS || '6');
  if (!Number.isFinite(configuredHours) || configuredHours <= 0) {
    console.log('[Sub] 自动刷新已禁用');
    return stopAutoRefresh;
  }

  const intervalMs = Math.max(configuredHours * 60 * 60 * 1000, 60 * 1000);
  const runScheduledRefresh = async () => {
    try {
      const results = await refreshAll();
      const successCount = results.filter(result => result.success).length;
      console.log(`[Sub] 自动刷新完成: ${successCount}/${results.length} 个订阅成功`);
    } catch (error) {
      console.error(`[Sub] 自动刷新异常: ${getSafeErrorMessage(error)}`);
    }
  };

  initialRefreshTimer = setTimeout(() => {
    initialRefreshTimer = null;
    runScheduledRefresh();
  }, 30 * 1000);
  initialRefreshTimer.unref?.();

  autoRefreshTimer = setInterval(runScheduledRefresh, intervalMs);
  autoRefreshTimer.unref?.();
  console.log(`[Sub] 自动刷新已启用: 每 ${configuredHours} 小时`);
  return stopAutoRefresh;
}

/**
 * 停止进程内订阅定时刷新。
 */
function stopAutoRefresh() {
  if (initialRefreshTimer) clearTimeout(initialRefreshTimer);
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  initialRefreshTimer = null;
  autoRefreshTimer = null;
}

module.exports = {
  fetchAndParse,
  refreshAll,
  startAutoRefresh,
  stopAutoRefresh,
  parseClashYAML,
  normalizeSubscriptionUrl,
};
