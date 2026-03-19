const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');
const NotificationManager = require('./NotificationManager');

/**
 * UserExpiryManager - Manages user account expiry and lifecycle
 * Tracks expiry dates, sends warnings, auto-disables expired users
 */
class UserExpiryManager {
  static instance = null;
  static expiryCheckInterval = null;

  constructor() {
    this.db = DatabaseManager.db;
    this.logger = AuditLogger.getInstance();
    this.notificationManager = NotificationManager.getInstance();
    this.initializeTables();
    this.startExpiryCheckDaemon();
  }

  static getInstance() {
    if (!UserExpiryManager.instance) {
      UserExpiryManager.instance = new UserExpiryManager();
    }
    return UserExpiryManager.instance;
  }

  /**
   * Initialize expiry-related tables
   */
  initializeTables() {
    try {
      // Add expiresAt column to users table
      this.db.run(
        `ALTER TABLE users ADD COLUMN expiresAt DATETIME`,
        (err) => {
          // Ignore if column already exists
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding expiresAt column:', err);
          }
        }
      );

      // Create lifecycle events table for tracking
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_lifecycle_events (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          eventType TEXT,
          eventDate DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata JSON,
          FOREIGN KEY (userId) REFERENCES users(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error('Error creating lifecycle events table:', err);
        }
      });

      // Index for faster lookups
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expiresAt)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            console.error('Error creating expiry index:', err);
          }
        }
      );

      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_lifecycle_user_event ON user_lifecycle_events(userId, eventType)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            console.error('Error creating lifecycle index:', err);
          }
        }
      );
    } catch (error) {
      console.error('UserExpiryManager initialization error:', error);
    }
  }

  /**
   * Set expiry date for a user
   * @param {string} userId - User ID
   * @param {Date} expiresAt - Expiry date
   * @param {string} reason - Reason for expiry (e.g., 'invite', 'manual_admin')
   * @returns {Promise<boolean>} Success
   */
  async setUserExpiry(userId, expiresAt, reason = 'manual_admin') {
    return new Promise((resolve, reject) => {
      try {
        // Validate date
        if (!(expiresAt instanceof Date) && typeof expiresAt === 'string') {
          expiresAt = new Date(expiresAt);
        }

        if (!(expiresAt instanceof Date)) {
          return reject(new Error('Invalid expiry date'));
        }

        const isoDate = expiresAt.toISOString();

        this.db.run(
          'UPDATE users SET expiresAt = ? WHERE id = ?',
          [isoDate, userId],
          (err) => {
            if (err) {
              this.logger.log('error', 'USER_EXPIRY_SET_ERROR', { userId, error: err.message });
              return reject(new Error('Failed to set user expiry'));
            }

            // Log lifecycle event
            this.logLifecycleEvent(userId, 'expiry_set', { expiresAt: isoDate, reason });

            this.logger.log('info', 'USER_EXPIRY_SET', { userId, expiresAt: isoDate, reason });
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Clear expiry date for a user
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async clearUserExpiry(userId) {
    return new Promise((resolve, reject) => {
      try {
        this.db.run(
          'UPDATE users SET expiresAt = NULL WHERE id = ?',
          [userId],
          (err) => {
            if (err) {
              this.logger.log('error', 'USER_EXPIRY_CLEAR_ERROR', { userId, error: err.message });
              return reject(new Error('Failed to clear user expiry'));
            }

            this.logLifecycleEvent(userId, 'expiry_cleared', {});
            this.logger.log('info', 'USER_EXPIRY_CLEARED', { userId });
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get user expiry date
   * @param {string} userId - User ID
   * @returns {Promise<Date|null>} Expiry date or null
   */
  async getUserExpiry(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT expiresAt FROM users WHERE id = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? (row.expiresAt ? new Date(row.expiresAt) : null) : null);
        }
      );
    });
  }

  /**
   * Get users expiring within N days
   * @param {number} days - Number of days to check
   * @returns {Promise<Array>} Array of users
   */
  async getUsersExpiringWithin(days = 7) {
    return new Promise((resolve, reject) => {
      try {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + days);

        this.db.all(
          `SELECT id, username, email, expiresAt FROM users 
           WHERE expiresAt IS NOT NULL 
           AND expiresAt > datetime('now') 
           AND expiresAt <= ?
           AND enabled = 1
           ORDER BY expiresAt ASC`,
          [futureDate.toISOString()],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get expired users (already past expiry date)
   * @returns {Promise<Array>} Array of expired users
   */
  async getExpiredUsers() {
    return new Promise((resolve, reject) => {
      try {
        this.db.all(
          `SELECT id, username, email, expiresAt FROM users 
           WHERE expiresAt IS NOT NULL 
           AND expiresAt <= datetime('now')
           AND enabled = 1
           ORDER BY expiresAt ASC`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send expiry warning notifications (called daily)
   * Sends warnings to users expiring in 7 days
   * @returns {Promise<number>} Number of notifications sent
   */
  async sendExpiryWarnings() {
    try {
      const expiringUsers = await this.getUsersExpiringWithin(7);
      let notificationsSent = 0;

      for (const user of expiringUsers) {
        try {
          const daysLeft = await this.calculateDaysUntilExpiry(user.id);

          // Check if we've already warned about this expiry
          const lastEvent = await this.getLastLifecycleEvent(user.id, 'expiry_warning');
          const today = new Date().toDateString();
          const lastWarningDate = lastEvent ? new Date(lastEvent.eventDate).toDateString() : null;

          if (lastWarningDate !== today) {
            // Send warning notification
            await this.notificationManager.queueNotification({
              type: 'USER_EXPIRES_SOON',
              userId: user.id,
              recipientEmail: user.email,
              daysRemaining: daysLeft,
              expiresAt: user.expiresAt
            });

            // Log this warning
            this.logLifecycleEvent(user.id, 'expiry_warning', { daysRemaining: daysLeft });
            notificationsSent++;
          }
        } catch (error) {
          this.logger.log('error', 'EXPIRY_WARNING_ERROR', { userId: user.id, error: error.message });
        }
      }

      if (notificationsSent > 0) {
        this.logger.log('info', 'EXPIRY_WARNINGS_SENT', { count: notificationsSent });
      }

      return notificationsSent;
    } catch (error) {
      this.logger.log('error', 'EXPIRY_WARNING_BATCH_ERROR', { error: error.message });
      throw error;
    }
  }

  /**
   * Disable all expired users (called daily)
   * @returns {Promise<number>} Number of users disabled
   */
  async disableExpiredUsers() {
    try {
      const expiredUsers = await this.getExpiredUsers();
      let usersDisabled = 0;

      for (const user of expiredUsers) {
        try {
          // Get current user data
          const userData = await new Promise((resolve, reject) => {
            this.db.get(
              'SELECT id, enabled FROM users WHERE id = ?',
              [user.id],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          });

          // Only disable if still enabled
          if (userData && userData.enabled) {
            await this.disableUserAccount(user.id, 'expired');
            usersDisabled++;
          }
        } catch (error) {
          this.logger.log('error', 'EXPIRY_DISABLE_ERROR', { userId: user.id, error: error.message });
        }
      }

      if (usersDisabled > 0) {
        this.logger.log('info', 'EXPIRED_USERS_DISABLED', { count: usersDisabled });
      }

      return usersDisabled;
    } catch (error) {
      this.logger.log('error', 'EXPIRY_DISABLE_BATCH_ERROR', { error: error.message });
      throw error;
    }
  }

  /**
   * Disable a user account
   * @param {string} userId - User ID
   * @param {string} reason - Reason for disabling
   * @returns {Promise<boolean>} Success
   */
  async disableUserAccount(userId, reason = 'manual') {
    return new Promise((resolve, reject) => {
      try {
        this.db.run(
          'UPDATE users SET enabled = 0 WHERE id = ?',
          [userId],
          (err) => {
            if (err) {
              this.logger.log('error', 'USER_DISABLE_ERROR', { userId, error: err.message });
              return reject(new Error('Failed to disable user'));
            }

            this.logLifecycleEvent(userId, 'user_disabled', { reason });
            this.logger.log('info', 'USER_DISABLED', { userId, reason });
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Bulk cleanup old disabled users (optional admin tool)
   * @param {number} olderThanDays - Delete disabled users disabled more than X days ago
   * @returns {Promise<number>} Number of users deleted
   */
  async bulkCleanupDisabledUsers(olderThanDays = 90) {
    return new Promise((resolve, reject) => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        this.db.run(
          `DELETE FROM users 
           WHERE enabled = 0 
           AND createdAt < ?
           AND NOT EXISTS (
             SELECT 1 FROM invites WHERE invites.acceptedBy = users.id
           )`,
          [cutoffDate.toISOString()],
          function (err) {
            if (err) {
              this.logger.log('error', 'CLEANUP_ERROR', { error: err.message });
              return reject(new Error('Failed to cleanup users'));
            }

            const deletedCount = this.changes;
            if (deletedCount > 0) {
              this.logger.log('info', 'USERS_CLEANUP_COMPLETE', { deletedCount, olderThanDays });
            }
            resolve(deletedCount);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Calculate days remaining until user expiry
   * @param {string} userId - User ID
   * @returns {Promise<number>} Days remaining (negative if expired)
   */
  async calculateDaysUntilExpiry(userId) {
    try {
      const expiryDate = await this.getUserExpiry(userId);
      if (!expiryDate) return null;

      const now = new Date();
      const diff = expiryDate.getTime() - now.getTime();
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    } catch (error) {
      throw error;
    }
  }

  /**
   * Log a lifecycle event
   * @param {string} userId - User ID
   * @param {string} eventType - Type of event
   * @param {Object} metadata - Event metadata
   */
  logLifecycleEvent(userId, eventType, metadata = {}) {
    try {
      const id = crypto.randomBytes(16).toString('hex');
      this.db.run(
        'INSERT INTO user_lifecycle_events (id, userId, eventType, metadata) VALUES (?, ?, ?, ?)',
        [id, userId, eventType, JSON.stringify(metadata)]
      );
    } catch (error) {
      console.error('Error logging lifecycle event:', error);
    }
  }

  /**
   * Get last lifecycle event of a type for a user
   * @param {string} userId - User ID
   * @param {string} eventType - Event type to find
   * @returns {Promise<Object|null>} Last event or null
   */
  async getLastLifecycleEvent(userId, eventType) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM user_lifecycle_events 
         WHERE userId = ? AND eventType = ?
         ORDER BY eventDate DESC LIMIT 1`,
        [userId, eventType],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get lifecycle history for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of lifecycle events
   */
  async getUserLifecycleHistory(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM user_lifecycle_events 
         WHERE userId = ?
         ORDER BY eventDate DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Get expiry statistics
   * @returns {Promise<Object>} Stats object
   */
  async getExpiryStats() {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          `SELECT
             COUNT(*) as totalWithExpiry,
             SUM(CASE WHEN expiresAt > datetime('now') THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN expiresAt <= datetime('now') THEN 1 ELSE 0 END) as expired,
             SUM(CASE WHEN expiresAt <= datetime('now', '+7 days') AND expiresAt > datetime('now') THEN 1 ELSE 0 END) as expiringWithin7Days
           FROM users
           WHERE expiresAt IS NOT NULL`,
          [],
          (err, stats) => {
            if (err) reject(err);
            else resolve(stats || { totalWithExpiry: 0, active: 0, expired: 0, expiringWithin7Days: 0 });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Start background daemon to check expiry daily
   */
  startExpiryCheckDaemon() {
    try {
      // Run checks once on startup (after small delay)
      setTimeout(() => {
        this.runExpiryChecks();
      }, 5000);

      // Then run daily (at midnight)
      UserExpiryManager.expiryCheckInterval = setInterval(() => {
        const now = new Date();
        const nextMidnight = new Date(now);
        nextMidnight.setHours(24, 0, 0, 0);
        const msUntilMidnight = nextMidnight.getTime() - now.getTime();

        // Schedule for midnight
        setTimeout(() => {
          this.runExpiryChecks();
          // Then repeat daily
          UserExpiryManager.expiryCheckInterval = setInterval(() => {
            this.runExpiryChecks();
          }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
      }, 24 * 60 * 60 * 1000);
    } catch (error) {
      console.error('Error starting expiry check daemon:', error);
    }
  }

  /**
   * Run all expiry checks
   */
  async runExpiryChecks() {
    try {
      this.logger.log('info', 'EXPIRY_CHECKS_RUNNING', {});

      // Send warnings
      await this.sendExpiryWarnings();

      // Disable expired users
      await this.disableExpiredUsers();

      this.logger.log('info', 'EXPIRY_CHECKS_COMPLETE', {});
    } catch (error) {
      this.logger.log('error', 'EXPIRY_CHECKS_ERROR', { error: error.message });
    }
  }

  /**
   * Stop the expiry check daemon
   */
  static stopDaemon() {
    if (UserExpiryManager.expiryCheckInterval) {
      clearInterval(UserExpiryManager.expiryCheckInterval);
      UserExpiryManager.expiryCheckInterval = null;
    }
  }
}

module.exports = UserExpiryManager;
