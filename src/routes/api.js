/**
 * api.js - Admin API routes for node and subscription management
 */

const express = require('express');
const router = express.Router();
const { requireAuth, login, logout } = require('./auth');
const nodeManager = require('../services/nodeManager');
const { parseURI, parseMultipleURIs, createBaseNode } = require('../services/nodeParser');
const { fetchAndParse, refreshAll } = require('../services/subFetcher');
const { testNode, testNodes } = require('../services/nodeTester');
const { nodeToURI } = require('../services/nodeParser');

// ---- Auth ----
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.get('/auth/check', requireAuth, (req, res) => {
  res.json({ success: true });
});

// ---- Nodes ----

// Get all nodes
router.get('/nodes', requireAuth, (req, res) => {
  try {
    const nodes = nodeManager.getAllNodes();
    res.json({ success: true, nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a single node (manual form)
router.post('/nodes', requireAuth, (req, res) => {
  try {
    const nodeData = req.body;

    // If a URI is provided, parse it
    if (nodeData.uri) {
      const node = parseURI(nodeData.uri);
      if (!node) {
        return res.status(400).json({ success: false, error: '无法解析该 URI' });
      }
      // Allow name override
      if (nodeData.name) node.name = nodeData.name;
      if (nodeData.region) node.region = nodeData.region;
      node.group = 'manual';
      const saved = nodeManager.addNode(node);
      return res.json({ success: true, node: saved });
    }

    // Manual node creation
    const node = createBaseNode();
    Object.assign(node, nodeData);
    node.group = 'manual';
    if (!node.name) {
      return res.status(400).json({ success: false, error: '节点名称不能为空' });
    }
    if (!node.server) {
      return res.status(400).json({ success: false, error: '服务器地址不能为空' });
    }
    const saved = nodeManager.addNode(node);
    res.json({ success: true, node: saved });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch import nodes (multiple URIs)
router.post('/nodes/batch', requireAuth, (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: '请提供节点 URI 文本' });
    }
    const nodes = parseMultipleURIs(text);
    if (nodes.length === 0) {
      return res.status(400).json({ success: false, error: '未能解析到任何有效节点' });
    }
    for (const node of nodes) {
      node.group = 'manual';
    }
    nodeManager.addNodes(nodes);
    res.json({ success: true, count: nodes.length, nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a node
router.put('/nodes/:id', requireAuth, (req, res) => {
  try {
    const updated = nodeManager.updateNode(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }
    res.json({ success: true, node: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a node
router.delete('/nodes/:id', requireAuth, (req, res) => {
  try {
    const deleted = nodeManager.deleteNode(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle node enabled status
router.patch('/nodes/:id/toggle', requireAuth, (req, res) => {
  try {
    const node = nodeManager.getNodeById(req.params.id);
    if (!node) {
      return res.status(404).json({ success: false, error: '节点不存在' });
    }
    const updated = nodeManager.updateNode(req.params.id, { enabled: !node.enabled });
    res.json({ success: true, node: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get node URI
router.get('/nodes/:id/uri', requireAuth, (req, res) => {
  try {
    const node = nodeManager.getNodeById(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: '节点不存在' });
    const uri = nodeToURI(node);
    res.json({ success: true, uri: uri || '' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test a single node
router.post('/nodes/:id/test', requireAuth, async (req, res) => {
  try {
    const node = nodeManager.getNodeById(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: '节点不存在' });
    const result = await testNode(node);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test all enabled nodes
router.post('/nodes/test-all', requireAuth, async (req, res) => {
  try {
    const nodes = nodeManager.getEnabledNodes();
    if (nodes.length === 0) return res.json({ success: true, results: [] });
    const results = await testNodes(nodes);
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- Subscriptions ----

// Get all subscription sources
router.get('/subscriptions', requireAuth, (req, res) => {
  try {
    const subs = nodeManager.getAllSubscriptions();
    res.json({ success: true, subscriptions: subs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a subscription source
router.post('/subscriptions', requireAuth, async (req, res) => {
  try {
    const { name, url, fetchMode } = req.body;
    if (!name || !url) {
      return res.status(400).json({ success: false, error: '名称和 URL 不能为空' });
    }

    // NOTE: 保存 fetchMode 供后续刷新使用
    const sub = nodeManager.addSubscription({ name, url, fetchMode: fetchMode || 'direct' });

    // Immediately fetch and parse
    try {
      const result = await fetchAndParse(sub.id, url, name, fetchMode);
      res.json({ success: true, subscription: sub, nodeCount: result.count });
    } catch (fetchError) {
      // Sub was added but fetch failed
      res.json({
        success: true,
        subscription: sub,
        warning: `订阅已添加，但拉取失败: ${fetchError.message}`
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh a single subscription
router.post('/subscriptions/:id/refresh', requireAuth, async (req, res) => {
  try {
    const subs = nodeManager.getAllSubscriptions();
    const sub = subs.find(s => s.id === req.params.id);
    if (!sub) {
      return res.status(404).json({ success: false, error: '订阅不存在' });
    }

    const result = await fetchAndParse(sub.id, sub.url, sub.name, sub.fetchMode);
    res.json({ success: true, count: result.count });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Refresh all subscriptions
router.post('/subscriptions/refresh-all', requireAuth, async (req, res) => {
  try {
    const results = await refreshAll();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a subscription
router.delete('/subscriptions/:id', requireAuth, (req, res) => {
  try {
    nodeManager.deleteSubscription(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- Config / Settings ----

// Get subscription token
router.get('/token', requireAuth, (req, res) => {
  try {
    const token = nodeManager.getToken();
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Regenerate token
router.post('/token/regenerate', requireAuth, (req, res) => {
  try {
    const token = nodeManager.regenerateToken();
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Change password
router.post('/password', requireAuth, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ success: false, error: '新密码不能为空' });
    }
    const current = nodeManager.getPassword();
    if (oldPassword !== current) {
      return res.status(403).json({ success: false, error: '原密码错误' });
    }
    nodeManager.setPassword(newPassword);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get stats
router.get('/stats', requireAuth, (req, res) => {
  try {
    const nodes = nodeManager.getAllNodes();
    const subs = nodeManager.getAllSubscriptions();
    const enabled = nodes.filter(n => n.enabled !== false);

    // Count by type
    const byType = {};
    for (const n of nodes) {
      byType[n.type] = (byType[n.type] || 0) + 1;
    }

    // Count by region
    const byRegion = {};
    for (const n of nodes) {
      byRegion[n.region] = (byRegion[n.region] || 0) + 1;
    }

    res.json({
      success: true,
      stats: {
        totalNodes: nodes.length,
        enabledNodes: enabled.length,
        subscriptions: subs.length,
        byType,
        byRegion,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 流量监控 API
 * 从多台 s-ui 桥接服务获取用户流量和系统网卡数据
 * NOTE: 支持多 bridge 架构，聚合所有服务器的数据
 */
router.get('/traffic', requireAuth, async (req, res) => {
  try {
    const http = require('http');
    const SUI_BRIDGE_TOKEN = process.env.SUI_BRIDGE_TOKEN || 'subhub_bridge_change_me';

    // 解析多 bridge 配置（与 share.js 保持一致）
    let bridges = [];
    if (process.env.SUI_BRIDGES) {
      try { bridges = JSON.parse(process.env.SUI_BRIDGES); } catch {}
    }
    if (bridges.length === 0) {
      bridges = [{ region: 'jp', hostname: '103.200.97.23', port: 9876, token: SUI_BRIDGE_TOKEN }];
    }

    /**
     * 请求单个 bridge 的流量数据
     */
    function fetchTraffic(bridge) {
      return new Promise((resolve) => {
        const opts = {
          hostname: bridge.hostname,
          port: bridge.port || 9876,
          path: '/api/traffic',
          method: 'GET',
          headers: { 'X-Token': bridge.token || SUI_BRIDGE_TOKEN },
          timeout: 8000,
        };
        const r = http.request(opts, (resp) => {
          let body = '';
          resp.on('data', c => body += c);
          resp.on('end', () => {
            try { resolve({ region: bridge.region, ...JSON.parse(body) }); }
            catch { resolve({ region: bridge.region, success: false, users: [] }); }
          });
        });
        r.on('error', () => resolve({ region: bridge.region, success: false, users: [] }));
        r.on('timeout', () => { r.destroy(); resolve({ region: bridge.region, success: false, users: [] }); });
        r.end();
      });
    }

    // 并行请求所有 bridge
    const results = await Promise.all(bridges.map(fetchTraffic));

    // 聚合返回：合并所有用户，系统数据按 region 分组
    const allUsers = [];
    const systems = {};
    let overallSuccess = false;
    for (const result of results) {
      if (result.success) overallSuccess = true;
      // 用户数据添加 region 标识
      for (const user of (result.users || [])) {
        allUsers.push({ ...user, region: result.region });
      }
      if (result.system) {
        systems[result.region] = result.system;
      }
    }

    res.json({
      success: overallSuccess,
      users: allUsers,
      system: systems[bridges[0]?.region] || { rx: 0, tx: 0, uptimeSeconds: 0 },
      systems,
    });
  } catch (error) {
    res.json({
      success: false,
      error: `桥接不可用: ${error.message}`,
      users: [], system: { rx: 0, tx: 0, uptimeSeconds: 0 }
    });
  }
});

/**
 * 获取 s-ui 入站列表（动态）
 * NOTE: 从 bridge 实时获取，确保与 s-ui 后台保持同步
 */
router.get('/sui-inbounds', requireAuth, async (req, res) => {
  try {
    const http = require('http');
    const SUI_BRIDGE_TOKEN = process.env.SUI_BRIDGE_TOKEN || 'subhub_bridge_change_me';

    let bridges = [];
    if (process.env.SUI_BRIDGES) {
      try { bridges = JSON.parse(process.env.SUI_BRIDGES); } catch {}
    }
    if (bridges.length === 0) {
      bridges = [{ region: 'jp', hostname: '103.200.97.23', port: 9876, token: SUI_BRIDGE_TOKEN }];
    }

    function fetchInbounds(bridge) {
      return new Promise((resolve) => {
        const opts = {
          hostname: bridge.hostname,
          port: bridge.port || 9876,
          path: '/api/inbounds',
          method: 'GET',
          headers: { 'X-Token': bridge.token || SUI_BRIDGE_TOKEN },
          timeout: 8000,
        };
        const r = http.request(opts, (resp) => {
          let body = '';
          resp.on('data', c => body += c);
          resp.on('end', () => {
            try {
              const data = JSON.parse(body);
              const inbounds = (data.inbounds || []).map(ib => ({
                ...ib, region: bridge.region,
              }));
              resolve({ region: bridge.region, success: true, inbounds });
            } catch {
              resolve({ region: bridge.region, success: false, inbounds: [] });
            }
          });
        });
        r.on('error', () => resolve({ region: bridge.region, success: false, inbounds: [] }));
        r.on('timeout', () => { r.destroy(); resolve({ region: bridge.region, success: false, inbounds: [] }); });
        r.end();
      });
    }

    const results = await Promise.all(bridges.map(fetchInbounds));
    const allInbounds = [];
    let overallSuccess = false;
    for (const result of results) {
      if (result.success) overallSuccess = true;
      allInbounds.push(...result.inbounds);
    }

    res.json({ success: overallSuccess, inbounds: allInbounds });
  } catch (error) {
    res.json({ success: false, error: error.message, inbounds: [] });
  }
});
// ==================== Bridge 管理 ====================

const fs = require('fs');
const path = require('path');
const BRIDGES_FILE = path.join(__dirname, '../data/bridges.json');

/**
 * 读取 bridges.json
 * NOTE: 环境变量 SUI_BRIDGES 作为 fallback，面板管理后优先使用 JSON 文件
 */
function loadBridges() {
  try {
    if (fs.existsSync(BRIDGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(BRIDGES_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  // fallback: 从环境变量读取并迁移到文件
  if (process.env.SUI_BRIDGES) {
    try {
      const envBridges = JSON.parse(process.env.SUI_BRIDGES);
      if (envBridges.length > 0) {
        const migrated = envBridges.map(b => ({
          id: `bridge_${b.region}_${Date.now()}`,
          region: b.region,
          label: b.label || b.region,
          hostname: b.hostname,
          port: b.port || 9876,
          token: b.token,
          createdAt: new Date().toISOString(),
        }));
        saveBridges(migrated);
        return migrated;
      }
    } catch {}
  }
  return [];
}

function saveBridges(bridges) {
  fs.writeFileSync(BRIDGES_FILE, JSON.stringify(bridges, null, 2));
}

/**
 * 测试 Bridge 连接
 * @returns {Promise<{success, clients, latency, error}>}
 */
function testBridgeConnection(hostname, port, token) {
  return new Promise((resolve) => {
    const http = require('http');
    const start = Date.now();
    const opts = {
      hostname, port,
      path: '/health',
      method: 'GET',
      headers: { 'X-Token': token },
      timeout: 5000,
    };
    const req = http.request(opts, (resp) => {
      let body = '';
      resp.on('data', c => body += c);
      resp.on('end', () => {
        const latency = Date.now() - start;
        try {
          const data = JSON.parse(body);
          resolve({ success: data.status === 'ok', clients: data.clients || 0, latency });
        } catch {
          resolve({ success: false, error: '响应解析失败', latency });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ success: false, error: '连接超时' }); });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.end();
  });
}

/** 获取所有 Bridge（token 脱敏） */
router.get('/bridges', requireAuth, async (req, res) => {
  const bridges = loadBridges();
  // NOTE: 并行测试所有 bridge 状态
  const results = await Promise.all(bridges.map(async (b) => {
    const test = await testBridgeConnection(b.hostname, b.port, b.token);
    return {
      ...b,
      token: b.token.substring(0, 8) + '****',
      status: test.success ? 'online' : 'offline',
      clients: test.clients || 0,
      latency: test.latency || 0,
    };
  }));
  res.json({ success: true, bridges: results });
});

/** 添加新 Bridge */
router.post('/bridges', requireAuth, async (req, res) => {
  try {
    const { region, label, hostname, port, token } = req.body;
    if (!region || !hostname || !token) {
      return res.status(400).json({ success: false, error: '缺少必填参数 (region, hostname, token)' });
    }

    // 测试连接
    const test = await testBridgeConnection(hostname, port || 9876, token);
    if (!test.success) {
      return res.status(400).json({
        success: false,
        error: `连接测试失败: ${test.error || '无法连接到 Bridge'}，请确认服务器已部署 sui_bridge.py`
      });
    }

    const bridges = loadBridges();
    // 检查 region 是否重复
    if (bridges.find(b => b.region === region)) {
      return res.status(400).json({ success: false, error: `区域 "${region}" 已存在` });
    }

    const newBridge = {
      id: `bridge_${region}_${Date.now()}`,
      region,
      label: label || region,
      hostname,
      port: port || 9876,
      token,
      createdAt: new Date().toISOString(),
    };
    bridges.push(newBridge);
    saveBridges(bridges);

    res.json({ success: true, bridge: { ...newBridge, token: token.substring(0, 8) + '****' }, test });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** 更新 Bridge */
router.put('/bridges/:id', requireAuth, async (req, res) => {
  try {
    const bridges = loadBridges();
    const idx = bridges.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Bridge 不存在' });

    const { label, hostname, port, token } = req.body;
    if (label) bridges[idx].label = label;
    if (hostname) bridges[idx].hostname = hostname;
    if (port) bridges[idx].port = port;
    if (token) bridges[idx].token = token;

    // 测试更新后的连接
    const test = await testBridgeConnection(bridges[idx].hostname, bridges[idx].port, bridges[idx].token);

    saveBridges(bridges);
    res.json({ success: true, bridge: { ...bridges[idx], token: bridges[idx].token.substring(0, 8) + '****' }, test });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** 删除 Bridge */
router.delete('/bridges/:id', requireAuth, (req, res) => {
  const bridges = loadBridges();
  const idx = bridges.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Bridge 不存在' });

  const removed = bridges.splice(idx, 1)[0];
  saveBridges(bridges);
  res.json({ success: true, deleted: removed.region });
});

/** 手动测试 Bridge 连接 */
router.post('/bridges/:id/test', requireAuth, async (req, res) => {
  const bridges = loadBridges();
  const bridge = bridges.find(b => b.id === req.params.id);
  if (!bridge) return res.status(404).json({ success: false, error: 'Bridge 不存在' });

  const test = await testBridgeConnection(bridge.hostname, bridge.port, bridge.token);
  res.json({ success: true, ...test });
});

// NOTE: 导出 loadBridges 供 share.js 使用
router.loadBridges = loadBridges;

module.exports = router;
