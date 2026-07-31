'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isShadowrocketConf,
  parseShadowrocketConf,
  splitCsv,
} = require('../src/services/shadowrocket-conf-parser');
const { nodeToURI, parseURI } = require('../src/services/nodeParser');
const { generate } = require('../src/services/configGenerator');

const REAL_CONF_PATH = path.resolve(__dirname, '../../WestData.conf/WestData.conf');

const BASE_CONF = `[General]
update-url = https://example.com/profile.conf

[Proxy]
Traffic: 1.5 GB / 200 GB = trojan, traffic.example.com, 443, password=hidden
Expire: 2027-07-31 = trojan, expire.example.com, 443, password=hidden
Trojan A = trojan, tr.example.com, 443, password=secret, sni=cdn.example.com, skip-cert-verify=true
SS A = ss, ss.example.com, 8388, encrypt-method=aes-256-gcm, password=secret
VMess A = vmess, vm.example.com, 443, uuid=00000000-0000-0000-0000-000000000001, tls=true, ws=true, ws-path=/ws, ws-host=cdn.example.com
VLESS A = vless, vl.example.com, 443, uuid=00000000-0000-0000-0000-000000000002, security=reality, public-key=public, short-id=01, flow=xtls-rprx-vision
HY2 A = hysteria2, hy.example.com, 443, password=secret, obfs=salamander, obfs-password=obfs-secret
TUIC A = tuic, tuic.example.com, 443, uuid=00000000-0000-0000-0000-000000000003, password=secret, alpn=h3
Unsupported = http, http.example.com, 80
Broken = trojan, broken.example.com, 70000, password=secret

[Rule]
FINAL,DIRECT
`;

test('能识别 Shadowrocket CONF 且只解析 Proxy 段', () => {
  assert.equal(isShadowrocketConf(BASE_CONF), true);
  assert.equal(isShadowrocketConf('trojan://example'), false);

  const result = parseShadowrocketConf(BASE_CONF);
  assert.equal(result.nodes.length, 6);
  assert.deepEqual(result.nodes.map(node => node.type), [
    'trojan', 'ss', 'vmess', 'vless', 'hysteria2', 'tuic',
  ]);
  assert.equal(result.stats.proxyLines, 10);
  assert.equal(result.stats.ignoredMetadata, 2);
  assert.equal(result.stats.invalidLines, 1);
  assert.deepEqual(result.stats.unsupportedProtocols, { http: 1 });
});

test('能映射常用协议参数且不暴露到统计信息', () => {
  const result = parseShadowrocketConf(BASE_CONF);
  const [trojan, ss, vmess, vless, hy2, tuic] = result.nodes;

  assert.equal(trojan.sni, 'cdn.example.com');
  assert.equal(trojan.skipCertVerify, true);
  assert.equal(ss.cipher, 'aes-256-gcm');
  assert.equal(vmess.network, 'ws');
  assert.equal(vmess.wsPath, '/ws');
  assert.equal(vless.realityPublicKey, 'public');
  assert.equal(vless.realityShortId, '01');
  assert.equal(hy2.obfs, 'salamander');
  assert.deepEqual(tuic.alpn, ['h3']);
  assert.equal(JSON.stringify(result.stats).includes('secret'), false);
});

test('Trojan 导出保留 CONF 的跳过证书校验设置', () => {
  const [trojan] = parseShadowrocketConf(BASE_CONF).nodes;
  const uri = nodeToURI(trojan);
  const params = new URL(uri).searchParams;
  const roundTripNode = parseURI(uri);

  assert.equal(params.get('insecure'), '1');
  assert.equal(roundTripNode.skipCertVerify, true);
  assert.equal(roundTripNode.sni, trojan.sni);
});

test('自建节点与 WestData 混合导出时仍保留 TLS 允许不安全', () => {
  const [trojan] = parseShadowrocketConf(BASE_CONF).nodes;
  const selfHostedNode = {
    type: 'hysteria2',
    name: '自建节点',
    server: 'self.example.com',
    port: 443,
    password: 'self-secret',
    sni: 'self.example.com',
  };
  const result = generate('shadowrocket', { nodes: [selfHostedNode, trojan], title: '混合测试' });
  const uris = Buffer.from(result.content, 'base64').toString('utf8').split('\n');

  assert.equal(uris.length, 2);
  assert.equal(uris[0].startsWith('hysteria2://'), true);
  assert.equal(new URL(uris[1]).searchParams.get('insecure'), '1');
});

test('能解析 CONF 中的流量与到期元数据', () => {
  const result = parseShadowrocketConf(BASE_CONF);
  assert.equal(result.userinfo.download, Math.round(1.5 * 1024 ** 3));
  assert.equal(result.userinfo.total, 200 * 1024 ** 3);
  assert.equal(result.userinfo.expire, Math.floor(Date.parse('2027-07-31T23:59:59Z') / 1000));
  assert.equal(result.metadata.expireDate, '2027-07-31');
  assert.equal(result.metadata.updateUrl, 'https://example.com/profile.conf');
});

test('CSV 拆分保留引号内逗号和密码中的等号', () => {
  assert.deepEqual(
    splitCsv('trojan, example.com, 443, password="abc,def==", sni=cdn.example.com'),
    ['trojan', 'example.com', '443', 'password=abc,def==', 'sni=cdn.example.com'],
  );
});

test('空配置和无有效节点配置返回空结果', () => {
  assert.equal(parseShadowrocketConf('').nodes.length, 0);
  assert.equal(parseShadowrocketConf('[Proxy]\nBad = http, example.com, 80').nodes.length, 0);
});

test('真实 WestData.conf 解析为 61 个 Trojan 节点', { skip: !fs.existsSync(REAL_CONF_PATH) }, () => {
  const text = fs.readFileSync(REAL_CONF_PATH, 'utf8');
  const result = parseShadowrocketConf(text);

  assert.equal(result.stats.proxyLines, 63);
  assert.equal(result.stats.ignoredMetadata, 2);
  assert.equal(result.stats.invalidLines, 0);
  assert.equal(result.nodes.length, 61);
  assert.equal(result.nodes.every(node => node.type === 'trojan'), true);
  assert.equal(result.nodes.every(node => Boolean(node.password) && Boolean(node.sni)), true);
  assert.equal(result.nodes.every(node => node.skipCertVerify === true), true);
  assert.equal(result.nodes.every(node => new URL(nodeToURI(node)).searchParams.get('insecure') === '1'), true);
  assert.equal(result.nodes.some(node => node.region === 'TW'), true);
  assert.equal(result.metadata.expireDate, '2027-07-31');
  assert.equal(result.userinfo.total, 200 * 1024 ** 3);
});
