'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'subhub-node-manager-'));
const SERVICE_DIR = path.join(TEST_ROOT, 'src', 'services');
const DATA_DIR = path.join(TEST_ROOT, 'src', 'data');
fs.mkdirSync(SERVICE_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.copyFileSync(
  path.resolve(__dirname, '../src/services/nodeManager.js'),
  path.join(SERVICE_DIR, 'nodeManager.js'),
);

const nodeManager = require(path.join(SERVICE_DIR, 'nodeManager.js'));

function makeNode(name, server = 'example.com') {
  return {
    name,
    type: 'trojan',
    server,
    port: 443,
    password: 'secret',
    sni: 'cdn.example.com',
    enabled: true,
  };
}

test.after(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

test('订阅节点替换不累加并保留未变化节点 ID', () => {
  const first = nodeManager.replaceSubscriptionNodes('test-sub', [
    makeNode('Node A'),
    makeNode('Node B', 'b.example.com'),
  ]);
  const firstIds = first.map(node => node.id);

  const second = nodeManager.replaceSubscriptionNodes('test-sub', [
    makeNode('Node A'),
    makeNode('Node B', 'b.example.com'),
  ]);
  assert.equal(nodeManager.getAllNodes().length, 2);
  assert.deepEqual(second.map(node => node.id), firstIds);
});

test('凭据轮换时保留 ID，连接端点变化时生成新 ID', () => {
  const previous = nodeManager.getAllNodes();
  const rotatedCredential = makeNode('Node A');
  rotatedCredential.password = 'rotated-secret';
  const rotated = nodeManager.replaceSubscriptionNodes('test-sub', [
    rotatedCredential,
    makeNode('Node B', 'b.example.com'),
  ]);

  assert.equal(rotated[0].id, previous[0].id);
  assert.equal(rotated[1].id, previous[1].id);

  const endpointChanged = nodeManager.replaceSubscriptionNodes('test-sub', [
    rotatedCredential,
    makeNode('Node B', 'new-b.example.com'),
  ]);
  assert.equal(endpointChanged[0].id, previous[0].id);
  assert.notEqual(endpointChanged[1].id, previous[1].id);
});

test('空解析结果不会清空已有节点', () => {
  const before = nodeManager.getAllNodes();
  assert.throws(
    () => nodeManager.replaceSubscriptionNodes('test-sub', []),
    /已保留原节点/,
  );
  assert.deepEqual(nodeManager.getAllNodes(), before);
});
