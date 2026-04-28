/**
 * SubHub - Self-hosted Proxy Subscription Management Server
 */

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

// Load env
try { require('dotenv').config(); } catch {}

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'subhub-secret-key'));

// NOTE: 禁止浏览器缓存静态资源，确保每次加载最新代码
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false }));

// API routes (admin)
const apiRouter = require('./src/routes/api');
app.use('/api', apiRouter);

// Share admin API (admin)
const shareRouter = require('./src/routes/share');
app.use('/api/shares', shareRouter);

// Subscription routes (public, token-protected)
const subRouter = require('./src/routes/subscribe');
app.use('/sub', subRouter);

// Share subscription route (public, share-token)
const { shareSubscribeHandler } = require('./src/routes/share');
app.get('/s/:token', shareSubscribeHandler);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const nodeManager = require('./src/services/nodeManager');
  const token = nodeManager.getToken();
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║          🚀 SubHub is running!           ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  Admin:  http://localhost:${PORT}          ║`);
  console.log(`  ║  Token:  ${token.substring(0, 16)}...          ║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
