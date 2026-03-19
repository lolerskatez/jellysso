/**
 * Security Alert Manager
 * Manages security alerts and notifications for suspicious activities
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class SecurityAlertManager {
  static instance = null;

  static getInstance() {
    if (!SecurityAlertManager.instance) {
      SecurityAlertManager.instance = new SecurityAlertManager();
      SecurityAlertManager.instance.initializeSchema();
    }
    return SecurityAlertManager.instance;
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const db = DatabaseManager.db;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Security alerts table
        db.run(`
          CREATE TABLE IF NOT EXISTS security_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            metadata TEXT,
            ip_address TEXT,
            user_agent TEXT,
            read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create security_alerts table', { error: err.message });
            reject(err);
          }
        });

        // Alert preferences table
        db.run(`
          CREATE TABLE IF NOT EXISTS alert_preferences (
            user_id TEXT PRIMARY KEY,
            email_alerts INTEGER DEFAULT 1,
            failed_login_alerts INTEGER DEFAULT 1,
            new_device_alerts INTEGER DEFAULT 1,
            policy_change_alerts INTEGER DEFAULT 1,
            password_change_alerts INTEGER DEFAULT 1,
            account_locked_alerts INTEGER DEFAULT 1,
            suspicious_activity_alerts INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create alert_preferences table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_security_alerts_user_id ON security_alerts(user_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_security_alerts_type ON security_alerts(alert_type)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_security_alerts_created ON security_alerts(created_at)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            logger.info('Security alert schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Create security alert
   */
  async createAlert(userId, alertType, severity, title, message, metadata = {}, ip = null, userAgent = null) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const metadataJson = JSON.stringify(metadata);

      db.run(
        `INSERT INTO security_alerts (user_id, alert_type, severity, title, message, metadata, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, alertType, severity, title, message, metadataJson, ip, userAgent],
        async (err) => {
          if (err) {
            logger.error('Failed to create security alert', { error: err.message, userId, alertType });
            reject(err);
          } else {
            logger.info('Security alert created', { userId, alertType, severity });
            
            // Send notification if enabled
            await this.sendNotification(userId, alertType, title, message);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Alert types
   */
  static ALERT_TYPES = {
    FAILED_LOGIN: 'failed_login',
    NEW_DEVICE: 'new_device',
    POLICY_CHANGE: 'policy_change',
    PASSWORD_CHANGE: 'password_change',
    ACCOUNT_LOCKED: 'account_locked',
    SUSPICIOUS_ACTIVITY: 'suspicious_activity',
    PERMISSION_CHANGE: 'permission_change',
    API_KEY_CREATED: 'api_key_created',
    API_KEY_REVOKED: 'api_key_revoked'
  };

  /**
   * Alert severity levels
   */
  static SEVERITY = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
  };

  /**
   * Get user's alerts
   */
  async getUserAlerts(userId, limit = 50, offset = 0, unreadOnly = false) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const query = unreadOnly
        ? `SELECT id, alert_type, severity, title, message, metadata, ip_address, read, created_at 
           FROM security_alerts 
           WHERE user_id = ? AND read = 0
           ORDER BY created_at DESC 
           LIMIT ? OFFSET ?`
        : `SELECT id, alert_type, severity, title, message, metadata, ip_address, read, created_at 
           FROM security_alerts 
           WHERE user_id = ?
           ORDER BY created_at DESC 
           LIMIT ? OFFSET ?`;

      db.all(query, [userId, limit, offset], (err, rows) => {
        if (err) {
          logger.error('Failed to get user alerts', { error: err.message, userId });
          reject(err);
        } else {
          const alerts = (rows || []).map(row => ({
            ...row,
            metadata: JSON.parse(row.metadata || '{}')
          }));
          resolve(alerts);
        }
      });
    });
  }

  /**
   * Mark alert as read
   */
  async markAlertAsRead(alertId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.run(
        `UPDATE security_alerts SET read = 1 WHERE id = ?`,
        [alertId],
        (err) => {
          if (err) {
            logger.error('Failed to mark alert as read', { error: err.message, alertId });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Mark all alerts as read for user
   */
  async markAllAlertsAsRead(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.run(
        `UPDATE security_alerts SET read = 1 WHERE user_id = ?`,
        [userId],
        (err) => {
          if (err) {
            logger.error('Failed to mark all alerts as read', { error: err.message, userId });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get unread alert count
   */
  async getUnreadCount(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.get(
        `SELECT COUNT(*) as count FROM security_alerts WHERE user_id = ? AND read = 0`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get unread count', { error: err.message, userId });
            reject(err);
          } else {
            resolve(row?.count || 0);
          }
        }
      );
    });
  }

  /**
   * Get user's alert preferences
   */
  async getAlertPreferences(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.get(
        `SELECT * FROM alert_preferences WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get alert preferences', { error: err.message, userId });
            reject(err);
          } else {
            resolve(row || this.getDefaultPreferences());
          }
        }
      );
    });
  }

  /**
   * Get default alert preferences
   */
  getDefaultPreferences() {
    return {
      user_id: null,
      email_alerts: 1,
      failed_login_alerts: 1,
      new_device_alerts: 1,
      policy_change_alerts: 1,
      password_change_alerts: 1,
      account_locked_alerts: 1,
      suspicious_activity_alerts: 1
    };
  }

  /**
   * Update alert preferences
   */
  async updateAlertPreferences(userId, preferences) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const {
        email_alerts,
        failed_login_alerts,
        new_device_alerts,
        policy_change_alerts,
        password_change_alerts,
        account_locked_alerts,
        suspicious_activity_alerts
      } = preferences;

      db.run(
        `INSERT OR REPLACE INTO alert_preferences 
         (user_id, email_alerts, failed_login_alerts, new_device_alerts, policy_change_alerts, 
          password_change_alerts, account_locked_alerts, suspicious_activity_alerts, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          userId,
          email_alerts ? 1 : 0,
          failed_login_alerts ? 1 : 0,
          new_device_alerts ? 1 : 0,
          policy_change_alerts ? 1 : 0,
          password_change_alerts ? 1 : 0,
          account_locked_alerts ? 1 : 0,
          suspicious_activity_alerts ? 1 : 0
        ],
        (err) => {
          if (err) {
            logger.error('Failed to update alert preferences', { error: err.message, userId });
            reject(err);
          } else {
            logger.info('Alert preferences updated', { userId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Send notification (placeholder for email/webhook integration)
   */
  async sendNotification(userId, alertType, title, message) {
    try {
      const preferences = await this.getAlertPreferences(userId);
      
      // Check if this alert type is enabled
      const alertKey = `${alertType}_alerts`;
      if (!preferences[alertKey]) {
        return;
      }

      // Send email notification if enabled
      if (preferences.email_alerts) {
        await this.sendEmailNotification(userId, title, message);
      }

      // Trigger webhook event
      const WebhookManager = require('./WebhookManager');
      const webhookManager = WebhookManager.getInstance();
      await webhookManager.triggerEvent('security.alert', {
        alertType,
        title,
        message,
        timestamp: new Date().toISOString()
      }, userId);

      logger.info('Notification sent', { userId, alertType });
    } catch (error) {
      logger.error('Failed to send notification', { error: error.message, userId, alertType });
    }
  }

  /**
   * Send email notification (placeholder)
   */
  async sendEmailNotification(userId, title, message) {
    // TODO: Implement email notification
    // This would integrate with email service (SendGrid, AWS SES, etc.)
    logger.debug('Email notification queued', { userId, title });
  }

  /**
   * Detect suspicious activity
   */
  async detectSuspiciousActivity(userId, ip, userAgent) {
    try {
      // Check for multiple failed logins from different IPs
      const db = DatabaseManager.db;
      
      db.get(
        `SELECT COUNT(DISTINCT ip_address) as unique_ips 
         FROM login_attempts 
         WHERE username = (SELECT Name FROM users WHERE Id = ?) 
         AND success = 0 
         AND timestamp > datetime('now', '-1 hour')`,
        [userId],
        async (err, row) => {
          if (err) {
            logger.error('Failed to detect suspicious activity', { error: err.message });
            return;
          }

          if (row?.unique_ips > 3) {
            await this.createAlert(
              userId,
              SecurityAlertManager.ALERT_TYPES.SUSPICIOUS_ACTIVITY,
              SecurityAlertManager.SEVERITY.HIGH,
              'Suspicious Login Activity',
              `Multiple failed login attempts detected from different IP addresses`,
              { uniqueIps: row.unique_ips },
              ip,
              userAgent
            );
          }
        }
      );
    } catch (error) {
      logger.error('Error in suspicious activity detection', { error: error.message });
    }
  }

  /**
   * Get alerts by type
   */
  async getAlertsByType(alertType, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.all(
        `SELECT id, user_id, alert_type, severity, title, message, created_at 
         FROM security_alerts 
         WHERE alert_type = ?
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [alertType, limit, offset],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get alerts by type', { error: err.message, alertType });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get critical alerts
   */
  async getCriticalAlerts(limit = 50) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.all(
        `SELECT id, user_id, alert_type, severity, title, message, created_at 
         FROM security_alerts 
         WHERE severity IN ('critical', 'high')
         ORDER BY created_at DESC 
         LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get critical alerts', { error: err.message });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Cleanup old alerts
   */
  async cleanupOldAlerts(daysOld = 90) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

      db.run(
        `DELETE FROM security_alerts WHERE created_at < ? AND read = 1`,
        [cutoffDate],
        function(err) {
          if (err) {
            logger.error('Failed to cleanup old alerts', { error: err.message });
            reject(err);
          } else {
            logger.info('Old security alerts cleaned up', { deletedCount: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = SecurityAlertManager;
