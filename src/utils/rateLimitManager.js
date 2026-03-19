/**
 * Rate Limit Manager
 * Extends rate limiting to all API endpoints with per-user and per-IP limits
 */

const rateLimit = require('express-rate-limit');
const logger = require('./logger');

class RateLimitManager {
  /**
   * Create a per-user rate limiter
   * @param {number} windowMs - Time window in milliseconds
   * @param {number} maxRequests - Maximum requests per window
   * @returns {function} Express middleware
   */
  static createPerUserLimiter(windowMs = 15 * 60 * 1000, maxRequests = 100) {
    return rateLimit({
      windowMs,
      max: (req, res) => {
        // Allow more requests for authenticated users
        if (req.session?.user) {
          return maxRequests * 2; // Double limit for authenticated users
        }
        return maxRequests;
      },
      keyGenerator: (req, res) => {
        // Use user ID if authenticated, otherwise use IP
        if (req.session?.user?.Id) {
          return `user:${req.session.user.Id}`;
        }
        return req.ip;
      },
      handler: (req, res) => {
        const identifier = req.session?.user?.Id || req.ip;
        logger.warn('Rate limit exceeded', {
          identifier,
          path: req.path,
          method: req.method,
          ip: req.ip
        });

        const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
        if (isAjax) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests. Please try again later.',
              retryAfter: req.rateLimit.resetTime
            }
          });
        }

        res.status(429).render('error', {
          message: 'Too many requests. Please try again later.',
          code: 429
        });
      },
      skip: (req, res) => {
        // Skip rate limiting for health checks and static files
        return req.path === '/api/health' || req.path.startsWith('/css/') || req.path.startsWith('/js/');
      }
    });
  }

  /**
   * Create an API endpoint rate limiter
   * @param {number} windowMs - Time window in milliseconds
   * @param {number} maxRequests - Maximum requests per window
   * @returns {function} Express middleware
   */
  static createApiLimiter(windowMs = 15 * 60 * 1000, maxRequests = 100) {
    return rateLimit({
      windowMs,
      max: maxRequests,
      keyGenerator: (req, res) => req.ip,
      handler: (req, res) => {
        logger.warn('API rate limit exceeded', {
          ip: req.ip,
          path: req.path,
          method: req.method
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'API rate limit exceeded. Please try again later.',
            retryAfter: req.rateLimit.resetTime
          }
        });
      }
    });
  }

  /**
   * Create a strict rate limiter for authentication endpoints
   * @returns {function} Express middleware
   */
  static createAuthLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per 15 minutes
      keyGenerator: (req, res) => {
        // Rate limit by username + IP to prevent username enumeration
        const username = req.body?.username || 'unknown';
        return `${username}:${req.ip}`;
      },
      handler: (req, res) => {
        logger.warn('Auth rate limit exceeded', {
          username: req.body?.username,
          ip: req.ip
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'AUTH_RATE_LIMIT',
            message: 'Too many login attempts. Please try again later.',
            retryAfter: req.rateLimit.resetTime
          }
        });
      }
    });
  }

  /**
   * Create a rate limiter for admin operations
   * @returns {function} Express middleware
   */
  static createAdminLimiter() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requests per minute
      keyGenerator: (req, res) => {
        // Rate limit by user ID
        return req.session?.user?.Id || req.ip;
      },
      handler: (req, res) => {
        logger.warn('Admin rate limit exceeded', {
          userId: req.session?.user?.Id,
          ip: req.ip,
          path: req.path
        });

        res.status(429).json({
          success: false,
          error: {
            code: 'ADMIN_RATE_LIMIT',
            message: 'Too many admin operations. Please slow down.',
            retryAfter: req.rateLimit.resetTime
          }
        });
      }
    });
  }

  /**
   * Get rate limit status for a user/IP
   * @param {string} identifier - User ID or IP address
   * @returns {object} Rate limit status
   */
  static getStatus(identifier) {
    // This would require integration with the actual rate limiter store
    // For now, return a placeholder
    return {
      identifier,
      remaining: 'N/A',
      resetTime: 'N/A',
      limit: 'N/A'
    };
  }
}

module.exports = RateLimitManager;
