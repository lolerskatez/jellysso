const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');

/**
 * ContactMethodManager - Manages multi-channel contact methods for users
 * Supports: Email, Discord, Telegram, Matrix
 * Handles verification, preferences, and channel management
 */
class ContactMethodManager {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.getInstance().db;
    this.logger = AuditLogger;
    this.verificationTimeout = 24 * 60 * 60 * 1000; // 24 hours
    this.maxVerificationAttempts = 5;
  }

  static getInstance() {
    if (!ContactMethodManager.instance) {
      ContactMethodManager.instance = new ContactMethodManager();
    }
    return ContactMethodManager.instance;
  }

  /**
   * Get all contact methods for a user
   * @param {string} userId - Jellyfin user ID
   * @returns {Promise<Object>} Contact methods object
   */
  async getContactMethods(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
          email_enabled, discord_enabled, discord_user_id, discord_verified,
          telegram_enabled, telegram_chat_id, telegram_verified,
          matrix_enabled, matrix_user_id, matrix_verified
        FROM user_notification_preferences 
        WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            this.logger.log('error', 'GET_CONTACT_METHODS_ERROR', {
              userId,
              error: err.message
            });
            return reject(err);
          }

          if (!row) {
            // Return defaults if no preferences exist yet
            return resolve({
              email_enabled: true,
              discord_enabled: false,
              discord_user_id: null,
              discord_verified: false,
              telegram_enabled: false,
              telegram_chat_id: null,
              telegram_verified: false,
              matrix_enabled: false,
              matrix_user_id: null,
              matrix_verified: false
            });
          }

          resolve(row);
        }
      );
    });
  }

  /**
   * Get verified contact methods for a user
   * @param {string} userId - Jellyfin user ID
   * @returns {Promise<Array>} Array of verified channels (email, discord, telegram, matrix)
   */
  async getVerifiedMethods(userId) {
    try {
      const methods = await this.getContactMethods(userId);
      const verified = [];

      if (methods.email_enabled) verified.push('email');
      if (methods.discord_enabled && methods.discord_verified) verified.push('discord');
      if (methods.telegram_enabled && methods.telegram_verified) verified.push('telegram');
      if (methods.matrix_enabled && methods.matrix_verified) verified.push('matrix');

      return verified;
    } catch (error) {
      this.logger.log('error', 'GET_VERIFIED_METHODS_ERROR', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Add or update Discord contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} discordUserId - Discord user ID
   * @returns {Promise<Object>} Updated preferences
   */
  async addDiscordMethod(userId, discordUserId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET discord_user_id = ?, discord_enabled = 1, discord_verified = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [discordUserId, userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'ADD_DISCORD_ERROR', { userId, discordUserId, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'DISCORD_ADDED', { userId, discordUserId });
          resolve({ method: 'discord', discordUserId, verified: false });
        }
      );
    });
  }

  /**
   * Add or update Telegram contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} telegramChatId - Telegram chat ID
   * @returns {Promise<Object>} Updated preferences
   */
  async addTelegramMethod(userId, telegramChatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET telegram_chat_id = ?, telegram_enabled = 1, telegram_verified = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [telegramChatId, userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'ADD_TELEGRAM_ERROR', { userId, telegramChatId, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'TELEGRAM_ADDED', { userId, telegramChatId });
          resolve({ method: 'telegram', telegramChatId, verified: false });
        }
      );
    });
  }

  /**
   * Add or update Matrix contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} matrixUserId - Matrix user ID
   * @returns {Promise<Object>} Updated preferences
   */
  async addMatrixMethod(userId, matrixUserId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET matrix_user_id = ?, matrix_enabled = 1, matrix_verified = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [matrixUserId, userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'ADD_MATRIX_ERROR', { userId, matrixUserId, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'MATRIX_ADDED', { userId, matrixUserId });
          resolve({ method: 'matrix', matrixUserId, verified: false });
        }
      );
    });
  }

  /**
   * Verify a contact method (mark as verified)
   * @param {string} userId - Jellyfin user ID
   * @param {string} method - Contact method (discord, telegram, matrix)
   * @returns {Promise<Object>} Updated preferences
   */
  async verifyMethod(userId, method) {
    const methodUpper = method.toLowerCase();
    const verifiedField = `${methodUpper}_verified`;
    const enabledField = `${methodUpper}_enabled`;

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET ${verifiedField} = 1, ${enabledField} = 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'VERIFY_METHOD_ERROR', { userId, method, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'METHOD_VERIFIED', { userId, method });
          resolve({ method, verified: true });
        }
      );
    });
  }

  /**
   * Remove a contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} method - Contact method to remove
   * @returns {Promise<void>}
   */
  async removeMethod(userId, method) {
    const methodLower = method.toLowerCase();
    const idField = methodLower === 'discord' ? 'discord_user_id' :
                    methodLower === 'telegram' ? 'telegram_chat_id' :
                    methodLower === 'matrix' ? 'matrix_user_id' : null;

    if (!idField) {
      throw new Error(`Unknown contact method: ${method}`);
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET ${idField} = NULL, ${methodLower}_enabled = 0, ${methodLower}_verified = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'REMOVE_METHOD_ERROR', { userId, method, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'METHOD_REMOVED', { userId, method });
          resolve();
        }
      );
    });
  }

  /**
   * Enable/disable a contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} method - Contact method
   * @param {boolean} enabled - Enable or disable
   * @returns {Promise<void>}
   */
  async setMethodEnabled(userId, method, enabled) {
    const methodLower = method.toLowerCase();
    const enabledField = `${methodLower}_enabled`;

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE user_notification_preferences 
        SET ${enabledField} = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`,
        [enabled ? 1 : 0, userId],
        function (err) {
          if (err) {
            this.logger.log('error', 'SET_METHOD_ENABLED_ERROR', { userId, method, enabled, error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'METHOD_TOGGLED', { userId, method, enabled });
          resolve();
        }
      );
    });
  }

  /**
   * Generate verification code for contact method
   * Used during signup or when adding a new contact method
   * @param {string} userId - Jellyfin user ID
   * @param {string} method - Contact method (discord, telegram, matrix)
   * @returns {string} Verification code (6 digits)
   */
  generateVerificationCode() {
    // 6-digit code for easy manual entry if needed
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create verification request for contact method
   * Stores it in a temporary verification table
   * @param {string} userId - Jellyfin user ID
   * @param {string} method - Contact method
   * @param {string} contactId - Discord ID, Telegram Chat ID, or Matrix ID
   * @returns {Promise<Object>} Verification request with code
   */
  async createVerificationRequest(userId, method, contactId) {
    const code = this.generateVerificationCode();
    const verificationId = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + this.verificationTimeout);

    return new Promise((resolve, reject) => {
      // Check if contact_verifications table exists, if not create it
      this.db.run(`
        CREATE TABLE IF NOT EXISTS contact_verifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          method TEXT NOT NULL,
          contact_id TEXT NOT NULL,
          code TEXT NOT NULL,
          attempts INTEGER DEFAULT 0,
          expires_at DATETIME NOT NULL,
          verified_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `, (tableErr) => {
        if (tableErr && !tableErr.message.includes('already exists')) {
          this.logger.log('error', 'CREATE_VERIFICATION_TABLE_ERROR', { error: tableErr.message });
          return reject(tableErr);
        }

        // Insert verification request
        this.db.run(
          `INSERT INTO contact_verifications (id, user_id, method, contact_id, code, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [verificationId, userId, method, contactId, code, expiresAt],
          function (err) {
            if (err) {
              this.logger.log('error', 'CREATE_VERIFICATION_ERROR', {
                userId,
                method,
                error: err.message
              });
              return reject(err);
            }

            this.logger.log('info', 'VERIFICATION_CREATED', { userId, method, verificationId });
            resolve({
              id: verificationId,
              code,
              method,
              contactId,
              expiresAt
            });
          }
        );
      });
    });
  }

  /**
   * Verify a contact method with code
   * @param {string} verificationId - Verification request ID
   * @param {string} code - Verification code (6 digits)
   * @returns {Promise<Object>} Verification result with user and method info
   */
  async verifyWithCode(verificationId, code) {
    return new Promise((resolve, reject) => {
      // Get verification request
      this.db.get(
        `SELECT * FROM contact_verifications 
         WHERE id = ? AND expires_at > CURRENT_TIMESTAMP AND verified_at IS NULL`,
        [verificationId],
        (err, verification) => {
          if (err) {
            this.logger.log('error', 'VERIFY_GET_ERROR', {
              verificationId,
              error: err.message
            });
            return reject(err);
          }

          if (!verification) {
            this.logger.log('warn', 'VERIFY_EXPIRED', { verificationId });
            return reject(new Error('Verification request expired or already used'));
          }

          if (verification.attempts >= this.maxVerificationAttempts) {
            this.logger.log('warn', 'VERIFY_TOO_MANY_ATTEMPTS', { verificationId });
            return reject(new Error('Too many verification attempts'));
          }

          if (verification.code !== code) {
            // Increment attempts
            this.db.run(
              `UPDATE contact_verifications SET attempts = attempts + 1 WHERE id = ?`,
              [verificationId],
              () => {
                this.logger.log('warn', 'VERIFY_WRONG_CODE', { verificationId, userId: verification.user_id });
                reject(new Error('Invalid verification code'));
              }
            );
            return;
          }

          // Mark as verified
          this.db.run(
            `UPDATE contact_verifications SET verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [verificationId],
            (updateErr) => {
              if (updateErr) {
                this.logger.log('error', 'VERIFY_UPDATE_ERROR', {
                  verificationId,
                  error: updateErr.message
                });
                return reject(updateErr);
              }

              // Mark the contact method as verified in preferences
              this.verifyMethod(verification.user_id, verification.method)
                .then(() => {
                  this.logger.log('info', 'VERIFY_SUCCESS', {
                    userId: verification.user_id,
                    method: verification.method
                  });
                  resolve({
                    success: true,
                    userId: verification.user_id,
                    method: verification.method,
                    contactId: verification.contact_id
                  });
                })
                .catch((verifyErr) => {
                  this.logger.log('error', 'VERIFY_METHOD_FAILED', {
                    verificationId,
                    error: verifyErr.message
                  });
                  reject(verifyErr);
                });
            }
          );
        }
      );
    });
  }

  /**
   * Get verification request details
   * @param {string} verificationId - Verification request ID
   * @returns {Promise<Object>} Verification request details
   */
  async getVerificationRequest(verificationId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM contact_verifications WHERE id = ?`,
        [verificationId],
        (err, row) => {
          if (err) {
            this.logger.log('error', 'GET_VERIFICATION_ERROR', {
              verificationId,
              error: err.message
            });
            return reject(err);
          }

          if (!row) {
            return reject(new Error('Verification request not found'));
          }

          resolve({
            id: row.id,
            userId: row.user_id,
            method: row.method,
            contactId: row.contact_id,
            attempts: row.attempts,
            maxAttempts: this.maxVerificationAttempts,
            expiresAt: row.expires_at,
            verified: !!row.verified_at,
            createdAt: row.created_at
          });
        }
      );
    });
  }

  /**
   * Clean up expired verification requests
   * @returns {Promise<number>} Number of deleted requests
   */
  async cleanupExpiredVerifications() {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM contact_verifications 
         WHERE expires_at < CURRENT_TIMESTAMP AND verified_at IS NULL`,
        function (err) {
          if (err) {
            this.logger.log('error', 'CLEANUP_VERIFICATIONS_ERROR', { error: err.message });
            return reject(err);
          }

          this.logger.log('info', 'CLEANUP_VERIFICATIONS', { deleted: this.changes });
          resolve(this.changes);
        }
      );
    });
  }
}

module.exports = ContactMethodManager;
