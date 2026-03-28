const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');
const { runMigrations } = require('./MigrationManager');

// On non-Windows, restrict DB file to owner-only after creation
function lockDbPermissions(filePath) {
  if (os.platform() !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  }
}

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, '../config/companion.db');
    this.db = null;
    this.isReady = false;
    this.readyCallbacks = [];
    this.ensureDatabase();
  }

  getInstance() {
    return this;
  }

  onReady(callback) {
    if (this.isReady) {
      callback();
    } else {
      this.readyCallbacks.push(callback);
    }
  }

  ensureDatabase() {
    // Create db directory if it doesn't exist
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        logger.error('Error opening database:', err);
      } else {
        logger.info('Connected to SQLite database');
        lockDbPermissions(this.dbPath);
        // Enable WAL mode for better crash safety and concurrent read performance
        this.db.run('PRAGMA journal_mode=WAL', (walErr) => {
          if (walErr) logger.warn('Could not enable WAL mode:', walErr.message);
        });
        // Enforce foreign key constraints
        this.db.run('PRAGMA foreign_keys=ON');
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
        if (err) logger.error('Error creating settings table:', err.message);
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
        if (err) logger.error('Error creating audit_logs table:', err.message);
      });

      // Create indexes for audit_logs
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)', (err) => {
        if (err) logger.error('Error creating index idx_audit_action:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_userId ON audit_logs(userId)', (err) => {
        if (err) logger.error('Error creating index idx_audit_userId:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)', (err) => {
        if (err) logger.error('Error creating index idx_audit_timestamp:', err.message);
      });

      // Sessions table (optional, for session store)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          sess TEXT NOT NULL,
          expires DATETIME NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) logger.error('Error creating sessions table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_session_expires ON sessions(expires)', (err) => {
        if (err) logger.error('Error creating index idx_session_expires:', err.message);
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
        if (err) logger.error('Error creating import_history table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_import_date ON import_history(date)', (err) => {
        if (err) logger.error('Error creating index idx_import_date:', err.message);
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
        if (err) logger.error('Error creating user_profiles table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_profiles_jellyfin_id ON user_profiles(jellyfin_user_id)', (err) => {
        if (err) logger.error('Error creating index idx_user_profiles_jellyfin_id:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email)', (err) => {
        if (err) logger.error('Error creating index idx_user_profiles_email:', err.message);
      });

      // Message Templates table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS message_templates (
          id TEXT PRIMARY KEY,
          key TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          subject TEXT,
          body TEXT NOT NULL,
          format TEXT DEFAULT 'markdown',
          variables JSON,
          is_active BOOLEAN DEFAULT 1,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id)
        )
      `, (err) => {
        if (err) logger.error('Error creating message_templates table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_message_templates_key ON message_templates(key)', (err) => {
        if (err) logger.error('Error creating index idx_message_templates_key:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_message_templates_active ON message_templates(is_active)', (err) => {
        if (err) logger.error('Error creating index idx_message_templates_active:', err.message);
      });

      // User Notification Preferences table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_notification_preferences (
          id TEXT PRIMARY KEY,
          user_id TEXT UNIQUE NOT NULL,
          email_enabled BOOLEAN DEFAULT 1,
          discord_enabled BOOLEAN DEFAULT 0,
          discord_user_id TEXT,
          discord_verified BOOLEAN DEFAULT 0,
          telegram_enabled BOOLEAN DEFAULT 0,
          telegram_chat_id TEXT,
          telegram_verified BOOLEAN DEFAULT 0,
          matrix_enabled BOOLEAN DEFAULT 0,
          matrix_user_id TEXT,
          matrix_verified BOOLEAN DEFAULT 0,
          notification_digest BOOLEAN DEFAULT 0,
          digest_frequency TEXT DEFAULT 'daily',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) logger.error('Error creating user_notification_preferences table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON user_notification_preferences(user_id)', (err) => {
        if (err) logger.error('Error creating index idx_notif_prefs_user:', err.message);
      });

      // Integration Configs table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS integration_configs (
          id TEXT PRIMARY KEY,
          service_name TEXT UNIQUE NOT NULL,
          config TEXT NOT NULL,
          is_active BOOLEAN DEFAULT 0,
          last_tested DATETIME,
          test_status TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) logger.error('Error creating integration_configs table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_integration_service ON integration_configs(service_name)', (err) => {
        if (err) logger.error('Error creating index idx_integration_service:', err.message);
      });

      // Notification Queue table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS notification_queue (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          template_key TEXT NOT NULL,
          channels TEXT NOT NULL,
          variables TEXT,
          status TEXT DEFAULT 'pending',
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          priority TEXT DEFAULT 'normal',
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          sent_at DATETIME,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) logger.error('Error creating notification_queue table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_queue_status ON notification_queue(status)', (err) => {
        if (err) logger.error('Error creating index idx_notif_queue_status:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_queue_user ON notification_queue(user_id)', (err) => {
        if (err) logger.error('Error creating index idx_notif_queue_user:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_queue_created ON notification_queue(created_at)', (err) => {
        if (err) logger.error('Error creating index idx_notif_queue_created:', err.message);
      });

      // Notification Logs table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS notification_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          template_key TEXT,
          channel TEXT,
          status TEXT,
          error_message TEXT,
          delivered_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (err) => {
        if (err) logger.error('Error creating notification_logs table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_logs_user ON notification_logs(user_id)', (err) => {
        if (err) logger.error('Error creating index idx_notif_logs_user:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_logs_channel ON notification_logs(channel)', (err) => {
        if (err) logger.error('Error creating index idx_notif_logs_channel:', err.message);
      });
      
      // Users table - for account expiry and admin state (linked to Jellyfin accounts)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT,
          email TEXT,
          enabled BOOLEAN DEFAULT 1,
          expiresAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) logger.error('Error creating users table:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expiresAt)', (err) => {
        if (err) logger.error('Error creating index idx_users_expires:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)', (err) => {
        if (err) logger.error('Error creating index idx_users_email:', err.message);
      });
      this.db.run('CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled)', (err) => {
        if (err) logger.error('Error creating index idx_users_enabled:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_notif_logs_created ON notification_logs(created_at)', (err) => {
        if (err) logger.error('Error creating index idx_notif_logs_created:', err.message);

        // contact_verifications — used by ContactMethodManager
        this.db.run(`
          CREATE TABLE IF NOT EXISTS contact_verifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            method TEXT NOT NULL,
            contact_id TEXT NOT NULL,
            code TEXT NOT NULL,
            attempts INTEGER DEFAULT 0,
            max_attempts INTEGER DEFAULT 5,
            verified BOOLEAN DEFAULT 0,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
          )`, (cvErr) => {
          if (cvErr) logger.error('Error creating contact_verifications table:', cvErr.message);
          this.db.run('CREATE INDEX IF NOT EXISTS idx_contact_verif_user ON contact_verifications(user_id)', (idxErr) => {
            if (idxErr) logger.error('Error creating index idx_contact_verif_user:', idxErr.message);
          });
          this.db.run('CREATE INDEX IF NOT EXISTS idx_contact_verif_expires ON contact_verifications(expires_at)', (idxErr) => {
            if (idxErr) logger.error('Error creating index idx_contact_verif_expires:', idxErr.message);
          });

          // quickconnect_sessions — persists QC session state across restarts
          this.db.run(`
            CREATE TABLE IF NOT EXISTS quickconnect_sessions (
              code TEXT PRIMARY KEY,
              secret TEXT,
              device_name TEXT,
              device_type TEXT,
              user_id TEXT,
              initiated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              expires_at DATETIME NOT NULL
            )`, (qcErr) => {
            if (qcErr) logger.error('Error creating quickconnect_sessions table:', qcErr.message);
            this.db.run('CREATE INDEX IF NOT EXISTS idx_qc_expires ON quickconnect_sessions(expires_at)');
          });

          // discord_verification_codes — persists Discord DM verification codes across restarts
          this.db.run(`
            CREATE TABLE IF NOT EXISTS discord_verification_codes (
              code TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              expires_at DATETIME NOT NULL
            )`, (dvErr) => {
            if (dvErr) logger.error('Error creating discord_verification_codes table:', dvErr.message);
            this.db.run('CREATE INDEX IF NOT EXISTS idx_dvc_expires ON discord_verification_codes(expires_at)');
          });

          // Run schema migrations then mark database as ready
          runMigrations(this.db)
            .catch((err) => logger.error('[DatabaseManager] Migration error:', err))
            .finally(() => {
              this.isReady = true;
              this.readyCallbacks.forEach(cb => cb());
              this.readyCallbacks = [];
            });
        });
      });
    });
  }

  /**
   * Get a setting value
   */
  getSetting(key) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT value, type FROM settings WHERE key = ?', [key], (err, row) => {
        if (err) return reject(err);
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
          if (err) return reject(err);
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
        if (err) return reject(err);
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
          if (err) return reject(err);
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
        if (err) return reject(err);
        const logs = rows?.map(row => ({
          ...row,
          details: row.details ? JSON.parse(row.details) : {}
        })) || [];
        resolve(logs);
      });
    });
  }

  /**
   * Clear all audit logs
   */
  clearAllAuditLogs() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM audit_logs', [], function(err) {
        if (err) return reject(err);
        else resolve(this.changes);
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
          if (err) return reject(err);
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
        if (err) return reject(err);
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
        if (err) return reject(err);
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
        if (err) return reject(err);
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
        if (err) return reject(err);
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
          if (err) return reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new DatabaseManager();
