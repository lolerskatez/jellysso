/**
 * Endpoint-specific rate limiting middleware
 * Implements tiered rate limits based on endpoint sensitivity
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { RATE_LIMIT } = require('../config/constants');

/**
 * Critical endpoints (login, password change, 2FA setup)
 * Very strict: 5 attempts per 15 minutes per IP
 */
const criticalLimiter = rateLimit({
  windowMs: RATE_LIMIT.CRITICAL.windowMs,
  max: RATE_LIMIT.CRITICAL.max,
  message: 'Too many login attempts from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Don't rate limit if user is already authenticated
    return req.session && req.session.user;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded on critical endpoint', {
      ip: req.ip,
      path: req.path,
      requestId: req.id
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many attempts. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
});

/**
 * Admin operations (user creation, policy changes, etc.)
 * Moderate: 20 attempts per 15 minutes per IP
 */
const adminLimiter = rateLimit({
  windowMs: RATE_LIMIT.ADMIN.windowMs,
  max: RATE_LIMIT.ADMIN.max,
  message: 'Too many admin operations from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Don't rate limit authenticated users on admin routes;
    // requireAdmin middleware is the real access gate.
    return !!(req.session && req.session.user);
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded on admin endpoint', {
      ip: req.ip,
      path: req.path,
      userId: req.session?.user?.Id,
      requestId: req.id
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many admin operations. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
});

/**
 * General API endpoints
 * Lenient: 100 attempts per 15 minutes per IP
 */
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT.API.windowMs,
  max: RATE_LIMIT.API.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded on API endpoint', {
      ip: req.ip,
      path: req.path,
      userId: req.session?.user?.Id,
      requestId: req.id
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
});

/**
 * Public endpoints (no authentication required)
 * Moderate: 50 attempts per 15 minutes per IP
 */
const publicLimiter = rateLimit({
  windowMs: RATE_LIMIT.PUBLIC.windowMs,
  max: RATE_LIMIT.PUBLIC.max,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded on public endpoint', {
      ip: req.ip,
      path: req.path,
      requestId: req.id
    });
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        retryAfter: req.rateLimit.resetTime,
        timestamp: new Date().toISOString(),
        requestId: req.id
      }
    });
  }
});

module.exports = {
  criticalLimiter,
  adminLimiter,
  apiLimiter,
  publicLimiter
};
