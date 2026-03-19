/**
 * Session Rotation Utility
 * Handles secure session rotation on privilege escalation or other security events
 */

const crypto = require('crypto');

class SessionRotation {
  /**
   * Rotate session after privilege escalation
   * Creates a new session ID and invalidates the old one
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {function} callback - Callback function
   */
  static rotateSession(req, res, callback) {
    if (!req.session) {
      return callback(new Error('No session to rotate'));
    }

    // Store current session data
    const currentSessionData = {
      user: req.session.user,
      accessToken: req.session.accessToken,
      createdAt: req.session.createdAt,
      rotatedAt: Date.now(),
      rotationReason: 'privilege_escalation'
    };

    // Destroy old session
    req.session.destroy((err) => {
      if (err) {
        return callback(err);
      }

      // Create new session with fresh ID
      req.session.regenerate((err) => {
        if (err) {
          return callback(err);
        }

        // Restore user data to new session
        req.session.user = currentSessionData.user;
        req.session.accessToken = currentSessionData.accessToken;
        req.session.createdAt = currentSessionData.createdAt;
        req.session.rotatedAt = currentSessionData.rotatedAt;
        req.session.rotationReason = currentSessionData.rotationReason;
        req.session.lastActivity = Date.now();

        // Save the new session
        req.session.save((err) => {
          if (err) {
            return callback(err);
          }

          // Update session cookie
          res.setHeader('Set-Cookie', `connect.sid=${req.sessionID}; Path=/; HttpOnly; SameSite=Lax`);
          callback(null, req.sessionID);
        });
      });
    });
  }

  /**
   * Rotate session on login
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   * @param {object} userData - User data to store in session
   * @param {string} accessToken - Jellyfin access token
   * @param {function} callback - Callback function
   */
  static rotateSessionOnLogin(req, res, userData, accessToken, callback) {
    // Simply regenerate the session (this creates a new session ID)
    // No need to destroy first - regenerate handles that
    if (!req.session) {
      return callback(new Error('Session middleware not initialized'));
    }

    req.session.regenerate((err) => {
      if (err) {
        return callback(err);
      }

      // Set new session data
      req.session.user = userData;
      req.session.accessToken = accessToken;
      req.session.createdAt = Date.now();
      req.session.lastActivity = Date.now();
      req.session.loginMethod = 'password'; // Track login method

      req.session.save((err) => {
        if (err) {
          return callback(err);
        }
        callback(null, req.sessionID);
      });
    });
  }

  /**
   * Validate session integrity
   * Checks for signs of session hijacking or tampering
   * @param {object} req - Express request object
   * @returns {object} - Validation result with status and reason
   */
  static validateSessionIntegrity(req) {
    if (!req.session || !req.session.user) {
      return { valid: false, reason: 'No session data' };
    }

    // Check for required fields
    if (!req.session.user.Id || !req.session.accessToken) {
      return { valid: false, reason: 'Missing required session fields' };
    }

    // Check session age (warn if older than 24 hours)
    const sessionAge = Date.now() - (req.session.createdAt || 0);
    if (sessionAge > 24 * 60 * 60 * 1000) {
      return { valid: false, reason: 'Session expired' };
    }

    // Check for rotation history (prevent multiple rapid rotations)
    if (req.session.rotatedAt) {
      const timeSinceRotation = Date.now() - req.session.rotatedAt;
      if (timeSinceRotation < 1000) { // Less than 1 second
        return { valid: false, reason: 'Session rotated too recently' };
      }
    }

    return { valid: true, reason: 'Session is valid' };
  }

  /**
   * Get session metadata for audit logging
   * @param {object} req - Express request object
   * @returns {object} - Session metadata
   */
  static getSessionMetadata(req) {
    return {
      sessionId: req.sessionID ? req.sessionID.substring(0, 16) + '...' : 'unknown',
      userId: req.session?.user?.Id || 'unknown',
      createdAt: req.session?.createdAt || null,
      rotatedAt: req.session?.rotatedAt || null,
      lastActivity: req.session?.lastActivity || null,
      rotationReason: req.session?.rotationReason || null,
      loginMethod: req.session?.loginMethod || 'unknown'
    };
  }
}

module.exports = SessionRotation;
