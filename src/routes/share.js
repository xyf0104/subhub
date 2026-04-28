/**
 * share.js - 分享订阅路由
 * 管理员 API（需认证）+ 公开订阅链接（token 验证）
 * 集成 s-ui 桥接：创建分享时自动在日本服务器创建独立用户，
 * 删除分享时自动删除用户（立即断网）
 */

const express = require('express');
const router = express.Router();
const http = require('http');
const { requireAuth } = require('./auth');
const nodeManager = require('../services/nodeManager');
const { generate, detectTarget } = require('../services/configGenerator');

// s-ui 桥接服务配置（从环境变量读取，install.sh 自动写入 .env）
const SUI_BRIDGE_URL = process.env.SUI_BRIDGE_URL || 'http://127.0.0.1:9876';
const SUI_BRIDGE_TOKEN = process.env.SUI_BRIDGE_TOKEN || 'subhub_bridge_change_me';

/**
 * 调用 s-ui 桥接 API
 */
function suiBridgeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: '103.200.97.23',
      port: 9876,
      path: path,
      method,
      headers: {
        'X-Token': SUI_BRIDGE_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: 10000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false, error: data }); }
      });
    });
    req.on('error', e => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('桥接服务超时')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---- 管理员 API ----

/**
 * 获取所有分享（同步 s-ui 用户流量）
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const shares = nodeManager.getAllShares();

    // 从桥接读取 s-ui 所有用户的流量数据
    let suiClients = [];
    try {
      const suiData = await suiBridgeRequest('GET', '/api/clients');
      suiClients = suiData.clients || [];
    } catch { /* 桥接不可用时不阻塞 */ }

    // 合并 s-ui 流量到分享数据
    const suiMap = new Map(suiClients.map(c => [c.name, c]));
    for (const share of shares) {
      if (share.suiClientName && suiMap.has(share.suiClientName)) {
        const client = suiMap.get(share.suiClientName);
        // NOTE: s-ui 的 up + down 就是该用户的实际流量
        share.trafficUsed = (client.up || 0) + (client.down || 0);
      }
    }

    res.json({ success: true, shares });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取日本服务器（s-ui）可用协议列表
 */
router.get('/sui-inbounds', requireAuth, async (req, res) => {
  try {
    const result = await suiBridgeRequest('GET', '/api/inbounds');
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 创建分享
 * @body { title, nodeIds, trafficLimitGB, expireDays, suiEnabled, suiInboundIds }
 * 
 * suiEnabled=true 时，自动在日本 s-ui 创建独立用户，
 * 生成的节点 URI 会自动加入分享
 */
router.post('/', requireAuth, (req, res) => {
  (async () => {
    const { title, nodeIds = [], trafficLimitGB, expireDays, expireAt, suiEnabled, suiInboundIds } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: '请填写分享标题' });
    }

    // 验证手动选择的节点
    const allNodes = nodeManager.getAllNodes();
    const validIds = nodeIds.filter(id => allNodes.some(n => n.id === id));

    // 如果启用了 s-ui 集成，自动创建日本服务器用户
    let suiClientName = null;
    if (suiEnabled) {
      // NOTE: 使用分享标题作为 s-ui 用户名，方便在面板中识别
      const safeName = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').substring(0, 30);
      const suiBody = {
        name: safeName,
        inboundIds: suiInboundIds || [1, 2, 3, 4],
      };

      if (trafficLimitGB) {
        suiBody.volume = Math.round(trafficLimitGB * 1073741824);
      }
      if (expireDays) {
        suiBody.expiry = Math.floor((Date.now() + expireDays * 86400000) / 1000);
      }

      console.log('[Share] 调用 s-ui 桥接创建用户:', safeName);
      const suiResult = await suiBridgeRequest('POST', '/api/clients', suiBody);
      console.log('[Share] s-ui 返回:', JSON.stringify(suiResult).substring(0, 200));

      if (!suiResult.success) {
        return res.status(500).json({ success: false, error: 's-ui 创建用户失败: ' + (suiResult.error || '') });
      }

      suiClientName = safeName;
      // NOTE: 不再把 s-ui 返回的 URI 存入本地节点池
      // 订阅输出时通过 fetchSuiClientLinks 动态拉取 + suiInboundIds 过滤
      console.log('[Share] s-ui 用户创建成功:', safeName);
    }

    if (validIds.length === 0 && !suiClientName) {
      return res.status(400).json({ success: false, error: '请至少选择一个节点或启用日本节点' });
    }

    console.log('[Share] 创建分享, 节点数:', validIds.length, 's-ui:', suiClientName || '无');
    const share = nodeManager.createShare({
      title,
      nodeIds: validIds,
      trafficLimit: trafficLimitGB ? Math.round(trafficLimitGB * 1073741824) : 0,
      expireDays: expireDays || null,
      expireAt: expireAt || null,
      suiClientName: suiClientName,
      suiInboundIds: suiInboundIds || (suiEnabled ? [1,2,3,4] : undefined),
    });

    console.log('[Share] 创建成功:', share.title, share.id);
    res.json({ success: true, share });
  })().catch(error => {
    console.error('[Share] POST 错误:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

/**
 * 更新分享（续期/改流量/改节点/改 s-ui 入站权限）
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { trafficLimitGB, expireDays, expireAt, suiInboundIds, nodeOverrides, ...rest } = req.body;
    const updates = { ...rest };

    // NOTE: 后端防线 — 过滤掉前端可能误传的纯数字 s-ui inbound ID
    if (updates.nodeIds && Array.isArray(updates.nodeIds)) {
      updates.nodeIds = updates.nodeIds.filter(id => id.includes('-'));
    }

    // NOTE: trafficLimitGB=0 或 undefined 表示无限
    if (trafficLimitGB !== undefined) {
      updates.trafficLimit = trafficLimitGB > 0 ? Math.round(trafficLimitGB * 1073741824) : 0;
    }
    // NOTE: expireAt=null 表示清除到期（永久有效）
    if (expireDays) {
      updates.expireAt = new Date(Date.now() + expireDays * 86400000).toISOString();
    } else if (expireAt !== undefined) {
      updates.expireAt = expireAt; // null = 永久
    }

    if (suiInboundIds !== undefined) {
      updates.suiInboundIds = suiInboundIds;
    }

    // NOTE: 存储 per-share 节点覆盖配置（仅影响此分享的订阅输出）
    if (nodeOverrides !== undefined) {
      updates.nodeOverrides = nodeOverrides;
    }

    // NOTE: 在更新前获取旧分享数据，检测标题是否变更
    const oldShare = nodeManager.getShareById(req.params.id);
    const oldTitle = oldShare ? oldShare.suiClientName : null;

    const updated = nodeManager.updateShare(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: '分享不存在' });
    }

    // NOTE: 先返回响应，s-ui bridge 同步在后台异步执行（避免卡顿）
    res.json({ success: true, share: updated });

    // 异步同步到 s-ui bridge（名称 + 入站权限 + 流量 + 到期时间）
    if (oldTitle) {
      const bridgeBody = {};

      // 标题变更 → 同步重命名 s-ui 用户
      if (updates.title && updates.title !== oldTitle) {
        bridgeBody.newName = updates.title;
      }

      if (suiInboundIds !== undefined) bridgeBody.inboundIds = suiInboundIds;
      if (trafficLimitGB !== undefined) {
        bridgeBody.volume = trafficLimitGB > 0 ? Math.round(trafficLimitGB * 1073741824) : 0;
      }
      if (updates.expireAt !== undefined) {
        bridgeBody.expiry = updates.expireAt ? Math.floor(new Date(updates.expireAt).getTime() / 1000) : 0;
      }

      if (Object.keys(bridgeBody).length > 0) {
        // NOTE: 用旧名（oldTitle）查找 bridge 中的客户端
        suiBridgeRequest('PUT', `/api/clients/${encodeURIComponent(oldTitle)}`, bridgeBody)
          .then(() => {
            // 改名成功后更新本地 suiClientName
            if (bridgeBody.newName) {
              nodeManager.updateShare(req.params.id, { suiClientName: bridgeBody.newName });
            }
          })
          .catch(e => console.error(`[Share] s-ui 同步失败: ${e.message}`));
      }
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除分享
 * 如果分享关联了 s-ui 用户，自动删除该用户（立即断网）
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    // 先获取分享信息，检查是否有 s-ui 关联
    const share = nodeManager.getShareById(req.params.id);
    if (!share) {
      return res.status(404).json({ success: false, error: '分享不存在' });
    }

    // 如果有 s-ui 用户关联，先删除远端用户（立即断网）
    if (share.suiClientName) {
      try {
        await suiBridgeRequest('DELETE', `/api/clients/${encodeURIComponent(share.suiClientName)}`);
        console.log(`[Share] 已删除 s-ui 用户: ${share.suiClientName}`);
      } catch (e) {
        console.log(`[Share] 删除 s-ui 用户失败: ${e.message}`);
      }
      // 同时清理 SubHub 中的临时节点
      nodeManager.deleteNodesByGroup(`sui-share-${share.suiClientName}`);
    }

    const deleted = nodeManager.deleteShare(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

// ---- 公开分享订阅路由（独立导出，挂载到 /s/:token） ----

const { parseURI } = require('../services/nodeParser');

/**
 * 从桥接获取 s-ui 用户的节点 URI 列表
 */
function fetchSuiClientLinks(clientName) {
  return new Promise((resolve) => {
    const opts = {
      hostname: '103.200.97.23',
      port: 9876,
      path: '/api/clients',
      method: 'GET',
      headers: { 'X-Token': SUI_BRIDGE_TOKEN },
      timeout: 5000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const client = (parsed.clients || []).find(c => c.name === clientName);
          if (client && client.links) {
            // links 是 [{tag, uri}] 数组
            const uris = client.links.map(l => l.uri).filter(Boolean);
            resolve(uris);
          } else {
            resolve([]);
          }
        } catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/**
 * 处理公开分享订阅请求
 * 路径: GET /s/:token
 * NOTE: 动态合并 SubHub 节点 + s-ui 用户节点
 */
module.exports.shareSubscribeHandler = async (req, res) => {
  try {
    const { token } = req.params;
    const share = nodeManager.getShareByToken(token);

    if (!share) {
      return res.status(404).send('# 订阅链接不存在');
    }

    // 检查是否有效（过期/超流量）
    if (!nodeManager.isShareValid(share)) {
      const reason = [];
      if (share.expireAt && new Date(share.expireAt) < new Date()) {
        reason.push('已过期');
      }
      if (share.trafficLimit > 0 && share.trafficUsed >= share.trafficLimit) {
        reason.push('流量已用完');
      }
      if (!share.enabled) {
        reason.push('已禁用');
      }
      return res.status(410).send(`# 订阅已失效: ${reason.join(', ')}`);
    }

    // 1. SubHub 本地节点（排除 sui_ 前缀的节点，它们会从 s-ui 动态拉取）
    const allNodes = nodeManager.getAllNodes();
    const shareNodes = share.nodeIds
      .filter(id => !id.startsWith('sui_'))
      .map(id => allNodes.find(n => n.id === id))
      .filter(n => n && n.enabled !== false)
      .map(n => {
        // NOTE: 应用 per-share 节点覆盖配置（仅改变此订阅的输出，不影响原始数据）
        const ov = (share.nodeOverrides || {})[n.id];
        if (ov) return { ...n, ...ov };
        return n;
      });

    // 2. s-ui 用户节点（动态拉取，按 suiInboundIds 过滤）
    // NOTE: inbound ID 与协议的映射: 1=hysteria2, 2=tuic, 3=vless, 4=trojan
    const INBOUND_ID_TO_TYPE = { 1: 'hysteria2', 2: 'tuic', 3: 'vless', 4: 'trojan' };
    let suiNodes = [];
    if (share.suiClientName) {
      const allowedTypes = new Set(
        (share.suiInboundIds || [1,2,3,4]).map(id => INBOUND_ID_TO_TYPE[id]).filter(Boolean)
      );
      const uris = await fetchSuiClientLinks(share.suiClientName);
      for (const uri of uris) {
        try {
          const node = parseURI(uri);
          if (node && allowedTypes.has(node.type)) {
            node.id = `sui_${share.suiClientName}_${node.name || ''}`;
            suiNodes.push(node);
          }
        } catch { /* 跳过解析失败的 */ }
      }
    }

    const allShareNodes = [...shareNodes, ...suiNodes];

    if (allShareNodes.length === 0) {
      return res.status(404).send('# 暂无可用节点');
    }

    // 检测目标格式
    const target = req.query.target || detectTarget(req.headers['user-agent']);

    // 生成配置
    const result = generate(target, {
      nodes: allShareNodes,
      title: share.title,
    });

    // 设置 Subscription-Userinfo 响应头
    const userinfo = [];
    userinfo.push(`upload=0`);
    userinfo.push(`download=${share.trafficUsed || 0}`);
    userinfo.push(`total=${share.trafficLimit || 0}`);
    if (share.expireAt) {
      userinfo.push(`expire=${Math.floor(new Date(share.expireAt).getTime() / 1000)}`);
    }
    res.setHeader('Subscription-Userinfo', userinfo.join('; '));
    // NOTE: profile-title 是小火箭/V2RayN 等客户端识别订阅名称的关键头
    res.setHeader('Profile-Title', Buffer.from(share.title).toString('base64'));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(share.title)}.yaml"; filename*=UTF-8''${encodeURIComponent(share.title)}.yaml`);
    res.setHeader('Profile-Update-Interval', '24');

    res.type(result.contentType).send(result.content);
  } catch (error) {
    res.status(500).send(`# 服务器错误: ${error.message}`);
  }
};
