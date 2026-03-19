/**
 * Password Reset Manager
 * Manages password reset tokens and processes password reset requests
 */

const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');
const NotificationManager = require('./NotificationManager');

class PasswordResetManager {
  static instance = null;

  static getInstance() {
    if (!PasswordResetManager.instance) {
      PasswordResetManager.instance = new PasswordResetManager();
      PasswordResetManager.instance.initializeSchema();
    }
    return PasswordResetManager.instance;
  }

  /**
   * Initialize password reset tokens table
   */
  async initializeSchema() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          token TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          used INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) {
          logger.error('Failed to create password_reset_tokens table:', err.message);
          reject(err);
        } else {
          // Create index for token lookups
          DatabaseManager.db.run(`
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token 
            ON password_reset_tokens(token)
          `, (indexErr) => {
            if (indexErr) logger.warn('Index creation warning:', indexErr.message);
            logger.info('Password reset schema initialized');
            resolve();
          });
        }
      });
    });
  }

  /**
   * Generate a password reset token for a user
   * @param {string} userId - Jellyfin user ID
   * @param {string} email - User email address
   * @returns {Promise<string>} The reset token
   */
  async generateResetToken(userId, email) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `INSERT INTO password_reset_tokens (user_id, email, token, expires_at)
         VALUES (?, ?, ?, ?)`,
        [userId, email.toLowerCase(), token, expiresAt],
        (err) => {
          if (err) {
            logger.error('Failed to generate reset token:', err.message);
            reject(err);
          } else {
            logger.info(`Password reset token generated for user ${userId}`);
            resolve(token);
          }
        }
      );
    });
  }

  /**
   * Validate and consume a password reset token
   * @param {string} token - The reset token
   * @returns {Promise<Object>} Token data if valid, null otherwise
   */
  async validateToken(token) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.get(
        `SELECT * FROM password_reset_tokens 
         WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
        [token],
        (err, row) => {
          if (err) {
            logger.error('Token validation error:', err.message);
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Mark a token as used
   * @param {string} token - The token to mark as used
   */
  async markTokenAsUsed(token) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `UPDATE password_reset_tokens SET used = 1 WHERE token = ?`,
        [token],
        (err) => {
          if (err) {
            logger.error('Failed to mark token as used:', err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Clean up expired tokens (call periodically)
   */
  async cleanupExpiredTokens() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `DELETE FROM password_reset_tokens WHERE expires_at < datetime('now')`,
        [],
        (err) => {
          if (err) {
            logger.warn('Failed to cleanup expired tokens:', err.message);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Send password reset email to user
   * @param {string} userId - Jellyfin user ID
   * @param {string} email - User email
   * @param {string} resetLink - The password reset link
   */
  async sendResetEmail(userId, email, resetLink) {
    try {
      const notificationManager = NotificationManager.getInstance();
      
      const message = `
        <p>Hello,</p>
        <p>You requested a password reset for your JellySSO account.</p>
        <p><a href="${resetLink}" style="background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
        <p><strong>This link expires in 1 hour.</strong></p>
        <p>If you did not request this password reset, you can ignore this email.</p>
        <p>Do not share this link with anyone.</p>
      `;

      await notificationManager.sendEmail(
        email,
        'Password Reset Request',
        message,
        { resetLink }
      );

      logger.info(`Password reset email sent to ${email}`);
    } catch (err) {
      logger.error(`Failed to send reset email to ${email}:`, err.message);
      throw err;
    }
  }
}

module.exports = PasswordResetManager;
