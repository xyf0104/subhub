/**
 * nodeManager.js - Node CRUD operations with JSON file persistence
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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
      token: uuidv4().replace(/-/g, ''),
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
  if (!node.id) node.id = uuidv4();
  if (!node.createdAt) node.createdAt = new Date().toISOString();
  nodes.push(node);
  saveNodes(nodes);
  return node;
}

function addNodes(newNodes) {
  const nodes = getAllNodes();
  for (const node of newNodes) {
    if (!node.id) node.id = uuidv4();
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
  fs.writeFileSync(NODES_FILE, JSON.stringify(nodes, null, 2), 'utf-8');
}

// ---- Subscription Source Operations ----

function getAllSubscriptions() {
  const data = fs.readFileSync(SUBS_FILE, 'utf-8');
  return JSON.parse(data);
}

function addSubscription(sub) {
  const subs = getAllSubscriptions();
  if (!sub.id) sub.id = uuidv4();
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
  const newToken = uuidv4().replace(/-/g, '');
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
    id: uuidv4(),
    token: uuidv4().replace(/-/g, '').substring(0, 16),
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
  getAllSubscriptions, addSubscription, updateSubscription, deleteSubscription,
  getConfig, updateConfig, getToken, regenerateToken,
  getPassword, setPassword, ensureDataFiles,
  getAllShares, getShareByToken, getShareById,
  createShare, updateShare, deleteShare, isShareValid,
};
