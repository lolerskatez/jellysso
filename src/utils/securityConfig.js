/**
 * Runtime security configuration cache.
 *
 * Wraps rate-limiting, CSRF, and HTTPS-redirect into Express middlewares that
 * read their settings from the database (cached for CACHE_TTL ms) so changes
 * made through the admin Settings → Security tab take effect immediately
 * without a server restart.
 *
 * Usage
 * -----
 *   const securityConfig = require('./utils/securityConfig');
 *
 *   // In server.js — mount once:
 *   app.use(securityConfig.getRateLimiterMiddleware());
 *   app.use(securityConfig.getHttpsRedirectMiddleware());
 *
 *   // In admin route — after saving security settings:
 *   securityConfig.invalidateCache();
 *   securityConfig.reconfigureLimiter(parseInt(s.rateLimit) || 60);
 */

const rateLimit = require('express-rate-limit');
const DatabaseManager = require('../models/DatabaseManager');

// How long to cache DB settings before re-reading (ms)
const CACHE_TTL = 30_000;

let _cache = null;
let _cacheTime = 0;

// The current express-rate-limit instance; replaced by reconfigureLimiter()
let _limiter = _buildLimiter(60);

// ─── helpers ─────────────────────────────────────────────────────────────────

function _buildLimiter(maxPerMinute) {
  return rateLimit({
    windowMs: 60 * 1000,          // 1-minute window (matches "requests/minute" label)
    max: maxPerMinute,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === '/api/health' ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/webfonts/') ||
      req.path.startsWith('/images/'),
  });
}

async function _getSettings() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  try {
    const raw = await DatabaseManager.getAllSettings();
    _cache = {
      rateLimitEnabled: raw.rate_limit_enabled !== 'false',
      rateLimit:        parseInt(raw.rate_limit) || 60,
      csrfEnabled:      raw.csrf_protection     !== 'false',
      httpsRequired:    raw.require_https        === 'true',
    };
  } catch (_) {
    // On DB error default to secure values — don't cache this so we retry soon
    return { rateLimitEnabled: true, rateLimit: 60, csrfEnabled: true, httpsRequired: false };
  }

  _cacheTime = now;
  return _cache;
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Invalidate the settings cache so the next request re-reads from DB.
 * Call this after any security setting is saved.
 */
function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

/**
 * Replace the rate-limiter instance with a new max (requests/minute).
 * Call this after saving the rateLimit setting.
 * @param {number} maxPerMinute
 */
function reconfigureLimiter(maxPerMinute) {
  _limiter = _buildLimiter(Math.max(1, maxPerMinute));
}

/**
 * Express middleware: enforces rate-limiting when rateLimitEnabled is true.
 * Reads settings from cache; transparent (calls next()) when disabled.
 * Mount once in server.js: app.use(securityConfig.getRateLimiterMiddleware())
 */
function getRateLimiterMiddleware() {
  return async function dynamicRateLimiter(req, res, next) {
    try {
      const settings = await _getSettings();
      if (!settings.rateLimitEnabled) return next();
      return _limiter(req, res, next);
    } catch (_) {
      return next();
    }
  };
}

/**
 * Express middleware: redirects HTTP → HTTPS when requireHttps is true.
 * Mount once in server.js: app.use(securityConfig.getHttpsRedirectMiddleware())
 */
function getHttpsRedirectMiddleware() {
  return async function httpsRedirect(req, res, next) {
    try {
      const settings = await _getSettings();
      if (!settings.httpsRequired) return next();
      // Already secure (direct TLS or behind a terminating proxy)
      if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
      const port = process.env.HTTPS_PORT || 3443;
      return res.redirect(301, `https://${req.hostname}:${port}${req.originalUrl}`);
    } catch (_) {
      return next();
    }
  };
}

/**
 * Returns true if CSRF protection should be enforced for this request.
 * Used inside the CSRF middleware in server.js.
 */
async function isCsrfEnabled() {
  const s = await _getSettings();
  return s.csrfEnabled;
}

module.exports = {
  invalidateCache,
  reconfigureLimiter,
  getRateLimiterMiddleware,
  getHttpsRedirectMiddleware,
  isCsrfEnabled,
};
