/**
 * subscribe.js - Public subscription output routes
 * These endpoints don't require auth - they use token-based access
 */

const express = require('express');
const router = express.Router();
const nodeManager = require('../services/nodeManager');
const { generate, detectTarget } = require('../services/configGenerator');

/**
 * GET /sub/:token
 * Main subscription endpoint
 * Query params:
 *   target - clash | v2ray | shadowrocket | surge | singbox | uri
 *   (if not specified, auto-detect from User-Agent)
 */
router.get('/:token', (req, res) => {
  try {
    // Validate token
    const validToken = nodeManager.getToken();
    if (req.params.token !== validToken) {
      return res.status(403).send('Invalid subscription token');
    }

    // Determine target format
    const target = req.query.target || detectTarget(req.headers['user-agent']);

    // Generate config
    const result = generate(target);

    // Set headers
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Profile-Update-Interval', '6'); // hours
    res.setHeader('Subscription-UserInfo', `upload=0; download=0; total=107374182400; expire=0`);

    // Cache control
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.send(result.content);
  } catch (error) {
    console.error('Subscription generation error:', error);
    res.status(500).send('Failed to generate subscription');
  }
});

module.exports = router;
