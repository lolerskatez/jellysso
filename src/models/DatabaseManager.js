const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, '../config/companion.db');
    this.db = null;
    this.ensureDatabase();
  }

  ensureDatabase() {
    // Create db directory if it doesn't exist
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.initializeTables();
      }
    });
  }

  initializeTables() {
    // Use serialize to ensure tables are created before operations
    this.db.serialize(() => {
      // Settings table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          value TEXT,
          type TEXT DEFAULT 'string',
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating settings table:', err.message);
      });

      // Audit logs table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          action TEXT NOT NULL,
          userId TEXT,
          resource TEXT,
          status TEXT DEFAULT 'success',
          ip TEXT,
          details TEXT
        )
      `, (err) => {
        if (err) console.error('Error creating audit_logs table:', err.message);
      });

      // Create indexes for audit_logs
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)', (err) => {
        if (err) console.error('Error creating index idx_audit_action:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_userId ON audit_logs(userId)', (err) => {
        if (err) console.error('Error creating index idx_audit_userId:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)', (err) => {
        if (err) console.error('Error creating index idx_audit_timestamp:', err.message);
      });

      // Sessions table (optional, for session store)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expires DATETIME NOT NULL
        )
      `, (err) => {
        if (err) console.error('Error creating sessions table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_session_expires ON sessions(expires)', (err) => {
        if (err) console.error('Error creating index idx_session_expires:', err.message);
      });

      // Import history table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS import_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          total INTEGER NOT NULL,
          success INTEGER NOT NULL,
          failed INTEGER NOT NULL,
          date DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating import_history table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_import_date ON import_history(date)', (err) => {
        if (err) console.error('Error creating index idx_import_date:', err.message);
      });

      // Extended user profiles table - links to Jellyfin user IDs
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          jellyfin_user_id TEXT UNIQUE NOT NULL,
          first_name TEXT,
          last_name TEXT,
          email TEXT,
          display_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) console.error('Error creating user_profiles table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_profiles_jellyfin_id ON user_profiles(jellyfin_user_id)', (err) => {
        if (err) console.error('Error creating index idx_user_profiles_jellyfin_id:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email)', (err) => {
        if (err) console.error('Error creating index idx_user_profiles_email:', err.message);
      });
    });
  }

  /**
   * Get a setting value
   */
  getSetting(key) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT value, type FROM settings WHERE key = ?', [key], (err, row) => {
        if (err) reject(err);
        if (!row) {
          resolve(null);
        } else {
          try {
            // Parse JSON if type is json
            const value = row.type === 'json' ? JSON.parse(row.value) : row.value;
            resolve(value);
          } catch (e) {
            resolve(row.value);
          }
        }
      });
    });
  }

  /**
   * Set a setting value
   */
  setSetting(key, value, type = 'string') {
    return new Promise((resolve, reject) => {
      const storedValue = type === 'json' ? JSON.stringify(value) : String(value);
      this.db.run(
        'INSERT OR REPLACE INTO settings (key, value, type, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
        [key, storedValue, type],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        }
      );
    });
  }

  /**
   * Get all settings
   */
  getAllSettings() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT key, value, type FROM settings', (err, rows) => {
        if (err) reject(err);
        const settings = {};
        rows?.forEach(row => {
          try {
            settings[row.key] = row.type === 'json' ? JSON.parse(row.value) : row.value;
          } catch (e) {
            settings[row.key] = row.value;
          }
        });
        resolve(settings);
      });
    });
  }

  /**
   * Insert audit log entry
   */
  insertAuditLog(action, userId, resource, status = 'success', ip = null, details = {}) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO audit_logs (action, userId, resource, status, ip, details) VALUES (?, ?, ?, ?, ?, ?)',
        [action, userId || 'system', resource, status, ip, JSON.stringify(details)],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        }
      );
    });
  }

  /**
   * Get audit logs with filtering
   */
  getAuditLogs(options = {}) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params = [];

      if (options.action) {
        query += ' AND action = ?';
        params.push(options.action);
      }
      if (options.userId) {
        query += ' AND userId = ?';
        params.push(options.userId);
      }
      if (options.resource) {
        query += ' AND resource = ?';
        params.push(options.resource);
      }
      if (options.status) {
        query += ' AND status = ?';
        params.push(options.status);
      }
      if (options.startDate) {
        query += ' AND timestamp >= ?';
        params.push(options.startDate);
      }
      if (options.endDate) {
        query += ' AND timestamp <= ?';
        params.push(options.endDate);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(Math.min(options.limit || 100, 10000));

      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        const logs = rows?.map(row => ({
          ...row,
          details: row.details ? JSON.parse(row.details) : {}
        })) || [];
        resolve(logs);
      });
    });
  }

  /**
   * Delete old audit logs
   */
  cleanupAuditLogs(daysToKeep = 90) {
    return new Promise((resolve, reject) => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      this.db.run(
        'DELETE FROM audit_logs WHERE timestamp < ?',
        [cutoffDate.toISOString()],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  /**
   * Get audit log statistics
   */
  getAuditStats() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          COUNT(*) as total,
          status,
          COUNT(CASE WHEN timestamp >= datetime('now', '-1 day') THEN 1 END) as last24h
        FROM audit_logs
        GROUP BY status
      `, (err, rows) => {
        if (err) reject(err);
        const stats = {
          total: 0,
          byStatus: {},
          last24h: 0
        };
        rows?.forEach(row => {
          stats.total += row.total;
          stats.byStatus[row.status] = row.total;
          stats.last24h += row.last24h;
        });
        resolve(stats);
      });
    });
  }

  /**
   * Execute a generic query (returns all rows)
   */
  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Execute a query that returns a single row
   */
  queryOne(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Execute a query that returns a count
   */
  queryCount(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row?.count || 0);
      });
    });
  }

  /**
   * Close database connection
   */
  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new DatabaseManager();
