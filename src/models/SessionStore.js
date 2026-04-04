const DatabaseManager = require('./DatabaseManager');
const session = require('express-session');
const logger = require('../utils/logger');

/**
 * Database-backed session store for Express
 * Enables session persistence across server restarts and clustering
 */
class SessionStore extends session.Store {
  constructor(options = {}) {
    super(options);
    this.options = {
      expirationTime: options.expirationTime || 24 * 60 * 60 * 1000, // 24 hours default
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000, // cleanup every hour
      ...options
    };
    // Pending set() calls that arrived before the DB was ready
    this._pendingWrites = [];

    this.initializeTable();
    this.startCleanupInterval();
  }

  /**
   * Initialize sessions table in database
   */
  initializeTable() {
    // Wait for DatabaseManager to be ready
    DatabaseManager.onReady(() => {
      // Create sessions table
      DatabaseManager.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expires DATETIME NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          logger.error('Error creating sessions table:', err.message);
        }
      });

      // Create index for expiration cleanup
      DatabaseManager.db.run(`
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)
      `, (err) => {
        if (err) {
          logger.error('Error creating index on sessions table:', err.message);
        }
      });

      // Flush any set() calls that arrived before the DB was ready
      if (this._pendingWrites && this._pendingWrites.length > 0) {
        logger.info(`SessionStore: flushing ${this._pendingWrites.length} pending session write(s)`);
        for (const { sid, sess, callback } of this._pendingWrites) {
          this.set(sid, sess, callback);
        }
        this._pendingWrites = [];
      }
    });
  }

  /**
   * Get session by ID
   */
  get(sid, callback) {
    if (!DatabaseManager.db || !DatabaseManager.isReady) {
      return callback(null, null);
    }
    const query = 'SELECT sess FROM sessions WHERE sid = ? AND expires > datetime("now")';
    
    DatabaseManager.db.get(query, [sid], (err, row) => {
      if (err) {
        return callback(err);
      }
      
      if (!row) {
        return callback(null, null);
      }

      try {
        const sess = JSON.parse(row.sess);
        callback(null, sess);
      } catch (e) {
        callback(e);
      }
    });
  }

  /**
   * Set/store session
   */
  set(sid, sess, callback) {
    callback = callback || function() {};

    if (!DatabaseManager.db || !DatabaseManager.isReady) {
      // Queue the write — will be flushed once the DB becomes ready
      logger.debug('SessionStore: DB not ready, queuing session write for', sid.substring(0, 10));
      this._pendingWrites.push({ sid, sess, callback });
      return;
    }

    const expiresAt = new Date(Date.now() + this.options.expirationTime);
    const sessJson = JSON.stringify(sess);

    const query = `
      INSERT OR REPLACE INTO sessions (sid, sess, expires, updatedAt)
      VALUES (?, ?, ?, datetime("now"))
    `;

    DatabaseManager.db.run(query, [sid, sessJson, expiresAt.toISOString()], callback);
  }

  /**
   * Destroy/delete session
   */
  destroy(sid, callback) {
    callback = callback || function() {};

    if (!DatabaseManager.db || !DatabaseManager.isReady) {
      return callback(null);
    }

    const query = 'DELETE FROM sessions WHERE sid = ?';
    DatabaseManager.db.run(query, [sid], callback);
  }

  /**
   * Clean up expired sessions
   */
  cleanup(callback) {
    const p = new Promise((resolve, reject) => {
      if (!DatabaseManager.db || !DatabaseManager.isReady) {
        return resolve(0);
      }
      const query = 'DELETE FROM sessions WHERE expires < datetime("now")';
      DatabaseManager.db.run(query, function(err) {
        if (err) {
          logger.error('Session cleanup error:', err);
          reject(err);
        } else {
          logger.info(`Session cleanup: removed ${this.changes} expired sessions`);
          resolve(this.changes);
        }
      });
    });
    if (typeof callback === 'function') {
      p.then(count => callback(null, count)).catch(err => callback(err));
    }
    return p;
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanupInterval() {
    setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        logger.error('Session cleanup failed:', error);
      }
    }, this.options.cleanupInterval);

    logger.info(`✅ Session cleanup scheduled every ${this.options.cleanupInterval / 60000} minutes`);
  }

  /**
   * Get session count
   */
  length(callback) {
    const query = 'SELECT COUNT(*) as count FROM sessions WHERE expires > datetime("now")';
    
    DatabaseManager.db.get(query, [], (err, row) => {
      if (err) {
        return callback(err);
      }
      callback(null, row.count);
    });
  }

  /**
   * Clear all sessions
   */
  clear(callback) {
    callback = callback || function() {};

    const query = 'DELETE FROM sessions';
    DatabaseManager.db.run(query, callback);
  }

  /**
   * Get session stats
   */
  getStats(callback) {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN expires > datetime("now") THEN 1 END) as active,
        COUNT(CASE WHEN expires <= datetime("now") THEN 1 END) as expired
      FROM sessions
    `;

    DatabaseManager.db.get(query, [], (err, row) => {
      if (err) {
        return callback(err);
      }
      callback(null, row || { total: 0, active: 0, expired: 0 });
    });
  }
}

module.exports = SessionStore;
