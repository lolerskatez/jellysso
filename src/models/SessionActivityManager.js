/**
 * Session Activity Manager
 * Tracks user session activity and login history
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class SessionActivityManager {
  static instance = null;

  static getInstance() {
    if (!SessionActivityManager.instance) {
      SessionActivityManager.instance = new SessionActivityManager();
      SessionActivityManager.instance.initializeSchema();
    }
    return SessionActivityManager.instance;
  }

  /**
   * Initialize database schema for session activity tracking
   */
  async initializeSchema() {
    const db = DatabaseManager;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Session activity table
        db.run(`
          CREATE TABLE IF NOT EXISTS session_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            ip_address TEXT NOT NULL,
            user_agent TEXT,
            login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            logout_time DATETIME,
            duration_minutes INTEGER,
            status TEXT DEFAULT 'active'
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create session_activity table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_activity_user_id 
          ON session_activity(user_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_activity_session_id 
          ON session_activity(session_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_session_activity_login_time 
          ON session_activity(login_time)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            logger.info('Session activity schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Record a new session login
   */
  async recordLogin(userId, sessionId, ip, userAgent) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.run(
        `INSERT INTO session_activity (user_id, session_id, ip_address, user_agent) 
         VALUES (?, ?, ?, ?)`,
        [userId, sessionId, ip, userAgent],
        function(err) {
          if (err) {
            logger.error('Failed to record session login', { error: err.message, userId });
            reject(err);
          } else {
            logger.info('Session login recorded', { userId, sessionId, ip });
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * Record session logout
   */
  async recordLogout(sessionId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.run(
        `UPDATE session_activity 
         SET logout_time = CURRENT_TIMESTAMP, status = 'closed'
         WHERE session_id = ?`,
        [sessionId],
        (err) => {
          if (err) {
            logger.error('Failed to record session logout', { error: err.message });
            reject(err);
          } else {
            logger.info('Session logout recorded', { sessionId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Update last activity timestamp
   */
  async updateActivity(sessionId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.run(
        `UPDATE session_activity 
         SET last_activity = CURRENT_TIMESTAMP 
         WHERE session_id = ? AND status = 'active'`,
        [sessionId],
        (err) => {
          if (err) {
            logger.error('Failed to update session activity', { error: err.message });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get user's active sessions
   */
  async getActiveSessions(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.all(
        `SELECT id, session_id, ip_address, user_agent, login_time, last_activity 
         FROM session_activity 
         WHERE user_id = ? AND status = 'active'
         ORDER BY login_time DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get active sessions', { error: err.message, userId });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get user's session history
   */
  async getSessionHistory(userId, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.all(
        `SELECT id, session_id, ip_address, user_agent, login_time, logout_time, 
                CAST((julianday(logout_time) - julianday(login_time)) * 24 * 60 AS INTEGER) as duration_minutes,
                status
         FROM session_activity 
         WHERE user_id = ?
         ORDER BY login_time DESC
         LIMIT ? OFFSET ?`,
        [userId, limit, offset],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get session history', { error: err.message, userId });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Terminate a specific session
   */
  async terminateSession(sessionId, userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.run(
        `UPDATE session_activity 
         SET logout_time = CURRENT_TIMESTAMP, status = 'terminated'
         WHERE session_id = ? AND user_id = ?`,
        [sessionId, userId],
        (err) => {
          if (err) {
            logger.error('Failed to terminate session', { error: err.message });
            reject(err);
          } else {
            logger.info('Session terminated', { sessionId, userId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get concurrent session count for user
   */
  async getConcurrentSessionCount(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      db.get(
        `SELECT COUNT(*) as count FROM session_activity 
         WHERE user_id = ? AND status = 'active'`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get concurrent session count', { error: err.message });
            reject(err);
          } else {
            resolve(row?.count || 0);
          }
        }
      );
    });
  }

  /**
   * Cleanup old session records (older than 90 days)
   */
  async cleanupOldSessions(daysOld = 90) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager;
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
      
      db.run(
        `DELETE FROM session_activity 
         WHERE logout_time < ? OR (status = 'active' AND login_time < ?)`,
        [cutoffDate, cutoffDate],
        function(err) {
          if (err) {
            logger.error('Failed to cleanup old sessions', { error: err.message });
            reject(err);
          } else {
            logger.info('Old sessions cleaned up', { deletedCount: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = SessionActivityManager;
