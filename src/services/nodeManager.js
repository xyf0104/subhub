/**
 * nodeManager.js - Node CRUD operations with JSON file persistence
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NODES_FILE = path.join(DATA_DIR, 'nodes.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');

// Ensure data directory and files exist
function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(NODES_FILE)) {
    fs.writeFileSync(NODES_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(SUBS_FILE)) {
    fs.writeFileSync(SUBS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(SHARES_FILE)) {
    fs.writeFileSync(SHARES_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      token: randomUUID().replace(/-/g, ''),
      password: process.env.ADMIN_PASSWORD || 'admin',
      createdAt: new Date().toISOString()
    }, null, 2), 'utf-8');
  }
}

// Initialize on load
ensureDataFiles();

// ---- Node Operations ----

function getAllNodes() {
  const data = fs.readFileSync(NODES_FILE, 'utf-8');
  return JSON.parse(data);
}

function getEnabledNodes() {
  return getAllNodes().filter(n => n.enabled !== false);
}

function getNodeById(id) {
  return getAllNodes().find(n => n.id === id);
}

function addNode(node) {
  const nodes = getAllNodes();
  if (!node.id) node.id = randomUUID();
  if (!node.createdAt) node.createdAt = new Date().toISOString();
  nodes.push(node);
  saveNodes(nodes);
  return node;
}

function addNodes(newNodes) {
  const nodes = getAllNodes();
  for (const node of newNodes) {
    if (!node.id) node.id = randomUUID();
    if (!node.createdAt) node.createdAt = new Date().toISOString();
    nodes.push(node);
  }
  saveNodes(nodes);
  return newNodes;
}

function updateNode(id, updates) {
  const nodes = getAllNodes();
  const idx = nodes.findIndex(n => n.id === id);
  if (idx === -1) return null;
  nodes[idx] = { ...nodes[idx], ...updates, id }; // preserve id
  saveNodes(nodes);
  return nodes[idx];
}

function deleteNode(id) {
  const nodes = getAllNodes();
  const filtered = nodes.filter(n => n.id !== id);
  if (filtered.length === nodes.length) return false;
  saveNodes(filtered);
  return true;
}

function deleteNodesByGroup(group) {
  const nodes = getAllNodes();
  const filtered = nodes.filter(n => n.group !== group);
  saveNodes(filtered);
  return nodes.length - filtered.length;
}

function saveNodes(nodes) {
  const temporaryFile = `${NODES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(nodes, null, 2), 'utf-8');
  // NOTE: 同目录 rename 由文件系统原子完成，进程中断时旧节点文件仍保持完整。
  fs.renameSync(temporaryFile, NODES_FILE);
}

/**
 * 生成用于订阅刷新匹配的完整节点指纹。
 * NOTE: 排除持久化元数据，只比较会影响实际连接或展示的字段。
 * @param {Object} node 节点配置
 * @returns {string} 稳定指纹
 */
function getNodeFingerprint(node) {
  const ignoredKeys = new Set(['id', 'createdAt', 'enabled', 'group', 'lastTest']);
  const normalized = {};
  for (const key of Object.keys(node).sort()) {
    if (ignoredKeys.has(key) || node[key] === undefined) continue;
    normalized[key] = node[key];
  }
  return JSON.stringify(normalized);
}

/**
 * 生成节点逻辑身份键，允许机场轮换连接凭据时继续沿用节点 ID。
 * @param {Object} node 节点配置
 * @returns {string} 逻辑身份键
 */
function getNodeIdentityKey(node) {
  return [
    String(node.type || '').toLowerCase(),
    String(node.server || '').trim().toLowerCase(),
    Number(node.port) || 0,
    String(node.name || '').trim(),
  ].join('\u0000');
}

/**
 * 生成不包含名称的端点键，只用于新旧两侧均唯一时的名称变更匹配。
 * @param {Object} node 节点配置
 * @returns {string} 端点键
 */
function getNodeEndpointKey(node) {
  return [
    String(node.type || '').toLowerCase(),
    String(node.server || '').trim().toLowerCase(),
    Number(node.port) || 0,
  ].join('\u0000');
}

/**
 * 原子替换指定订阅的全部节点。
 * NOTE: 先在内存中完成校验与合并，最后只写入一次；空结果不会清空旧节点。
 * @param {string} subscriptionId 订阅 ID
 * @param {Object[]} newNodes 已完整解析的新节点
 * @returns {Object[]} 实际保存的订阅节点
 */
function replaceSubscriptionNodes(subscriptionId, newNodes) {
  if (!subscriptionId || !Array.isArray(newNodes) || newNodes.length === 0) {
    throw new Error('订阅刷新未解析到有效节点，已保留原节点');
  }

  const groupName = `sub-${subscriptionId}`;
  const allNodes = getAllNodes();
  const oldNodes = allNodes.filter(node => node.group === groupName);
  const otherNodes = allNodes.filter(node => node.group !== groupName);
  const candidates = newNodes.map(node => ({ ...node, group: groupName }));
  const availableOldNodes = [...oldNodes];
  const newEndpointCounts = new Map();
  const oldEndpointCounts = new Map();

  for (const node of candidates) {
    const key = getNodeEndpointKey(node);
    newEndpointCounts.set(key, (newEndpointCounts.get(key) || 0) + 1);
  }
  for (const node of oldNodes) {
    const key = getNodeEndpointKey(node);
    oldEndpointCounts.set(key, (oldEndpointCounts.get(key) || 0) + 1);
  }

  /**
   * 从尚未匹配的旧节点中消费一个节点，避免重复节点共享 ID。
   * @param {(node: Object) => boolean} predicate 匹配条件
   * @returns {Object|null} 匹配节点
   */
  function takeOldNode(predicate) {
    const index = availableOldNodes.findIndex(predicate);
    if (index === -1) return null;
    return availableOldNodes.splice(index, 1)[0];
  }

  const now = new Date().toISOString();
  const replacementNodes = candidates.map(candidate => {
    const fingerprint = getNodeFingerprint(candidate);
    const identityKey = getNodeIdentityKey(candidate);
    const endpointKey = getNodeEndpointKey(candidate);
    let existing = takeOldNode(node => getNodeFingerprint(node) === fingerprint);

    // NOTE: 凭据轮换时，同名同端点仍视为同一逻辑节点，分享链接无需重建。
    if (!existing) {
      existing = takeOldNode(node => getNodeIdentityKey(node) === identityKey);
    }

    // NOTE: 只有端点在新旧列表中都唯一时才允许跨名称匹配，避免误配同端口重复节点。
    if (!existing
      && newEndpointCounts.get(endpointKey) === 1
      && oldEndpointCounts.get(endpointKey) === 1) {
      existing = takeOldNode(node => getNodeEndpointKey(node) === endpointKey);
    }

    return {
      ...candidate,
      id: existing?.id || randomUUID(),
      createdAt: existing?.createdAt || candidate.createdAt || now,
      enabled: existing?.enabled ?? candidate.enabled ?? true,
    };
  });

  saveNodes([...otherNodes, ...replacementNodes]);
  return replacementNodes;
}

// ---- Subscription Source Operations ----

function getAllSubscriptions() {
  const data = fs.readFileSync(SUBS_FILE, 'utf-8');
  return JSON.parse(data);
}

function addSubscription(sub) {
  const subs = getAllSubscriptions();
  if (!sub.id) sub.id = randomUUID();
  sub.createdAt = new Date().toISOString();
  sub.lastUpdate = null;
  sub.nodeCount = 0;
  subs.push(sub);
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf-8');
  return sub;
}

function updateSubscription(id, updates) {
  const subs = getAllSubscriptions();
  const idx = subs.findIndex(s => s.id === id);
  if (idx === -1) return null;
  subs[idx] = { ...subs[idx], ...updates, id };
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2), 'utf-8');
  return subs[idx];
}

function deleteSubscription(id) {
  const subs = getAllSubscriptions();
  const filtered = subs.filter(s => s.id !== id);
  fs.writeFileSync(SUBS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
  // Also delete nodes from this subscription
  deleteNodesByGroup(`sub-${id}`);
  return true;
}

// ---- Config Operations ----

function getConfig() {
  const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(data);
}

function updateConfig(updates) {
  const config = getConfig();
  const updated = { ...config, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

function getToken() {
  return getConfig().token;
}

function regenerateToken() {
  const newToken = randomUUID().replace(/-/g, '');
  updateConfig({ token: newToken });
  return newToken;
}

function getPassword() {
  return getConfig().password;
}

function setPassword(newPassword) {
  updateConfig({ password: newPassword });
}

// ---- 分享管理（无创建数量上限，每个朋友一个独立链接） ----

function getAllShares() {
  const data = fs.readFileSync(SHARES_FILE, 'utf-8');
  return JSON.parse(data);
}

function getShareByToken(token) {
  return getAllShares().find(s => s.token === token);
}

function getShareById(id) {
  return getAllShares().find(s => s.id === id);
}

/**
 * 创建分享链接
 * @param {Object} shareData - { title, nodeIds, trafficLimit, expireDays, suiClientName }
 */
function createShare(shareData) {
  const shares = getAllShares();
  const share = {
    id: randomUUID(),
    token: randomUUID().replace(/-/g, '').substring(0, 16),
    title: shareData.title || '订阅分享',
    nodeIds: shareData.nodeIds || [],
    trafficLimit: shareData.trafficLimit || 0,  // 字节，0=不限
    trafficUsed: 0,
    expireAt: shareData.expireDays
      ? new Date(Date.now() + shareData.expireDays * 86400000).toISOString()
      : (shareData.expireAt || null),  // null=永不过期
    createdAt: new Date().toISOString(),
    enabled: true,
    // s-ui 关联用户名（删除时自动断网）
    suiClientName: shareData.suiClientName || null,
    // s-ui 入站 ID 列表（控制订阅输出哪些协议）
    suiInboundIds: shareData.suiInboundIds || undefined,
    // NOTE: 多区域 s-ui 桥接数据 { jp: { clientName, inboundIds, ... }, us: { ... } }
    suiBridges: shareData.suiBridges || undefined,
    // NOTE: 自建节点覆盖 { "region_inboundId": { name, port, server, sni } }
    suiNodeOverrides: shareData.suiNodeOverrides || undefined,
  };
  shares.push(share);
  saveShares(shares);
  return share;
}

function updateShare(id, updates) {
  const shares = getAllShares();
  const idx = shares.findIndex(s => s.id === id);
  if (idx === -1) return null;
  // 不允许覆盖 id 和 token
  delete updates.id;
  delete updates.token;
  shares[idx] = { ...shares[idx], ...updates };
  saveShares(shares);
  return shares[idx];
}

function deleteShare(id) {
  const shares = getAllShares();
  const filtered = shares.filter(s => s.id !== id);
  if (filtered.length === shares.length) return false;
  saveShares(filtered);
  return true;
}

/**
 * 检查分享是否有效（未过期、未超流量、已启用）
 */
function isShareValid(share) {
  if (!share || !share.enabled) return false;
  if (share.expireAt && new Date(share.expireAt) < new Date()) return false;
  if (share.trafficLimit > 0 && share.trafficUsed >= share.trafficLimit) return false;
  return true;
}

function saveShares(shares) {
  fs.writeFileSync(SHARES_FILE, JSON.stringify(shares, null, 2), 'utf-8');
}

module.exports = {
  getAllNodes, getEnabledNodes, getNodeById,
  addNode, addNodes, updateNode, deleteNode, deleteNodesByGroup,
  replaceSubscriptionNodes,
  getAllSubscriptions, addSubscription, updateSubscription, deleteSubscription,
  getConfig, updateConfig, getToken, regenerateToken,
  getPassword, setPassword, ensureDataFiles,
  getAllShares, getShareByToken, getShareById,
  createShare, updateShare, deleteShare, isShareValid,
};
