/**
 * clashTemplate.js - Generate Clash / Clash Meta (Mihomo) YAML configuration
 */

const yaml = require('js-yaml');
const { getClashRules, getProxyGroups, getRegionGroups } = require('./rules');

/**
 * Convert internal node to Clash proxy object
 */
function nodeToClashProxy(node) {
  const base = { name: node.name, server: node.server, port: node.port };

  switch (node.type) {
    case 'hysteria2':
      return {
        ...base,
        type: 'hysteria2',
        password: node.password,
        sni: node.sni || node.server,
        'skip-cert-verify': node.skipCertVerify || false,
        ...(node.alpn?.length ? { alpn: node.alpn } : {}),
        ...(node.obfs ? { obfs: node.obfs, 'obfs-password': node.obfsPassword || '' } : {}),
        ...(node.up ? { up: node.up } : {}),
        ...(node.down ? { down: node.down } : {}),
      };

    case 'vless':
      const vless = {
        ...base,
        type: 'vless',
        uuid: node.uuid,
        network: node.network || 'tcp',
        tls: node.tls !== false,
        udp: true,
        'skip-cert-verify': node.skipCertVerify || false,
      };
      if (node.sni) vless.servername = node.sni;
      if (node.flow) vless.flow = node.flow;
      if (node.fingerprint) vless['client-fingerprint'] = node.fingerprint;
      if (node.alpn?.length) vless.alpn = node.alpn;
      // Reality
      if (node.realityPublicKey) {
        vless['reality-opts'] = {
          'public-key': node.realityPublicKey,
          ...(node.realityShortId ? { 'short-id': node.realityShortId } : {}),
        };
      }
      // WebSocket
      if (node.network === 'ws') {
        vless['ws-opts'] = {
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      }
      // gRPC
      if (node.network === 'grpc') {
        vless['grpc-opts'] = { 'grpc-service-name': node.grpcServiceName || '' };
      }
      // H2
      if (node.network === 'h2') {
        vless['h2-opts'] = {
          host: node.wsHost ? [node.wsHost] : [node.server],
          path: node.httpPath || '/',
        };
      }
      return vless;

    case 'vmess':
      const vmess = {
        ...base,
        type: 'vmess',
        uuid: node.uuid,
        alterId: node.alterId || 0,
        cipher: node.cipher || 'auto',
        network: node.network || 'tcp',
        tls: node.tls || false,
        udp: true,
        'skip-cert-verify': node.skipCertVerify || false,
      };
      if (node.sni) vmess.servername = node.sni;
      if (node.fingerprint) vmess['client-fingerprint'] = node.fingerprint;
      if (node.network === 'ws') {
        vmess['ws-opts'] = {
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      }
      if (node.network === 'grpc') {
        vmess['grpc-opts'] = { 'grpc-service-name': node.grpcServiceName || '' };
      }
      if (node.network === 'h2') {
        vmess['h2-opts'] = {
          host: node.wsHost ? [node.wsHost] : [node.server],
          path: node.httpPath || '/',
        };
      }
      return vmess;

    case 'trojan':
      const trojan = {
        ...base,
        type: 'trojan',
        password: node.password,
        sni: node.sni || node.server,
        udp: true,
        'skip-cert-verify': node.skipCertVerify || false,
      };
      if (node.fingerprint) trojan['client-fingerprint'] = node.fingerprint;
      if (node.alpn?.length) trojan.alpn = node.alpn;
      if (node.network === 'ws') {
        trojan.network = 'ws';
        trojan['ws-opts'] = {
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      }
      if (node.network === 'grpc') {
        trojan.network = 'grpc';
        trojan['grpc-opts'] = { 'grpc-service-name': node.grpcServiceName || '' };
      }
      return trojan;

    case 'ss':
      return {
        ...base,
        type: 'ss',
        cipher: node.cipher || 'aes-256-gcm',
        password: node.password,
        udp: true,
      };

    case 'tuic':
      return {
        ...base,
        type: 'tuic',
        uuid: node.uuid,
        password: node.password,
        'congestion-controller': node.congestionControl || 'bbr',
        'udp-relay-mode': node.udpRelayMode || 'native',
        'reduce-rtt': node.reduceRtt !== false,
        'skip-cert-verify': node.skipCertVerify || false,
        sni: node.sni || node.server,
        ...(node.alpn?.length ? { alpn: node.alpn } : {}),
      };

    default:
      return null;
  }
}

/**
 * Generate complete Clash YAML configuration
 * @param {Array} nodes - Array of internal node objects
 * @returns {string} YAML string
 */
function generateClashConfig(nodes, options = {}) {
  // Convert nodes to Clash proxies
  const proxies = nodes.map(nodeToClashProxy).filter(Boolean);
  const nodeNames = proxies.map(p => p.name);

  // NOTE: 只用成功转换为 Clash proxy 的节点来构建地区分组
  // 不支持的协议（如 anytls）会被 nodeToClashProxy 过滤掉
  const validNodeSet = new Set(nodeNames);
  const regionNodes = {};
  for (const node of nodes) {
    if (!validNodeSet.has(node.name)) continue;
    const region = node.region || 'OTHER';
    if (!regionNodes[region]) regionNodes[region] = [];
    regionNodes[region].push(node.name);
  }

  // Build regional groups
  const regionGroupDefs = getRegionGroups();
  const activeRegionGroups = [];
  for (const [code, names] of Object.entries(regionNodes)) {
    if (names.length > 0 && regionGroupDefs[code]) {
      activeRegionGroups.push({
        name: regionGroupDefs[code].name,
        type: 'url-test',
        url: 'http://www.gstatic.com/generate_204',
        interval: 600,
        tolerance: 100,
        proxies: names,
      });
    }
  }
  const regionGroupNames = activeRegionGroups.map(g => g.name);

  // Build proxy groups
  const groupDefs = getProxyGroups();
  const proxyGroups = [];

  for (const gd of groupDefs) {
    const group = { name: gd.name, type: gd.type };

    if (gd.type === 'url-test' || gd.type === 'fallback') {
      group.url = 'http://www.gstatic.com/generate_204';
      group.interval = 300;
      group.tolerance = 50;
    }

    const groupProxies = [];

    // Add extra (static references to other groups)
    if (gd.extra) {
      groupProxies.push(...gd.extra);
    }

    // Add regional groups
    if (gd.useRegion) {
      groupProxies.push(...regionGroupNames);
    }

    // Add all node names
    if (gd.useAll) {
      groupProxies.push(...nodeNames);
    }

    group.proxies = groupProxies.filter(p => p !== undefined);
    proxyGroups.push(group);
  }

  // Add regional groups
  proxyGroups.push(...activeRegionGroups);

  // Build rules
  const rules = getClashRules();

  // Build config object
  // NOTE: 精简配置，高级功能（sniffer/tun）交由客户端自行管理
  const config = {
    'mixed-port': 7890,
    'allow-lan': true,
    mode: 'rule',
    'log-level': 'info',
    'external-controller': '127.0.0.1:9090',
    'unified-delay': true,
    'tcp-concurrent': true,
    'global-client-fingerprint': 'chrome',

    dns: {
      enable: true,
      ipv6: false,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      'fake-ip-filter': [
        '*.lan', '*.local', 'localhost',
        '+.msftconnecttest.com', '+.msftncsi.com',
      ],
      'default-nameserver': [
        '223.5.5.5',
        '119.29.29.29',
      ],
      nameserver: [
        '223.5.5.5',
        '119.29.29.29',
      ],
    },

    proxies,
    'proxy-groups': proxyGroups,
    rules,
  };

  // NOTE: OpenClash 兼容模式 — 极简版，不覆盖 DNS
  // OpenClash 自带高效的 DNS 引擎（dnsmasq + clash core 联动）
  // 自定义 DNS 会破坏其优化，导致延迟暴增和速度下降
  if (options.openclash) {
    // 只移除 OpenClash 自行管理的系统级配置
    delete config['mixed-port'];
    delete config['allow-lan'];
    delete config['bind-address'];
    delete config['external-controller'];
    delete config.tun;
    delete config.sniffer;
    delete config.dns;  // 完全交给 OpenClash 管理
  }

  // Use js-yaml to dump, with custom flow style for arrays
  return yaml.dump(config, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

module.exports = { generateClashConfig, nodeToClashProxy };
