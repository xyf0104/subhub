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
 * Bridge API 请求缓存
 * NOTE: 避免每次订阅请求都向远程 bridge 发 HTTP，60 秒内复用缓存
 */
const BRIDGE_CACHE = new Map();
const BRIDGE_CACHE_TTL = 60_000;

function getCachedOrFetch(cacheKey, fetcher) {
  const cached = BRIDGE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < BRIDGE_CACHE_TTL) {
    return Promise.resolve(cached.data);
  }
  return fetcher().then(data => {
    BRIDGE_CACHE.set(cacheKey, { data, ts: Date.now() });
    return data;
  });
}

/**
 * 解析多 bridge 配置
 * NOTE: 优先从 bridges.json 读取，环境变量作为 fallback
 */
function getAllBridges() {
  // NOTE: 使用 api.js 中的 loadBridges，统一管理 bridge 配置来源
  try {
    const apiRouter = require('./api');
    if (apiRouter.loadBridges) {
      const bridges = apiRouter.loadBridges();
      if (bridges.length > 0) return bridges;
    }
  } catch {}
  // fallback: 环境变量
  let bridges = [];
  if (process.env.SUI_BRIDGES) {
    try { bridges = JSON.parse(process.env.SUI_BRIDGES); } catch {}
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
 * Bridge 熔断器
 * NOTE: 当 bridge 连续失败后暂停请求，避免超时拖慢所有操作
 * 连续 3 次失败 → 熔断 30 秒 → 自动恢复探测
 */
const CIRCUIT_BREAKER = new Map();
const CB_THRESHOLD = 3;
const CB_RECOVERY_MS = 30_000;

function getCircuitState(region) {
  const state = CIRCUIT_BREAKER.get(region);
  if (!state) return { open: false };
  if (state.failures >= CB_THRESHOLD) {
    // 检查是否过了恢复期
    if (Date.now() - state.lastFailure < CB_RECOVERY_MS) {
      return { open: true };
    }
    // 恢复期到了，半开状态：允许一次探测
    return { open: false, halfOpen: true };
  }
  return { open: false };
}

function recordSuccess(region) {
  CIRCUIT_BREAKER.delete(region);
}

function recordFailure(region) {
  const state = CIRCUIT_BREAKER.get(region) || { failures: 0, lastFailure: 0 };
  state.failures += 1;
  state.lastFailure = Date.now();
  CIRCUIT_BREAKER.set(region, state);
}

/**
 * 向指定区域的 s-ui bridge 发送请求
 */
function suiBridgeRequest(region, method, path, body = null) {
  const bridge = getBridgeConfig(region);
  if (!bridge) return Promise.reject(new Error(`未找到区域 ${region} 的 bridge 配置`));

  // NOTE: 熔断检查 — bridge 不可用时直接返回，不等超时
  const cbState = getCircuitState(region);
  if (cbState.open) {
    return Promise.reject(new Error(`${region} bridge 暂时不可用（熔断中，${Math.ceil((CB_RECOVERY_MS - (Date.now() - CIRCUIT_BREAKER.get(region).lastFailure)) / 1000)}秒后重试）`));
  }

  // NOTE: GET 请求使用缓存，写操作清空缓存确保数据一致
  if (method === 'GET' && !body) {
    const cacheKey = `bridge_${region}_${path}`;
    return getCachedOrFetch(cacheKey, () => _rawBridgeRequest(bridge, method, path, null, region));
  }
  // 写操作清空该区域缓存
  for (const key of BRIDGE_CACHE.keys()) {
    if (key.includes(region)) BRIDGE_CACHE.delete(key);
  }
  return _rawBridgeRequest(bridge, method, path, body, region);
}

function _rawBridgeRequest(bridge, method, path, body, region) {
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
      // NOTE: 从 10 秒缩短到 5 秒，配合熔断机制快速失败
      timeout: 5000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          recordSuccess(region);
          resolve(result);
        } catch {
          recordSuccess(region);
          resolve({ success: false, error: data });
        }
      });
    });
    req.on('error', e => {
      recordFailure(region);
      reject(e);
    });
    req.on('timeout', () => {
      req.destroy();
      recordFailure(region);
      reject(new Error(`${region} bridge 超时`));
    });
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

        const suiBody = { name: safeName, inboundIds };
        if (regionTraffic) {
          suiBody.volume = Math.round(regionTraffic * 1073741824);
        }
        // 到期优先级: 区域 expireAt > 区域 expireDays > 全局 expireDays
        if (config.expireAt) {
          suiBody.expiry = Math.floor(new Date(config.expireAt).getTime() / 1000);
        } else if (config.expireDays) {
          suiBody.expiry = Math.floor((Date.now() + config.expireDays * 86400000) / 1000);
        } else if (expireDays) {
          suiBody.expiry = Math.floor((Date.now() + expireDays * 86400000) / 1000);
        }

        console.log(`[Share] 调用 ${region} bridge 创建用户:`, safeName);
        const suiResult = await suiBridgeRequest(region, 'POST', '/api/clients', suiBody);
        console.log(`[Share] ${region} bridge 返回:`, JSON.stringify(suiResult).substring(0, 200));

        if (!suiResult.success) {
          // NOTE: 用户可能已存在（同名残留），尝试 PUT 更新
          console.log(`[Share] ${region} 创建失败 (${suiResult.error})，尝试 PUT 更新...`);
          try {
            const putResult = await suiBridgeRequest(region, 'PUT', `/api/clients/${encodeURIComponent(safeName)}`, suiBody);
            if (putResult.success) {
              suiBridges[region] = {
                clientName: safeName, inboundIds,
                trafficLimitGB: regionTraffic,
                expireAt: config.expireAt || undefined,
              };
              console.log(`[Share] ${region} s-ui 用户 PUT 更新成功:`, safeName);
            } else {
              console.error(`[Share] ${region} PUT 也失败:`, putResult.error);
            }
          } catch (e2) {
            console.error(`[Share] ${region} PUT 更新异常:`, e2.message);
          }
          continue;
        }

        suiBridges[region] = {
          clientName: safeName, inboundIds,
          trafficLimitGB: regionTraffic,
          expireAt: config.expireAt || undefined,
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
    const { trafficLimitGB, expireDays, expireAt, suiBridges: suiBridgesInput, nodeOverrides, suiNodeOverrides, ...rest } = req.body;
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
    if (suiNodeOverrides !== undefined) {
      updates.suiNodeOverrides = suiNodeOverrides;
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
      // 到期优先级: 区域 expireAt > 全局 expireAt > 旧分享 expireAt
      if (config.expireAt) {
        suiBody.expiry = Math.floor(new Date(config.expireAt).getTime() / 1000);
      } else if (updates.expireAt) {
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
            trafficLimitGB: regionTraffic,
            expireAt: config.expireAt || undefined,
          };
          console.log(`[Share] ${region} s-ui 用户创建成功`);
        } else {
          // NOTE: 用户已存在时改用 PUT 更新，避免区域丢失
          console.log(`[Share] ${region} 创建失败 (${result.error})，尝试 PUT 更新...`);
          try {
            const updateResult = await suiBridgeRequest(region, 'PUT', `/api/clients/${encodeURIComponent(safeName)}`, suiBody);
            if (updateResult.success) {
              finalSuiBridges[region] = {
                clientName: safeName, inboundIds,
                trafficLimitGB: regionTraffic,
                expireAt: config.expireAt || undefined,
              };
              console.log(`[Share] ${region} s-ui 用户更新成功`);
            } else {
              console.error(`[Share] ${region} PUT 更新也失败:`, updateResult.error);
            }
          } catch (e2) {
            console.error(`[Share] ${region} PUT 更新异常:`, e2.message);
          }
        }
      } catch (e) {
        console.error(`[Share] ${region} bridge 不可用:`, e.message);
      }
    }

    // 2. 更新已有区域 — 同步入站权限/流量/到期
    for (const [region, oldInfo] of Object.entries(oldBridges)) {
      if (!oldInfo.clientName) continue;
      const newConfig = newBridges[region];

      // NOTE: 如果新数据中该区域不存在或入站为空 → 用户取消了全部勾选 → 删除 s-ui 用户
      const newInboundIds = newConfig?.inboundIds || [];
      if (!newConfig || newInboundIds.length === 0) {
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
      // NOTE: 优先使用区域独立的流量/到期，回退到全局设置
      const regionTrafficVal = newConfig?.trafficLimitGB;
      if (regionTrafficVal !== undefined) {
        bridgeBody.volume = regionTrafficVal > 0 ? Math.round(regionTrafficVal * 1073741824) : 0;
        finalSuiBridges[region] = { ...finalSuiBridges[region], trafficLimitGB: regionTrafficVal };
      } else if (trafficLimitGB !== undefined) {
        bridgeBody.volume = trafficLimitGB > 0 ? Math.round(trafficLimitGB * 1073741824) : 0;
      }
      if (newConfig?.expireAt) {
        bridgeBody.expiry = Math.floor(new Date(newConfig.expireAt).getTime() / 1000);
        finalSuiBridges[region] = { ...finalSuiBridges[region], expireAt: newConfig.expireAt };
      } else if (updates.expireAt !== undefined) {
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

  // NOTE: 缓存 key 包含 region，同区域所有用户共享一次 API 调用
  const cacheKey = `clients_${region}`;
  return getCachedOrFetch(cacheKey, () => new Promise((resolve) => {
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
        try { resolve(JSON.parse(data)); }
        catch { resolve({ clients: [] }); }
      });
    });
    req.on('error', () => resolve({ clients: [] }));
    req.on('timeout', () => { req.destroy(); resolve({ clients: [] }); });
    req.end();
  })).then(parsed => {
    const client = (parsed.clients || []).find(c => c.name === clientName);
    if (client && client.links) {
      return client.links.filter(l => l.uri).map(l => ({ uri: l.uri, remark: l.remark || '' }));
    }
    return [];
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

    // 2. 各区域 s-ui 用户节点（并行拉取 + 按 inboundIds 过滤）
    const suiBridges = normalizeSuiBridges(share);
    let suiNodes = [];

    // NOTE: 所有区域并行请求，避免串行等待导致 4-5 秒延迟
    const regionTasks = Object.entries(suiBridges).map(async ([region, info]) => {
      if (!info.clientName) return [];
      const nodes = [];

      let allowedTags = null;
      const allowedIds = new Set(info.inboundIds || []);
      const tagToId = {};

      // 并行获取 inbounds 和 links
      const [inboundData, linkItems] = await Promise.all([
        allowedIds.size > 0
          ? suiBridgeRequest(region, 'GET', '/api/inbounds').catch(() => null)
          : Promise.resolve(null),
        fetchSuiClientLinks(region, info.clientName),
      ]);

      if (inboundData && allowedIds.size > 0) {
        allowedTags = new Set();
        for (const ib of (inboundData.inbounds || [])) {
          if (allowedIds.has(ib.id)) {
            allowedTags.add(ib.tag);
            tagToId[ib.tag] = ib.id;
          }
        }
      }

      const suiOverrides = share.suiNodeOverrides || {};
      for (const item of linkItems) {
        try {
          const node = parseURI(item.uri);
          if (!node) continue;

          if (allowedTags && allowedTags.size > 0) {
            if (!allowedTags.has(item.remark)) continue;
          }

          const inboundId = tagToId[item.remark];
          if (inboundId) {
            const ov = suiOverrides[`${region}_${inboundId}`];
            if (ov) {
              if (ov.name) node.name = ov.name;
              if (ov.port) node.port = ov.port;
              if (ov.server) node.server = ov.server;
              if (ov.sni) {
                node.sni = ov.sni;
                if (node.params) node.params.sni = ov.sni;
              }
            }
          }

          node.id = `sui_${region}_${info.clientName}_${node.name || ''}`;
          nodes.push(node);
        } catch { /* 跳过解析失败的 */ }
      }
      return nodes;
    });

    const regionResults = await Promise.all(regionTasks);
    for (const nodes of regionResults) {
      suiNodes.push(...nodes);
    }

    // NOTE: 自建节点优先排列在最前面
    const allShareNodes = [...suiNodes, ...shareNodes];

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

    // NOTE: 汇总流量信息 — 合并订阅源 userinfo + S-UI bridge 流量
    let totalUpload = 0;
    let totalDownload = 0;
    let totalQuota = share.trafficLimit || 0;
    let latestExpire = share.expireAt ? Math.floor(new Date(share.expireAt).getTime() / 1000) : 0;

    // 1. 从 S-UI bridge 获取的流量（已在 GET /shares 时合并到 trafficUsed）
    totalDownload += (share.trafficUsed || 0);

    // 2. 从订阅源获取的流量信息
    const allSubs = nodeManager.getAllSubscriptions ? nodeManager.getAllSubscriptions() : [];
    const shareNodeIds = new Set(share.nodeIds || []);
    // NOTE: allNodes 已在上方声明（第 620 行），直接复用
    // 找出分享中包含的订阅源
    const usedSubIds = new Set();
    for (const nodeId of shareNodeIds) {
      const node = allNodes.find(n => n.id === nodeId);
      if (node?.group?.startsWith('sub-')) {
        usedSubIds.add(node.group.replace('sub-', ''));
      }
    }
    // 汇总订阅源的流量数据
    for (const sub of allSubs) {
      if (!usedSubIds.has(sub.id)) continue;
      const info = sub.userinfo;
      if (!info) continue;
      totalUpload += (info.upload || 0);
      totalDownload += (info.download || 0);
      // 取所有订阅源中最大的 total 作为总限额
      if (info.total && info.total > totalQuota) totalQuota = info.total;
      // 取最近的到期时间
      if (info.expire && info.expire > latestExpire) latestExpire = info.expire;
    }

    const userinfoHeader = [];
    userinfoHeader.push(`upload=${totalUpload}`);
    userinfoHeader.push(`download=${totalDownload}`);
    userinfoHeader.push(`total=${totalQuota}`);
    if (latestExpire > 0) {
      userinfoHeader.push(`expire=${latestExpire}`);
    }
    res.setHeader('Subscription-Userinfo', userinfoHeader.join('; '));
    // NOTE: 'base64:xxx' 前缀格式是 Shadowrocket/V2RayN 识别订阅名称的标准格式
    res.setHeader('Profile-Title', 'base64:' + Buffer.from(share.title).toString('base64'));
    // NOTE: Content-Disposition 使用 generate 返回的 filename，不再硬编码 .yaml
    const fname = result.filename || `${share.title}.txt`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fname)}"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.setHeader('Profile-Update-Interval', '24');

    res.type(result.contentType).send(result.content);
  } catch (error) {
    res.status(500).send(`# 服务器错误: ${error.message}`);
  }
};
