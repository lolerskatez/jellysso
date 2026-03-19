/**
 * Password Policy Manager
 * Manages password expiration policies and enforces password changes
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class PasswordPolicyManager {
  static instance = null;

  static getInstance() {
    if (!PasswordPolicyManager.instance) {
      PasswordPolicyManager.instance = new PasswordPolicyManager();
      PasswordPolicyManager.instance.initializeSchema();
    }
    return PasswordPolicyManager.instance;
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const db = DatabaseManager.getInstance();

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Global password policy settings
        db.run(`
          CREATE TABLE IF NOT EXISTS password_policy_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            expiration_days INTEGER DEFAULT 90,
            min_length INTEGER DEFAULT 8,
            require_uppercase INTEGER DEFAULT 1,
            require_lowercase INTEGER DEFAULT 1,
            require_numbers INTEGER DEFAULT 1,
            require_special_chars INTEGER DEFAULT 1,
            history_count INTEGER DEFAULT 5,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create password_policy_settings table', { error: err.message });
            reject(err);
          }
        });

        // User password history
        db.run(`
          CREATE TABLE IF NOT EXISTS password_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create password_history table', { error: err.message });
            reject(err);
          }
        });

        // User password expiration tracking
        db.run(`
          CREATE TABLE IF NOT EXISTS user_password_expiry (
            user_id TEXT PRIMARY KEY,
            last_changed DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            force_change INTEGER DEFAULT 0,
            change_required_at DATETIME,
            notification_sent INTEGER DEFAULT 0
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create user_password_expiry table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_password_history_user_id 
          ON password_history(user_id, changed_at DESC)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            logger.info('Password policy schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Get global password policy settings
   */
  async getPolicySettings() {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.get(
        `SELECT * FROM password_policy_settings WHERE id = 1`,
        (err, row) => {
          if (err) {
            logger.error('Failed to get password policy settings', { error: err.message });
            reject(err);
          } else {
            resolve(row || this.getDefaultSettings());
          }
        }
      );
    });
  }

  /**
   * Get default policy settings
   */
  getDefaultSettings() {
    return {
      id: 1,
      expiration_days: 90,
      min_length: 8,
      require_uppercase: 1,
      require_lowercase: 1,
      require_numbers: 1,
      require_special_chars: 1,
      history_count: 5
    };
  }

  /**
   * Update global password policy settings
   */
  async updatePolicySettings(settings) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const {
        expiration_days,
        min_length,
        require_uppercase,
        require_lowercase,
        require_numbers,
        require_special_chars,
        history_count
      } = settings;

      db.run(
        `INSERT OR REPLACE INTO password_policy_settings 
         (id, expiration_days, min_length, require_uppercase, require_lowercase, 
          require_numbers, require_special_chars, history_count, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          expiration_days,
          min_length,
          require_uppercase ? 1 : 0,
          require_lowercase ? 1 : 0,
          require_numbers ? 1 : 0,
          require_special_chars ? 1 : 0,
          history_count
        ],
        (err) => {
          if (err) {
            logger.error('Failed to update password policy settings', { error: err.message });
            reject(err);
          } else {
            logger.info('Password policy settings updated');
            resolve();
          }
        }
      );
    });
  }

  /**
   * Validate password against policy
   */
  async validatePassword(password, userId = null) {
    const policy = await this.getPolicySettings();
    const errors = [];

    // Check minimum length
    if (password.length < policy.min_length) {
      errors.push(`Password must be at least ${policy.min_length} characters`);
    }

    // Check uppercase requirement
    if (policy.require_uppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    // Check lowercase requirement
    if (policy.require_lowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    // Check numbers requirement
    if (policy.require_numbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check special characters requirement
    if (policy.require_special_chars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check password history (if user specified)
    if (userId) {
      const isReused = await this.isPasswordReused(userId, password, policy.history_count);
      if (isReused) {
        errors.push(`Password cannot be one of the last ${policy.history_count} passwords`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if password was recently used
   */
  async isPasswordReused(userId, passwordHash, historyCount) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.get(
        `SELECT COUNT(*) as count FROM password_history 
         WHERE user_id = ? AND password_hash = ?
         ORDER BY changed_at DESC LIMIT ?`,
        [userId, passwordHash, historyCount],
        (err, row) => {
          if (err) {
            logger.error('Failed to check password history', { error: err.message });
            reject(err);
          } else {
            resolve((row?.count || 0) > 0);
          }
        }
      );
    });
  }

  /**
   * Record password change
   */
  async recordPasswordChange(userId, passwordHash) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const expirationDays = 90; // Default, should be from policy

      db.serialize(() => {
        // Add to history
        db.run(
          `INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)`,
          [userId, passwordHash],
          (err) => {
            if (err) {
              logger.error('Failed to record password change', { error: err.message });
              reject(err);
            }
          }
        );

        // Update expiry
        const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString();
        db.run(
          `INSERT OR REPLACE INTO user_password_expiry 
           (user_id, last_changed, expires_at, force_change, notification_sent)
           VALUES (?, CURRENT_TIMESTAMP, ?, 0, 0)`,
          [userId, expiresAt],
          (err) => {
            if (err) {
              logger.error('Failed to update password expiry', { error: err.message });
              reject(err);
            } else {
              logger.info('Password change recorded', { userId });
              resolve();
            }
          }
        );
      });
    });
  }

  /**
   * Get user's password expiry info
   */
  async getUserPasswordExpiry(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.get(
        `SELECT * FROM user_password_expiry WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get password expiry', { error: err.message });
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Check if user's password is expired
   */
  async isPasswordExpired(userId) {
    const expiry = await this.getUserPasswordExpiry(userId);
    if (!expiry) return false;

    const now = new Date();
    const expiresAt = new Date(expiry.expires_at);
    return now > expiresAt;
  }

  /**
   * Get days until password expires
   */
  async getDaysUntilExpiry(userId) {
    const expiry = await this.getUserPasswordExpiry(userId);
    if (!expiry) return null;

    const now = new Date();
    const expiresAt = new Date(expiry.expires_at);
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysLeft);
  }

  /**
   * Force password change for user
   */
  async forcePasswordChange(userId, reason = 'Admin required') {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.run(
        `INSERT OR REPLACE INTO user_password_expiry 
         (user_id, force_change, change_required_at)
         VALUES (?, 1, CURRENT_TIMESTAMP)`,
        [userId],
        (err) => {
          if (err) {
            logger.error('Failed to force password change', { error: err.message });
            reject(err);
          } else {
            logger.info('Password change forced', { userId, reason });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get users with expired passwords
   */
  async getExpiredPasswordUsers(limit = 50) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.all(
        `SELECT user_id, expires_at, force_change 
         FROM user_password_expiry 
         WHERE expires_at < CURRENT_TIMESTAMP OR force_change = 1
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get expired password users', { error: err.message });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Send expiry notifications
   */
  async sendExpiryNotifications(daysBeforeExpiry = 7) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const cutoffDate = new Date(Date.now() + daysBeforeExpiry * 24 * 60 * 60 * 1000).toISOString();

      db.all(
        `SELECT user_id, expires_at 
         FROM user_password_expiry 
         WHERE expires_at <= ? AND expires_at > CURRENT_TIMESTAMP 
         AND notification_sent = 0`,
        [cutoffDate],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get users for notification', { error: err.message });
            reject(err);
          } else {
            // Mark as notified
            rows?.forEach(row => {
              db.run(
                `UPDATE user_password_expiry SET notification_sent = 1 WHERE user_id = ?`,
                [row.user_id]
              );
            });

            logger.info('Password expiry notifications sent', { count: rows?.length || 0 });
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get password history for user
   */
  async getPasswordHistory(userId, limit = 10) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.all(
        `SELECT id, changed_at FROM password_history 
         WHERE user_id = ? 
         ORDER BY changed_at DESC 
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get password history', { error: err.message });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Cleanup old password history
   */
  async cleanupPasswordHistory(daysOld = 365) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

      db.run(
        `DELETE FROM password_history WHERE changed_at < ?`,
        [cutoffDate],
        function(err) {
          if (err) {
            logger.error('Failed to cleanup password history', { error: err.message });
            reject(err);
          } else {
            logger.info('Password history cleaned up', { deletedCount: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = PasswordPolicyManager;
