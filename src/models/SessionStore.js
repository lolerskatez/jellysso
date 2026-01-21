const DatabaseManager = require('./DatabaseManager');
const session = require('express-session');

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
          console.error('Error creating sessions table:', err.message);
        }
      });

      // Migrate existing table if needed (add updatedAt column)
      DatabaseManager.db.run(`
        ALTER TABLE sessions ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      `, (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column')) {
          console.error('Session table migration error:', err.message);
        }
      });

      // Create index for expiration cleanup
      DatabaseManager.db.run(`
        CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)
      `, (err) => {
        if (err) {
          console.error('Error creating index on sessions table:', err.message);
        }
      });
    });
  }

  /**
   * Get session by ID
   */
  get(sid, callback) {
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

    const query = 'DELETE FROM sessions WHERE sid = ?';
    DatabaseManager.db.run(query, [sid], callback);
  }

  /**
   * Clean up expired sessions
   */
  async cleanup() {
    return new Promise((resolve, reject) => {
      const query = 'DELETE FROM sessions WHERE expires < datetime("now")';
      
      DatabaseManager.db.run(query, function(err) {
        if (err) {
          console.error('Session cleanup error:', err);
          reject(err);
        } else {
          console.log(`Session cleanup: removed ${this.changes} expired sessions`);
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Start automatic cleanup interval
   */
  startCleanupInterval() {
    setInterval(async () => {
      try {
        await this.cleanup();
      } catch (error) {
        console.error('Session cleanup failed:', error);
      }
    }, this.options.cleanupInterval);

    console.log(`✅ Session cleanup scheduled every ${this.options.cleanupInterval / 60000} minutes`);
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
