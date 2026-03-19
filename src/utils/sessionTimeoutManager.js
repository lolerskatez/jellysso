/**
 * Session Timeout Manager
 * Enforces server-side session timeout with active invalidation
 */

const logger = require('./logger');

class SessionTimeoutManager {
  constructor(sessionStore) {
    this.sessionStore = sessionStore;
    this.sessionTimeouts = new Map(); // Track timeout timers
    this.defaultTimeout = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Set session timeout for a user
   * @param {string} sessionId - Session ID
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  setSessionTimeout(sessionId, timeoutMs = this.defaultTimeout) {
    // Clear existing timeout if any
    if (this.sessionTimeouts.has(sessionId)) {
      clearTimeout(this.sessionTimeouts.get(sessionId));
    }

    // Set new timeout
    const timeoutHandle = setTimeout(() => {
      this.invalidateSession(sessionId);
    }, timeoutMs);

    this.sessionTimeouts.set(sessionId, timeoutHandle);
  }

  /**
   * Reset session timeout on activity
   * @param {string} sessionId - Session ID
   * @param {number} timeoutMs - Timeout in milliseconds
   */
  resetSessionTimeout(sessionId, timeoutMs = this.defaultTimeout) {
    this.setSessionTimeout(sessionId, timeoutMs);
  }

  /**
   * Invalidate a session server-side
   * @param {string} sessionId - Session ID to invalidate
   */
  invalidateSession(sessionId) {
    try {
      // Clear the timeout
      if (this.sessionTimeouts.has(sessionId)) {
        clearTimeout(this.sessionTimeouts.get(sessionId));
        this.sessionTimeouts.delete(sessionId);
      }

      // Delete from session store if available
      if (this.sessionStore && typeof this.sessionStore.destroy === 'function') {
        this.sessionStore.destroy(sessionId, (err) => {
          if (err) {
            logger.warn('Could not destroy session in store', { sessionId, error: err.message });
          } else {
            logger.info('Session invalidated due to timeout', { sessionId });
          }
        });
      }
    } catch (err) {
      logger.error('Error invalidating session', { sessionId, error: err.message });
    }
  }

  /**
   * Cleanup all timeouts (for graceful shutdown)
   */
  cleanup() {
    for (const [sessionId, timeoutHandle] of this.sessionTimeouts.entries()) {
      clearTimeout(timeoutHandle);
    }
    this.sessionTimeouts.clear();
    logger.info('Session timeout manager cleaned up');
  }

  /**
   * Middleware to enforce session timeout
   * @param {number} timeoutMinutes - Timeout in minutes
   * @returns {function} Express middleware
   */
  middleware(timeoutMinutes = 30) {
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const skipPaths = ['/api/health', '/setup', '/login', '/css/', '/js/', '/webfonts/', '/images/', '/favicon'];

    return (req, res, next) => {
      // Skip timeout check for public paths
      if (skipPaths.some(p => req.path.startsWith(p))) {
        return next();
      }

      // Skip if no session or user
      if (!req.session || !req.session.user) {
        return next();
      }

      const sessionId = req.sessionID;
      const now = Date.now();
      const lastActivity = req.session.lastActivity || req.session.createdAt || now;
      const timeSinceActivity = now - lastActivity;

      // Check if session has exceeded timeout
      if (timeSinceActivity > timeoutMs) {
        logger.warn('Session timeout enforced', {
          sessionId: sessionId ? sessionId.substring(0, 16) + '...' : 'unknown',
          userId: req.session.user?.Id,
          inactivityMs: timeSinceActivity,
          timeoutMs
        });

        // Invalidate the session
        this.invalidateSession(sessionId);

        // Destroy session and redirect
        return req.session.destroy((err) => {
          if (err) {
            logger.error('Error destroying session', { error: err.message });
          }
          
          const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
          if (isAjax) {
            return res.status(401).json({
              success: false,
              error: {
                code: 'SESSION_TIMEOUT',
                message: 'Your session has expired due to inactivity. Please log in again.'
              }
            });
          }
          
          res.redirect('/login?expired=true');
        });
      }

      // Update last activity timestamp
      req.session.lastActivity = now;

      // Reset the timeout timer
      this.resetSessionTimeout(sessionId, timeoutMs);

      next();
    };
  }

  /**
   * Get session timeout stats
   * @returns {object} Statistics about active session timeouts
   */
  getStats() {
    return {
      activeSessions: this.sessionTimeouts.size,
      sessionIds: Array.from(this.sessionTimeouts.keys()).map(id => id.substring(0, 16) + '...')
    };
  }
}

module.exports = SessionTimeoutManager;
