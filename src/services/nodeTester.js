/**
 * nodeTester.js - 节点连通性测试
 * NOTE: 使用中国大陆服务器 ICMP ping 测速，反映真实国内延迟
 */

const http = require('http');

// NOTE: 通过 FRP 隧道连接路由器（国内家庭宽带），反映真实用户延迟
// Docker 容器内通过 host.docker.internal 访问宿主机的 FRP 隧道端口
const CHINA_PING_API = process.env.CHINA_PING_URL || 'http://host.docker.internal:9877';
const CHINA_PING_TOKEN = process.env.CHINA_PING_TOKEN || 'subhub_ping_2026';


/**
 * 调用大陆 ICMP ping API 测试单个主机
 */
function chinaPing(host, timeout = 15000) {
  return new Promise((resolve) => {
    const url = `${CHINA_PING_API}/ping?host=${encodeURIComponent(host)}&token=${CHINA_PING_TOKEN}`;
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.result || { success: false, error: 'invalid response' });
        } catch {
          resolve({ success: false, error: 'parse error' });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, latency: -1, error: 'API timeout' });
    });

    req.on('error', (err) => {
      resolve({ success: false, latency: -1, error: `API error: ${err.message}` });
    });
  });
}

/**
 * 批量 ICMP ping（调用大陆 API 的 batch 接口）
 */
function chinaPingBatch(hosts, timeout = 30000) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ hosts });
    const urlObj = new URL(`${CHINA_PING_API}/ping-batch?token=${CHINA_PING_TOKEN}`);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      timeout,
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
          resolve(json.results || {});
        } catch {
          resolve({});
        }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({}); });
    req.on('error', () => { resolve({}); });
    req.write(body);
    req.end();
  });
}

/**
 * 测试单个节点
 */
async function testNode(node) {
  const isUDP = ['hysteria2', 'tuic'].includes(node.type);
  const result = await chinaPing(node.server);

  return {
    nodeId: node.id,
    nodeName: node.name,
    server: node.server,
    port: node.port,
    type: node.type,
    protocol: isUDP ? 'UDP/QUIC' : 'TCP',
    tcp: {
      host: node.server,
      port: node.port,
      ip: result.ip || '?',
      family: result.family || 'v4',
      avgLatency: result.success ? Math.round(result.latency) : -1,
      loss: result.loss,
      method: 'icmp-china',
      note: result.error || '',
      allSuccess: result.success,
      successRate: result.success ? '1/1' : '0/1',
      source: 'China-Shanghai',
    },
    timestamp: Date.now(),
  };
}

/**
 * 批量测试 — 使用 batch API 一次发送所有主机
 */
async function testNodes(nodes) {
  // 提取唯一主机列表（不同节点可能共用同一主机）
  const hostMap = new Map();
  for (const n of nodes) {
    if (!hostMap.has(n.server)) hostMap.set(n.server, []);
    hostMap.get(n.server).push(n);
  }

  const hosts = [...hostMap.keys()];
  const batchResults = await chinaPingBatch(hosts);

  // 映射回各节点
  return nodes.map(n => {
    const isUDP = ['hysteria2', 'tuic'].includes(n.type);
    const r = batchResults[n.server] || { success: false, error: 'no result' };
    return {
      nodeId: n.id,
      nodeName: n.name,
      server: n.server,
      port: n.port,
      type: n.type,
      protocol: isUDP ? 'UDP/QUIC' : 'TCP',
      tcp: {
        host: n.server,
        port: n.port,
        ip: r.ip || '?',
        family: r.family || 'v4',
        avgLatency: r.success ? Math.round(r.latency) : -1,
        loss: r.loss,
        method: 'icmp-china',
        note: r.error || '',
        allSuccess: r.success,
        successRate: r.success ? '1/1' : '0/1',
        source: 'China-Shanghai',
      },
      timestamp: Date.now(),
    };
  });
}

module.exports = { chinaPing, testNode, testNodes };
