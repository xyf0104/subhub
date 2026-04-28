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
 * 通过 s-ui 桥接服务获取用户流量和系统网卡数据
 */
router.get('/traffic', requireAuth, async (req, res) => {
  try {
    const http = require('http');
    const SUI_BRIDGE_TOKEN = process.env.SUI_BRIDGE_TOKEN || 'subhub_bridge_change_me';

    const data = await new Promise((resolve, reject) => {
      const opts = {
        hostname: '103.200.97.23',
        port: 9876,
        path: '/api/traffic',
        method: 'GET',
        headers: { 'X-Token': SUI_BRIDGE_TOKEN },
        timeout: 8000,
      };
      const r = http.request(opts, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve({ success: false, error: body }); }
        });
      });
      r.on('error', e => reject(e));
      r.on('timeout', () => { r.destroy(); reject(new Error('超时')); });
      r.end();
    });

    res.json(data);
  } catch (error) {
    res.json({
      success: false,
      error: `桥接不可用: ${error.message}`,
      users: [], system: { rx: 0, tx: 0, uptimeSeconds: 0 }
    });
  }
});

module.exports = router;
