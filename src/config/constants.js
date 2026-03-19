/**
 * Centralized configuration constants
 * Eliminates hardcoded magic numbers throughout the codebase
 */

module.exports = {
  // Cache configuration
  CACHE: {
    TTL: 5 * 60 * 1000,           // 5 minutes
    MAX_SIZE: 1000,
    STATS_INTERVAL: 60 * 1000      // 1 minute
  },

  // Session configuration
  SESSION: {
    EXPIRATION_TIME: 24 * 60 * 60 * 1000,  // 24 hours
    CLEANUP_INTERVAL: 60 * 60 * 1000,      // 1 hour
    IDLE_TIMEOUT_MINUTES: 30,
    COOKIE_MAX_AGE: 24 * 60 * 60 * 1000    // 24 hours
  },

  // QuickConnect configuration
  QUICKCONNECT: {
    SESSION_TIMEOUT: 15 * 60 * 1000,       // 15 minutes
    CLEANUP_INTERVAL: 60 * 1000             // 1 minute
  },

  // Rate limiting configuration
  RATE_LIMIT: {
    CRITICAL: {
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: 'Too many attempts, please try again later'
    },
    ADMIN: {
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: 'Too many admin requests, please try again later'
    },
    API: {
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many API requests, please try again later'
    },
    PUBLIC: {
      windowMs: 15 * 60 * 1000,
      max: 50,
      message: 'Too many requests, please try again later'
    }
  },

  // Jellyfin API configuration
  JELLYFIN_API: {
    TIMEOUT: 30000,                 // 30 seconds
    CACHE_TIMEOUT: 5 * 60 * 1000,   // 5 minutes
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,              // 1 second (exponential backoff)
    MAX_CONTENT_LENGTH: 50 * 1024 * 1024  // 50MB
  },

  // Password validation
  PASSWORD: {
    MIN_LENGTH: 8,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBERS: true,
    REQUIRE_SPECIAL_CHARS: true,
    SPECIAL_CHARS_PATTERN: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    HISTORY_COUNT: 5,
    EXPIRATION_DAYS: 90
  },

  // Account lockout configuration
  ACCOUNT_LOCKOUT: {
    FAILED_ATTEMPTS_WARNING: 3,
    FAILED_ATTEMPTS_LOCKOUT_15MIN: 5,
    FAILED_ATTEMPTS_LOCKOUT_1HOUR: 10,
    FAILED_ATTEMPTS_LOCKOUT_24HOUR: 15,
    LOCKOUT_15MIN_DURATION: 15 * 60 * 1000,
    LOCKOUT_1HOUR_DURATION: 60 * 60 * 1000,
    LOCKOUT_24HOUR_DURATION: 24 * 60 * 60 * 1000,
    ATTEMPT_WINDOW: 60 * 60 * 1000  // 1 hour
  },

  // Database configuration
  DATABASE: {
    CLEANUP_INTERVAL: 24 * 60 * 60 * 1000,  // 24 hours
    AUDIT_LOG_RETENTION_DAYS: 90,
    SESSION_RETENTION_DAYS: 30,
    WEBHOOK_EVENT_RETENTION_DAYS: 30,
    API_KEY_USAGE_RETENTION_DAYS: 90
  },

  // CORS configuration
  CORS: {
    ALLOWED_ORIGINS: process.env.CORS_ORIGINS ? 
      process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : 
      ['http://localhost:3000', 'http://localhost:3001'],
    ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    ALLOWED_HEADERS: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    CREDENTIALS: true,
    MAX_AGE: 86400  // 24 hours
  },

  // Security headers
  SECURITY: {
    HSTS_MAX_AGE: 31536000,  // 1 year
    CSP_NONCE_LENGTH: 16,
    RATE_LIMIT_ENABLED: true,
    CSRF_PROTECTION_ENABLED: true,
    HTTPS_REQUIRED_PRODUCTION: true
  },

  // Maintenance tasks
  MAINTENANCE: {
    AUDIT_LOG_CLEANUP_INTERVAL: 24 * 60 * 60 * 1000,  // 24 hours
    SESSION_CLEANUP_INTERVAL: 60 * 60 * 1000,         // 1 hour
    CACHE_CLEANUP_INTERVAL: 60 * 60 * 1000,           // 1 hour
    DATABASE_OPTIMIZE_INTERVAL: 7 * 24 * 60 * 60 * 1000  // 7 days
  }
};
