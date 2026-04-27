/**
 * surgeTemplate.js - Generate Surge configuration
 */

const { getClashRules, getProxyGroups, getRegionGroups } = require('./rules');

/**
 * Convert internal node to Surge proxy line
 */
function nodeToSurgeLine(node) {
  switch (node.type) {
    case 'hysteria2':
      return `${node.name} = hysteria2, ${node.server}, ${node.port}, password=${node.password}, sni=${node.sni || node.server}, skip-cert-verify=${node.skipCertVerify}`;

    case 'vless':
      // Surge doesn't natively support VLESS well, use external proxy
      return null;

    case 'vmess': {
      let line = `${node.name} = vmess, ${node.server}, ${node.port}, username=${node.uuid}`;
      if (node.tls) line += `, tls=true, sni=${node.sni || node.server}`;
      if (node.network === 'ws') {
        line += `, ws=true, ws-path=${node.wsPath || '/'}`;
        if (node.wsHost) line += `, ws-headers=Host:${node.wsHost}`;
      }
      line += `, skip-cert-verify=${node.skipCertVerify}`;
      return line;
    }

    case 'trojan': {
      let line = `${node.name} = trojan, ${node.server}, ${node.port}, password=${node.password}, sni=${node.sni || node.server}`;
      if (node.network === 'ws') {
        line += `, ws=true, ws-path=${node.wsPath || '/'}`;
        if (node.wsHost) line += `, ws-headers=Host:${node.wsHost}`;
      }
      line += `, skip-cert-verify=${node.skipCertVerify}`;
      return line;
    }

    case 'ss': {
      return `${node.name} = ss, ${node.server}, ${node.port}, encrypt-method=${node.cipher}, password=${node.password}`;
    }

    case 'tuic':
      return `${node.name} = tuic, ${node.server}, ${node.port}, token=${node.uuid}, sni=${node.sni || node.server}, skip-cert-verify=${node.skipCertVerify}`;

    default:
      return null;
  }
}

/**
 * Convert Clash rule format to Surge rule format
 */
function clashRuleToSurge(rule) {
  // Surge uses the same format as Clash for most rules
  // Just some minor differences
  return rule
    .replace('IP-CIDR6', 'IP-CIDR6')
    .replace(',no-resolve', ', no-resolve');
}

/**
 * Generate Surge configuration
 */
function generateSurgeConfig(nodes) {
  const lines = [];

  // General
  lines.push('[General]');
  lines.push('loglevel = notify');
  lines.push('dns-server = 223.5.5.5, 114.114.114.114, system');
  lines.push('doh-server = https://dns.alidns.com/dns-query');
  lines.push('skip-proxy = 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, 17.0.0.0/8, localhost, *.local, *.crashlytics.com');
  lines.push('wifi-access-http-port = 6152');
  lines.push('wifi-access-socks5-port = 6153');
  lines.push('allow-wifi-access = true');
  lines.push('internet-test-url = http://www.gstatic.com/generate_204');
  lines.push('proxy-test-url = http://www.gstatic.com/generate_204');
  lines.push('test-timeout = 5');
  lines.push('ipv6 = false');
  lines.push('');

  // Proxy
  lines.push('[Proxy]');
  lines.push('DIRECT = direct');
  lines.push('REJECT = reject');
  for (const node of nodes) {
    const line = nodeToSurgeLine(node);
    if (line) lines.push(line);
  }
  lines.push('');

  // Proxy Group
  lines.push('[Proxy Group]');
  const nodeNames = nodes.map(n => n.name).filter(n => nodeToSurgeLine(nodes.find(nd => nd.name === n)));
  const validNames = nodeNames.filter(n => {
    const node = nodes.find(nd => nd.name === n);
    return node && nodeToSurgeLine(node) !== null;
  });

  // Group by region
  const regionNodes = {};
  for (const node of nodes) {
    if (nodeToSurgeLine(node) === null) continue;
    const region = node.region || 'OTHER';
    if (!regionNodes[region]) regionNodes[region] = [];
    regionNodes[region].push(node.name);
  }

  const regionGroupDefs = getRegionGroups();
  const regionGroupNames = [];
  for (const [code, names] of Object.entries(regionNodes)) {
    if (names.length > 0 && regionGroupDefs[code]) {
      regionGroupNames.push(regionGroupDefs[code].name);
    }
  }

  lines.push(`🚀 节点选择 = select, ⚡ 自动选优, ${regionGroupNames.join(', ')}, ${validNames.join(', ')}, DIRECT`);
  lines.push(`⚡ 自动选优 = url-test, ${validNames.join(', ')}, url=http://www.gstatic.com/generate_204, interval=300, tolerance=50`);
  lines.push(`🤖 AI 服务 = select, 🚀 节点选择, ⚡ 自动选优, ${regionGroupNames.join(', ')}, ${validNames.join(', ')}`);
  lines.push(`🎬 流媒体 = select, 🚀 节点选择, ⚡ 自动选优, ${regionGroupNames.join(', ')}, ${validNames.join(', ')}`);
  lines.push(`📱 社交媒体 = select, 🚀 节点选择, ⚡ 自动选优, ${validNames.join(', ')}, DIRECT`);
  lines.push(`🌐 谷歌服务 = select, 🚀 节点选择, ⚡ 自动选优, ${validNames.join(', ')}, DIRECT`);
  lines.push(`🍎 苹果服务 = select, DIRECT, 🚀 节点选择`);
  lines.push(`🪟 微软服务 = select, DIRECT, 🚀 节点选择`);
  lines.push(`🇨🇳 国内直连 = select, DIRECT, 🚀 节点选择`);
  lines.push(`🚫 广告拦截 = select, REJECT, DIRECT`);
  lines.push(`🐟 漏网之鱼 = select, 🚀 节点选择, ⚡ 自动选优, DIRECT`);

  // Regional groups
  for (const [code, names] of Object.entries(regionNodes)) {
    if (names.length > 0 && regionGroupDefs[code]) {
      lines.push(`${regionGroupDefs[code].name} = url-test, ${names.join(', ')}, url=http://www.gstatic.com/generate_204, interval=300, tolerance=50`);
    }
  }
  lines.push('');

  // Rules
  lines.push('[Rule]');
  const rules = getClashRules();
  for (const rule of rules) {
    lines.push(clashRuleToSurge(rule));
  }
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateSurgeConfig };
