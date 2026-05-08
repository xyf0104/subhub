/**
 * share.js - 分享订阅路由（多区域 s-ui 版）
 * 管理员 API（需认证）+ 公开订阅链接（token 验证）
 * 集成多台 s-ui 桥接：创建分享时按区域自动创建独立用户，
 * 删除分享时自动删除用户（立即断网）
 */

const express = require('express');
const router = express.Router();
const http = require('http');
const { requireAuth } = require('./auth');
const nodeManager = require('../services/nodeManager');
const { generate, detectTarget } = require('../services/configGenerator');

// ---- 多 Bridge 基础设施 ----

const SUI_BRIDGE_TOKEN = process.env.SUI_BRIDGE_TOKEN || 'subhub_bridge_change_me';

/**
 * 解析多 bridge 配置（从 SUI_BRIDGES 环境变量）
 * NOTE: 每个 bridge 对应一个区域的 s-ui 服务器
 */
function getAllBridges() {
  let bridges = [];
  if (process.env.SUI_BRIDGES) {
    try { bridges = JSON.parse(process.env.SUI_BRIDGES); } catch {}
  }
  if (bridges.length === 0) {
    bridges = [{ region: 'jp', label: '日本', hostname: '103.200.97.23', port: 9876, token: SUI_BRIDGE_TOKEN }];
  }
  return bridges;
}

/**
 * 根据 region 获取对应的 bridge 配置
 */
function getBridgeConfig(region) {
  return getAllBridges().find(b => b.region === region);
}

/**
 * 向指定区域的 s-ui bridge 发送请求
 */
function suiBridgeRequest(region, method, path, body = null) {
  const bridge = getBridgeConfig(region);
  if (!bridge) return Promise.reject(new Error(`未找到区域 ${region} 的 bridge 配置`));

  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: bridge.hostname,
      port: bridge.port || 9876,
      path: path,
      method,
      headers: {
        'X-Token': bridge.token || SUI_BRIDGE_TOKEN,
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

/**
 * 兼容旧数据：将旧的 suiClientName/suiInboundIds 转换为 suiBridges 格式
 * NOTE: 旧数据只有 jp 区域，自动迁移
 */
function normalizeSuiBridges(share) {
  if (share.suiBridges) return share.suiBridges;
  if (share.suiClientName) {
    return {
      jp: { clientName: share.suiClientName, inboundIds: share.suiInboundIds || [] }
    };
  }
  return {};
}

// ---- 管理员 API ----

/**
 * 获取所有分享（同步多区域 s-ui 用户流量）
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const shares = nodeManager.getAllShares();
    const bridges = getAllBridges();

    // 并行从所有 bridge 获取用户数据
    const allClientsMap = new Map();
    await Promise.all(bridges.map(async (bridge) => {
      try {
        const data = await suiBridgeRequest(bridge.region, 'GET', '/api/clients');
        for (const c of (data.clients || [])) {
          allClientsMap.set(`${bridge.region}:${c.name}`, c);
        }
      } catch { /* bridge 不可用时不阻塞 */ }
    }));

    // 合并流量到分享数据
    for (const share of shares) {
      const suiBridges = normalizeSuiBridges(share);
      let totalTraffic = 0;
      for (const [region, info] of Object.entries(suiBridges)) {
        const key = `${region}:${info.clientName}`;
        const client = allClientsMap.get(key);
        if (client) {
          totalTraffic += (client.up || 0) + (client.down || 0);
        }
      }
      if (totalTraffic > 0) share.trafficUsed = totalTraffic;
    }

    res.json({ success: true, shares });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 获取所有区域的 s-ui 可用入站列表
 * NOTE: 已由 api.js 的 /api/sui-inbounds 处理，这里保留向下兼容
 */
router.get('/sui-inbounds', requireAuth, async (req, res) => {
  try {
    const bridges = getAllBridges();
    const allInbounds = [];
    await Promise.all(bridges.map(async (bridge) => {
      try {
        const data = await suiBridgeRequest(bridge.region, 'GET', '/api/inbounds');
        for (const ib of (data.inbounds || [])) {
          allInbounds.push({ ...ib, region: bridge.region });
        }
      } catch {}
    }));
    res.json({ success: true, inbounds: allInbounds });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 创建分享（多区域 s-ui 版）
 * @body { title, nodeIds, trafficLimitGB, expireDays, suiBridges: { jp: { inboundIds }, us: { inboundIds } } }
 * NOTE: 按区域分别创建 s-ui 用户
 */
router.post('/', requireAuth, (req, res) => {
  (async () => {
    const { title, nodeIds = [], trafficLimitGB, expireDays, expireAt, suiBridges: suiBridgesInput } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, error: '请填写分享标题' });
    }

    // 验证手动选择的节点
    const allNodes = nodeManager.getAllNodes();
    const validIds = nodeIds.filter(id => allNodes.some(n => n.id === id));

    // 按区域创建 s-ui 用户
    const suiBridges = {};
    const safeName = title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').substring(0, 30);

    if (suiBridgesInput && typeof suiBridgesInput === 'object') {
      for (const [region, config] of Object.entries(suiBridgesInput)) {
        const inboundIds = config.inboundIds || [];
        if (inboundIds.length === 0) continue;

        const bridge = getBridgeConfig(region);
        if (!bridge) continue;

        // NOTE: 每个区域使用独立的流量/到期设置，回退到全局设置
        const regionTraffic = config.trafficLimitGB !== undefined ? config.trafficLimitGB : trafficLimitGB;
        const regionExpireDays = config.expireDays !== undefined ? config.expireDays : expireDays;

        const suiBody = { name: safeName, inboundIds };
        if (regionTraffic) {
          suiBody.volume = Math.round(regionTraffic * 1073741824);
        }
        if (regionExpireDays) {
          suiBody.expiry = Math.floor((Date.now() + regionExpireDays * 86400000) / 1000);
        }

        console.log(`[Share] 调用 ${region} bridge 创建用户:`, safeName);
        const suiResult = await suiBridgeRequest(region, 'POST', '/api/clients', suiBody);
        console.log(`[Share] ${region} bridge 返回:`, JSON.stringify(suiResult).substring(0, 200));

        if (!suiResult.success) {
          console.error(`[Share] ${region} s-ui 创建用户失败:`, suiResult.error);
          continue;
        }

        suiBridges[region] = {
          clientName: safeName, inboundIds,
          trafficLimitGB: regionTraffic || undefined,
          expireDays: regionExpireDays || undefined,
        };
        console.log(`[Share] ${region} s-ui 用户创建成功:`, safeName);
      }
    }

    const hasSui = Object.keys(suiBridges).length > 0;
    if (validIds.length === 0 && !hasSui) {
      return res.status(400).json({ success: false, error: '请至少选择一个节点或自建入站' });
    }

    console.log('[Share] 创建分享, 节点数:', validIds.length, 'sui区域:', Object.keys(suiBridges).join(',') || '无');
    const share = nodeManager.createShare({
      title,
      nodeIds: validIds,
      trafficLimit: trafficLimitGB ? Math.round(trafficLimitGB * 1073741824) : 0,
      expireDays: expireDays || null,
      expireAt: expireAt || null,
      suiBridges: hasSui ? suiBridges : undefined,
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
 * 更新分享（多区域版：续期/改流量/改节点/改 s-ui 入站权限）
 * NOTE: 支持编辑时新增区域（创建用户）、移除区域（删除用户）、更新已有区域
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { trafficLimitGB, expireDays, expireAt, suiBridges: suiBridgesInput, nodeOverrides, ...rest } = req.body;
    const updates = { ...rest };

    // NOTE: 后端防线 — 过滤掉前端可能误传的纯数字 s-ui inbound ID
    if (updates.nodeIds && Array.isArray(updates.nodeIds)) {
      updates.nodeIds = updates.nodeIds.filter(id => id.includes('-'));
    }

    if (trafficLimitGB !== undefined) {
      updates.trafficLimit = trafficLimitGB > 0 ? Math.round(trafficLimitGB * 1073741824) : 0;
    }
    if (expireDays) {
      updates.expireAt = new Date(Date.now() + expireDays * 86400000).toISOString();
    } else if (expireAt !== undefined) {
      updates.expireAt = expireAt;
    }

    if (nodeOverrides !== undefined) {
      updates.nodeOverrides = nodeOverrides;
    }

    const oldShare = nodeManager.getShareById(req.params.id);
    if (!oldShare) {
      return res.status(404).json({ success: false, error: '分享不存在' });
    }
    const oldBridges = normalizeSuiBridges(oldShare);
    const newBridges = suiBridgesInput || {};
    const safeName = (updates.title || oldShare.title).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').substring(0, 30);

    // ---- s-ui 同步（同步执行，确保保存前完成） ----
    const finalSuiBridges = { ...oldBridges };

    // 1. 新增区域 — 在对应 bridge 创建 s-ui 用户
    for (const [region, config] of Object.entries(newBridges)) {
      const inboundIds = config.inboundIds || [];
      if (inboundIds.length === 0) continue;
      if (oldBridges[region]?.clientName) continue; // 已有用户，跳过（后面更新）

      const bridge = getBridgeConfig(region);
      if (!bridge) continue;

      // NOTE: 优先使用区域独立的流量/到期，回退到全局设置
      const regionTraffic = config.trafficLimitGB !== undefined ? config.trafficLimitGB : trafficLimitGB;

      const suiBody = { name: safeName, inboundIds };
      if (regionTraffic) {
        suiBody.volume = Math.round(regionTraffic * 1073741824);
      }
      if (updates.expireAt) {
        suiBody.expiry = Math.floor(new Date(updates.expireAt).getTime() / 1000);
      } else if (oldShare.expireAt) {
        suiBody.expiry = Math.floor(new Date(oldShare.expireAt).getTime() / 1000);
      }

      console.log(`[Share] 编辑时新增 ${region} s-ui 用户:`, safeName);
      try {
        const result = await suiBridgeRequest(region, 'POST', '/api/clients', suiBody);
        if (result.success) {
          finalSuiBridges[region] = {
            clientName: safeName, inboundIds,
            trafficLimitGB: regionTraffic || undefined,
          };
          console.log(`[Share] ${region} s-ui 用户创建成功`);
        } else {
          console.error(`[Share] ${region} s-ui 创建失败:`, result.error);
        }
      } catch (e) {
        console.error(`[Share] ${region} bridge 不可用:`, e.message);
      }
    }

    // 2. 更新已有区域 — 同步入站权限/流量/到期
    for (const [region, oldInfo] of Object.entries(oldBridges)) {
      if (!oldInfo.clientName) continue;
      const newConfig = newBridges[region];

      // 如果新数据中该区域入站为空 → 删除用户
      if (newConfig && (newConfig.inboundIds || []).length === 0) {
        console.log(`[Share] 编辑时移除 ${region} s-ui 用户:`, oldInfo.clientName);
        try {
          await suiBridgeRequest(region, 'DELETE', `/api/clients/${encodeURIComponent(oldInfo.clientName)}`);
          delete finalSuiBridges[region];
        } catch (e) {
          console.error(`[Share] ${region} 删除失败:`, e.message);
        }
        continue;
      }

      // 否则更新
      const bridgeBody = {};
      if (updates.title && updates.title !== oldInfo.clientName) {
        bridgeBody.newName = safeName;
      }
      if (newConfig?.inboundIds) {
        bridgeBody.inboundIds = newConfig.inboundIds;
        finalSuiBridges[region] = { ...oldInfo, inboundIds: newConfig.inboundIds };
      }
      if (trafficLimitGB !== undefined) {
        bridgeBody.volume = trafficLimitGB > 0 ? Math.round(trafficLimitGB * 1073741824) : 0;
      }
      if (updates.expireAt !== undefined) {
        bridgeBody.expiry = updates.expireAt ? Math.floor(new Date(updates.expireAt).getTime() / 1000) : 0;
      }

      if (Object.keys(bridgeBody).length > 0) {
        try {
          await suiBridgeRequest(region, 'PUT', `/api/clients/${encodeURIComponent(oldInfo.clientName)}`, bridgeBody);
          if (bridgeBody.newName) {
            finalSuiBridges[region] = { ...finalSuiBridges[region], clientName: safeName };
          }
        } catch (e) {
          console.error(`[Share] ${region} s-ui 更新失败:`, e.message);
        }
      }
    }

    // 保存最终的 suiBridges 状态
    updates.suiBridges = Object.keys(finalSuiBridges).length > 0 ? finalSuiBridges : undefined;

    const updated = nodeManager.updateShare(req.params.id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: '分享不存在' });
    }

    res.json({ success: true, share: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 删除分享（多区域版：遍历所有关联 bridge 删除用户）
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const share = nodeManager.getShareById(req.params.id);
    if (!share) {
      return res.status(404).json({ success: false, error: '分享不存在' });
    }

    // 遍历所有关联区域，分别删除 s-ui 用户
    const suiBridges = normalizeSuiBridges(share);
    for (const [region, info] of Object.entries(suiBridges)) {
      if (!info.clientName) continue;
      try {
        await suiBridgeRequest(region, 'DELETE', `/api/clients/${encodeURIComponent(info.clientName)}`);
        console.log(`[Share] 已删除 ${region} s-ui 用户: ${info.clientName}`);
      } catch (e) {
        console.error(`[Share] 删除 ${region} s-ui 用户失败: ${e.message}`);
      }
    }

    // 清理本地临时节点
    if (share.suiClientName) {
      nodeManager.deleteNodesByGroup(`sui-share-${share.suiClientName}`);
    }

    nodeManager.deleteShare(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

// ---- 公开分享订阅路由（独立导出，挂载到 /s/:token） ----

const { parseURI } = require('../services/nodeParser');

/**
 * 从指定区域的 bridge 获取 s-ui 用户的节点信息（URI + remark）
 * NOTE: 返回 {uri, remark} 对，用于精确匹配入站 tag
 */
function fetchSuiClientLinks(region, clientName) {
  const bridge = getBridgeConfig(region);
  if (!bridge) return Promise.resolve([]);

  return new Promise((resolve) => {
    const opts = {
      hostname: bridge.hostname,
      port: bridge.port || 9876,
      path: '/api/clients',
      method: 'GET',
      headers: { 'X-Token': bridge.token || SUI_BRIDGE_TOKEN },
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
            // NOTE: 返回 {uri, remark}，用于后续的精确匹配
            resolve(client.links.filter(l => l.uri).map(l => ({ uri: l.uri, remark: l.remark || '' })));
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
 * 处理公开分享订阅请求（多区域版）
 * 路径: GET /s/:token
 * NOTE: 动态合并 SubHub 节点 + 各区域 s-ui 用户节点
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

    // 1. SubHub 本地节点
    const allNodes = nodeManager.getAllNodes();
    const shareNodes = share.nodeIds
      .filter(id => !id.startsWith('sui_'))
      .map(id => allNodes.find(n => n.id === id))
      .filter(n => n && n.enabled !== false)
      .map(n => {
        const ov = (share.nodeOverrides || {})[n.id];
        if (ov) return { ...n, ...ov };
        return n;
      });

    // 2. 各区域 s-ui 用户节点（按 region 分别拉取 + 按 inboundIds 过滤）
    const suiBridges = normalizeSuiBridges(share);
    let suiNodes = [];

    for (const [region, info] of Object.entries(suiBridges)) {
      if (!info.clientName) continue;

      // 获取该区域允许的入站 tag 列表
      let allowedTags = null;
      const allowedIds = new Set(info.inboundIds || []);
      if (allowedIds.size > 0) {
        try {
          const inboundData = await suiBridgeRequest(region, 'GET', '/api/inbounds');
          allowedTags = new Set();
          for (const ib of (inboundData.inbounds || [])) {
            if (allowedIds.has(ib.id)) {
              allowedTags.add(ib.tag);
            }
          }
        } catch {
          allowedTags = null;
        }
      }

      // NOTE: fetchSuiClientLinks 现在返回 {uri, remark} 对
      const linkItems = await fetchSuiClientLinks(region, info.clientName);
      for (const item of linkItems) {
        try {
          const node = parseURI(item.uri);
          if (!node) continue;

          // NOTE: 用 remark 精确匹配入站 tag，避免 includes 模糊匹配错漏
          if (allowedTags && allowedTags.size > 0) {
            if (!allowedTags.has(item.remark)) continue;
          }

          node.id = `sui_${region}_${info.clientName}_${node.name || ''}`;
          suiNodes.push(node);
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
