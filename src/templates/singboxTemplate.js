/**
 * singboxTemplate.js - Generate Sing-box JSON configuration
 */

const { getSingboxRuleCategories, getRegionGroups } = require('./rules');

/**
 * Convert internal node to Sing-box outbound
 */
function nodeToSingboxOutbound(node) {
  const base = { tag: node.name, server: node.server, server_port: node.port };

  switch (node.type) {
    case 'hysteria2':
      return {
        type: 'hysteria2',
        ...base,
        password: node.password,
        tls: {
          enabled: true,
          server_name: node.sni || node.server,
          insecure: node.skipCertVerify || false,
          ...(node.alpn?.length ? { alpn: node.alpn } : {}),
        },
        ...(node.obfs ? {
          obfs: { type: node.obfs, password: node.obfsPassword || '' }
        } : {}),
        ...(node.up ? { up_mbps: parseInt(node.up) || 100 } : {}),
        ...(node.down ? { down_mbps: parseInt(node.down) || 100 } : {}),
      };

    case 'vless': {
      const out = {
        type: 'vless',
        ...base,
        uuid: node.uuid,
        ...(node.flow ? { flow: node.flow } : {}),
      };
      // TLS
      if (node.tls !== false) {
        out.tls = {
          enabled: true,
          server_name: node.sni || node.server,
          insecure: node.skipCertVerify || false,
          ...(node.alpn?.length ? { alpn: node.alpn } : {}),
        };
        if (node.fingerprint) {
          out.tls.utls = { enabled: true, fingerprint: node.fingerprint };
        }
        if (node.realityPublicKey) {
          out.tls.reality = {
            enabled: true,
            public_key: node.realityPublicKey,
            ...(node.realityShortId ? { short_id: node.realityShortId } : {}),
          };
        }
      }
      // Transport
      if (node.network === 'ws') {
        out.transport = {
          type: 'ws',
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      } else if (node.network === 'grpc') {
        out.transport = {
          type: 'grpc',
          service_name: node.grpcServiceName || '',
        };
      } else if (node.network === 'h2') {
        out.transport = {
          type: 'http',
          host: node.wsHost ? [node.wsHost] : [node.server],
          path: node.httpPath || '/',
        };
      }
      return out;
    }

    case 'vmess': {
      const out = {
        type: 'vmess',
        ...base,
        uuid: node.uuid,
        alter_id: node.alterId || 0,
        security: node.cipher || 'auto',
      };
      if (node.tls) {
        out.tls = {
          enabled: true,
          server_name: node.sni || node.server,
          insecure: node.skipCertVerify || false,
        };
      }
      if (node.network === 'ws') {
        out.transport = {
          type: 'ws',
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      } else if (node.network === 'grpc') {
        out.transport = { type: 'grpc', service_name: node.grpcServiceName || '' };
      } else if (node.network === 'h2') {
        out.transport = {
          type: 'http',
          host: node.wsHost ? [node.wsHost] : [node.server],
          path: node.httpPath || '/',
        };
      }
      return out;
    }

    case 'trojan': {
      const out = {
        type: 'trojan',
        ...base,
        password: node.password,
        tls: {
          enabled: true,
          server_name: node.sni || node.server,
          insecure: node.skipCertVerify || false,
          ...(node.alpn?.length ? { alpn: node.alpn } : {}),
        },
      };
      if (node.network === 'ws') {
        out.transport = {
          type: 'ws',
          path: node.wsPath || '/',
          ...(node.wsHost ? { headers: { Host: node.wsHost } } : {}),
        };
      } else if (node.network === 'grpc') {
        out.transport = { type: 'grpc', service_name: node.grpcServiceName || '' };
      }
      return out;
    }

    case 'ss':
      return {
        type: 'shadowsocks',
        ...base,
        method: node.cipher || 'aes-256-gcm',
        password: node.password,
      };

    case 'tuic':
      return {
        type: 'tuic',
        ...base,
        uuid: node.uuid,
        password: node.password,
        congestion_control: node.congestionControl || 'bbr',
        udp_relay_mode: node.udpRelayMode || 'native',
        zero_rtt_handshake: node.reduceRtt !== false,
        tls: {
          enabled: true,
          server_name: node.sni || node.server,
          insecure: node.skipCertVerify || false,
          ...(node.alpn?.length ? { alpn: node.alpn } : {}),
        },
      };

    default:
      return null;
  }
}

/**
 * Parse Clash-style rule string into sing-box rule object components
 */
function parseClashRule(ruleStr) {
  const parts = ruleStr.split(',');
  if (parts.length < 2) return null;

  const type = parts[0];
  const value = parts[1];

  switch (type) {
    case 'DOMAIN':
      return { domain: [value] };
    case 'DOMAIN-SUFFIX':
      return { domain_suffix: [value] };
    case 'DOMAIN-KEYWORD':
      return { domain_keyword: [value] };
    case 'IP-CIDR':
      return { ip_cidr: [value] };
    case 'IP-CIDR6':
      return { ip_cidr: [value] };
    case 'GEOIP':
      return { geoip: [value] };
    default:
      return null;
  }
}

/**
 * Aggregate rules from category into sing-box rule format
 */
function aggregateRules(clashRules) {
  const domains = [];
  const domainSuffixes = [];
  const domainKeywords = [];
  const ipCidrs = [];
  const geoips = [];

  for (const r of clashRules) {
    const parts = r.split(',');
    const type = parts[0];
    const value = parts[1];
    switch (type) {
      case 'DOMAIN': domains.push(value); break;
      case 'DOMAIN-SUFFIX': domainSuffixes.push(value); break;
      case 'DOMAIN-KEYWORD': domainKeywords.push(value); break;
      case 'IP-CIDR': case 'IP-CIDR6': ipCidrs.push(value); break;
      case 'GEOIP': geoips.push(value); break;
    }
  }

  const rule = {};
  if (domains.length) rule.domain = domains;
  if (domainSuffixes.length) rule.domain_suffix = domainSuffixes;
  if (domainKeywords.length) rule.domain_keyword = domainKeywords;
  if (ipCidrs.length) rule.ip_cidr = ipCidrs;
  if (geoips.length) rule.geoip = geoips;

  return rule;
}

/**
 * Generate Sing-box JSON config
 */
function generateSingboxConfig(nodes) {
  const outbounds = [];
  const nodeNames = [];

  // Convert nodes
  for (const node of nodes) {
    const ob = nodeToSingboxOutbound(node);
    if (ob) {
      outbounds.push(ob);
      nodeNames.push(node.name);
    }
  }

  // Group nodes by region
  const regionNodes = {};
  for (const node of nodes) {
    const region = node.region || 'OTHER';
    if (!regionNodes[region]) regionNodes[region] = [];
    regionNodes[region].push(node.name);
  }

  const regionGroupDefs = getRegionGroups();
  const regionGroupNames = [];

  // Create region selector outbounds
  for (const [code, names] of Object.entries(regionNodes)) {
    if (names.length > 0 && regionGroupDefs[code]) {
      const gd = regionGroupDefs[code];
      regionGroupNames.push(gd.name);
      outbounds.push({
        type: 'urltest',
        tag: gd.name,
        outbounds: names,
        url: 'http://www.gstatic.com/generate_204',
        interval: '5m',
        tolerance: 50,
      });
    }
  }

  // Create selector outbounds
  const selectorOutbounds = [
    {
      type: 'selector',
      tag: '🚀 节点选择',
      outbounds: ['⚡ 自动选优', ...regionGroupNames, ...nodeNames, 'direct'],
      default: '⚡ 自动选优',
    },
    {
      type: 'urltest',
      tag: '⚡ 自动选优',
      outbounds: nodeNames,
      url: 'http://www.gstatic.com/generate_204',
      interval: '5m',
      tolerance: 50,
    },
    {
      type: 'selector', tag: '🤖 AI 服务',
      outbounds: ['🚀 节点选择', '⚡ 自动选优', ...regionGroupNames, ...nodeNames],
    },
    {
      type: 'selector', tag: '🎬 流媒体',
      outbounds: ['🚀 节点选择', '⚡ 自动选优', ...regionGroupNames, ...nodeNames],
    },
    {
      type: 'selector', tag: '📱 社交媒体',
      outbounds: ['🚀 节点选择', '⚡ 自动选优', ...nodeNames, 'direct'],
    },
    {
      type: 'selector', tag: '🌐 谷歌服务',
      outbounds: ['🚀 节点选择', '⚡ 自动选优', ...nodeNames, 'direct'],
    },
    {
      type: 'selector', tag: '🇨🇳 国内直连',
      outbounds: ['direct', '🚀 节点选择'],
      default: 'direct',
    },
    {
      type: 'selector', tag: '🚫 广告拦截',
      outbounds: ['block', 'direct'],
      default: 'block',
    },
    {
      type: 'selector', tag: '🐟 漏网之鱼',
      outbounds: ['🚀 节点选择', '⚡ 自动选优', 'direct'],
    },
  ];

  // Build rules
  const categories = getSingboxRuleCategories();
  const routeRules = [];

  // Private
  const privateAgg = aggregateRules(categories.private);
  if (Object.keys(privateAgg).length) {
    routeRules.push({ ...privateAgg, outbound: 'direct' });
  }

  // Reject
  const rejectAgg = aggregateRules(categories.reject);
  if (Object.keys(rejectAgg).length) {
    routeRules.push({ ...rejectAgg, outbound: '🚫 广告拦截' });
  }

  // AI
  const aiAgg = aggregateRules(categories.ai);
  if (Object.keys(aiAgg).length) {
    routeRules.push({ ...aiAgg, outbound: '🤖 AI 服务' });
  }

  // Streaming
  const streamAgg = aggregateRules(categories.streaming);
  if (Object.keys(streamAgg).length) {
    routeRules.push({ ...streamAgg, outbound: '🎬 流媒体' });
  }

  // Social
  const socialAgg = aggregateRules(categories.social);
  if (Object.keys(socialAgg).length) {
    routeRules.push({ ...socialAgg, outbound: '📱 社交媒体' });
  }

  // Google
  const googleAgg = aggregateRules(categories.google);
  if (Object.keys(googleAgg).length) {
    routeRules.push({ ...googleAgg, outbound: '🌐 谷歌服务' });
  }

  // Direct (China)
  const directAgg = aggregateRules(categories.direct);
  if (Object.keys(directAgg).length) {
    routeRules.push({ ...directAgg, outbound: '🇨🇳 国内直连' });
  }

  // Config
  const config = {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { tag: 'google', address: 'https://dns.google/dns-query', detour: '🚀 节点选择' },
        { tag: 'alidns', address: 'https://dns.alidns.com/dns-query', detour: 'direct' },
        { tag: 'block', address: 'rcode://success' },
      ],
      rules: [
        { outbound: ['any'], server: 'alidns' },
        { clash_mode: 'Direct', server: 'alidns' },
        { clash_mode: 'Global', server: 'google' },
        { geosite: ['cn'], server: 'alidns' },
      ],
      final: 'google',
      strategy: 'prefer_ipv4',
    },
    inbounds: [
      { type: 'tun', tag: 'tun-in', inet4_address: '172.19.0.1/30', auto_route: true, strict_route: true, stack: 'system' },
      { type: 'mixed', tag: 'mixed-in', listen: '::', listen_port: 7890 },
    ],
    outbounds: [
      ...selectorOutbounds,
      ...outbounds,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
      { type: 'dns', tag: 'dns-out' },
    ],
    route: {
      auto_detect_interface: true,
      final: '🐟 漏网之鱼',
      rules: [
        { protocol: 'dns', outbound: 'dns-out' },
        ...routeRules,
      ],
    },
    experimental: {
      clash_api: {
        external_controller: '127.0.0.1:9090',
        store_selected: true,
      },
    },
  };

  return JSON.stringify(config, null, 2);
}

module.exports = { generateSingboxConfig, nodeToSingboxOutbound };
