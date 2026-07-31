/**
 * auth.js - Simple cookie-based authentication middleware
 */

const crypto = require('crypto');
const nodeManager = require('../services/nodeManager');

const SESSION_COOKIE = 'subhub_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory session store (simple, resets on restart)
const sessions = new Map();

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Login handler
 */
function login(req, res) {
  const { password } = req.body;
  const correctPass = nodeManager.getPassword();

  if (password === correctPass) {
    const sessionId = generateSessionId();
    sessions.set(sessionId, {
      createdAt: Date.now(),
      ip: req.ip,
    });

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE,
      sameSite: 'lax',
      secure: false, // set true if behind HTTPS proxy
    });

    return res.json({ success: true });
  }

  return res.status(401).json({ success: false, error: '密码错误' });
}

/**
 * Logout handler
 */
function logout(req, res) {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.clearCookie(SESSION_COOKIE);
  res.json({ success: true });
}

/**
 * Authentication middleware - protects admin routes
 */
function requireAuth(req, res, next) {
  const sessionId = req.cookies?.[SESSION_COOKIE];

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: '未登录' });
  }

  const session = sessions.get(sessionId);

  // Check session expiry
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return res.status(401).json({ success: false, error: '会话已过期' });
  }

  next();
}

// Clean up expired sessions periodically
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_MAX_AGE) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000); // Every hour
sessionCleanupTimer.unref?.();

module.exports = { login, logout, requireAuth };
