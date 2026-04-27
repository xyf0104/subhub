/**
 * configGenerator.js - Multi-format configuration generator
 * Orchestrates template modules to produce output for different clients
 */

const { generateClashConfig } = require('../templates/clashTemplate');
const { generateSingboxConfig } = require('../templates/singboxTemplate');
const { generateSurgeConfig } = require('../templates/surgeTemplate');
const { nodeToURI } = require('./nodeParser');
const nodeManager = require('./nodeManager');

/**
 * 获取所有启用的节点
 */
function getActiveNodes() {
  return nodeManager.getEnabledNodes();
}

/**
 * 生成订阅配置
 * @param {string} target - clash | v2ray | shadowrocket | surge | singbox | openclash
 * @param {Object} options - 可选参数
 * @param {Array} options.nodes - 指定节点列表（分享模式用，不传则使用全部启用节点）
 * @param {string} options.title - 自定义标题（分享模式用）
 * @returns {Object} { content, contentType, filename }
 */
function generate(target, options = {}) {
  const nodes = options.nodes || getActiveNodes();
  const title = options.title || 'SubHub';
  const clashOpts = { title };

  switch (target) {
    case 'clash':
    case 'clashmeta':
    case 'mihomo':
      return {
        content: generateClashConfig(nodes, clashOpts),
        contentType: 'text/yaml; charset=utf-8',
        filename: `${title}.yaml`,
      };

    case 'v2ray':
    case 'xray': {
      const uris = nodes.map(n => nodeToURI(n)).filter(Boolean);
      const content = Buffer.from(uris.join('\n')).toString('base64');
      return {
        content,
        contentType: 'text/plain; charset=utf-8',
        filename: `${title}.txt`,
      };
    }

    case 'shadowrocket': {
      const uris = nodes.map(n => nodeToURI(n)).filter(Boolean);
      const content = Buffer.from(uris.join('\n')).toString('base64');
      return {
        content,
        contentType: 'text/plain; charset=utf-8',
        filename: `${title}.txt`,
      };
    }

    case 'surge':
      return {
        content: generateSurgeConfig(nodes),
        contentType: 'text/plain; charset=utf-8',
        filename: `${title}.conf`,
      };

    case 'singbox':
    case 'sing-box':
      return {
        content: generateSingboxConfig(nodes),
        contentType: 'application/json; charset=utf-8',
        filename: `${title}.json`,
      };

    case 'uri':
    case 'raw': {
      const uris = nodes.map(n => nodeToURI(n)).filter(Boolean);
      return {
        content: uris.join('\n'),
        contentType: 'text/plain; charset=utf-8',
        filename: `${title}.txt`,
      };
    }

    case 'openclash':
      return {
        content: generateClashConfig(nodes, { ...clashOpts, openclash: true }),
        contentType: 'text/yaml; charset=utf-8',
        filename: `${title}_openclash.yaml`,
      };

    default:
      return {
        content: generateClashConfig(nodes, clashOpts),
        contentType: 'text/yaml; charset=utf-8',
        filename: `${title}.yaml`,
      };
  }
}

/**
 * Auto-detect target format from User-Agent
 */
function detectTarget(userAgent) {
  if (!userAgent) return 'clash';
  const ua = userAgent.toLowerCase();

  if (ua.includes('openclash')) return 'openclash';
  if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('stash')) return 'clash';
  if (ua.includes('surge')) return 'surge';
  if (ua.includes('shadowrocket') || ua.includes('loon')) return 'shadowrocket';
  if (ua.includes('sing-box') || ua.includes('singbox') || ua.includes('sfi') || ua.includes('sfa')) return 'singbox';
  if (ua.includes('v2ray') || ua.includes('xray') || ua.includes('v2rayn') || ua.includes('v2rayng')) return 'v2ray';
  if (ua.includes('quantumult') || ua.includes('qx')) return 'v2ray';

  return 'clash';
}

module.exports = { generate, detectTarget, getActiveNodes };
