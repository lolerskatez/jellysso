/**
 * Account Lockout Manager
 * Tracks failed login attempts and implements account lockout policies
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class AccountLockoutManager {
  constructor() {
    this.db = DatabaseManager.getInstance();
    this.initializeDatabase();
  }

  /**
   * Initialize the lockout tracking table
   */
  initializeDatabase() {
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          ip_address TEXT NOT NULL,
          success INTEGER NOT NULL DEFAULT 0,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          reason TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS account_lockouts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          unlock_at DATETIME NOT NULL,
          reason TEXT,
          attempts_count INTEGER DEFAULT 0
        )
      `);

      // Create indexes for faster queries
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_login_attempts_username_timestamp 
        ON login_attempts(username, timestamp)
      `);

      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_timestamp 
        ON login_attempts(ip_address, timestamp)
      `);

      logger.info('AccountLockoutManager database initialized');
    } catch (error) {
      logger.error('Failed to initialize AccountLockoutManager database', { error: error.message });
    }
  }

  /**
   * Record a login attempt
   * @param {string} username - Username attempting to login
   * @param {string} ip - IP address of the attempt
   * @param {boolean} success - Whether the attempt was successful
   * @param {string} reason - Reason for failure (if applicable)
   */
  async recordLoginAttempt(username, ip, success, reason = null) {
    try {
      return new Promise((resolve, reject) => {
        this.db.run(
          `INSERT INTO login_attempts (username, ip_address, success, reason) 
           VALUES (?, ?, ?, ?)`,
          [username, ip, success ? 1 : 0, reason],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });
    } catch (error) {
      logger.error('Failed to record login attempt', { username, ip, error: error.message });
      throw error;
    }
  }

  /**
   * Get failed login attempts for a username in the last N minutes
   * @param {string} username - Username to check
   * @param {number} minutes - Time window (default: 15 minutes)
   * @returns {Promise<number>} Number of failed attempts
   */
  async getFailedAttempts(username, minutes = 15) {
    try {
      return new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COUNT(*) as count FROM login_attempts 
           WHERE username = ? AND success = 0 
           AND timestamp > datetime('now', '-' || ? || ' minutes')`,
          [username, minutes],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
          }
        );
      });
    } catch (error) {
      logger.error('Failed to get failed attempts', { username, error: error.message });
      return 0;
    }
  }

  /**
   * Get failed login attempts from a specific IP in the last N minutes
   * @param {string} ip - IP address to check
   * @param {number} minutes - Time window (default: 15 minutes)
   * @returns {Promise<number>} Number of failed attempts
   */
  async getFailedAttemptsFromIp(ip, minutes = 15) {
    try {
      return new Promise((resolve, reject) => {
        this.db.get(
          `SELECT COUNT(*) as count FROM login_attempts 
           WHERE ip_address = ? AND success = 0 
           AND timestamp > datetime('now', '-' || ? || ' minutes')`,
          [ip, minutes],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
          }
        );
      });
    } catch (error) {
      logger.error('Failed to get failed attempts from IP', { ip, error: error.message });
      return 0;
    }
  }

  /**
   * Check if an account is locked
   * @param {string} username - Username to check
   * @returns {Promise<Object>} { locked: boolean, unlocksAt: Date|null, reason: string|null }
   */
  async isAccountLocked(username) {
    try {
      return new Promise((resolve, reject) => {
        this.db.get(
          `SELECT * FROM account_lockouts 
           WHERE username = ? AND unlock_at > datetime('now')`,
          [username],
          (err, row) => {
            if (err) {
              reject(err);
            } else if (row) {
              resolve({
                locked: true,
                unlocksAt: new Date(row.unlock_at),
                reason: row.reason,
                attemptsCount: row.attempts_count
              });
            } else {
              resolve({ locked: false, unlocksAt: null, reason: null });
            }
          }
        );
      });
    } catch (error) {
      logger.error('Failed to check account lock status', { username, error: error.message });
      return { locked: false, unlocksAt: null, reason: null };
    }
  }

  /**
   * Lock an account
   * @param {string} username - Username to lock
   * @param {number} durationMinutes - How long to lock (default: 15 minutes)
   * @param {string} reason - Reason for lockout
   * @param {number} attemptsCount - Number of failed attempts
   */
  async lockAccount(username, durationMinutes = 15, reason = 'Too many failed login attempts', attemptsCount = 0) {
    try {
      const unlockAt = new Date(Date.now() + durationMinutes * 60 * 1000);

      return new Promise((resolve, reject) => {
        this.db.run(
          `INSERT OR REPLACE INTO account_lockouts (username, unlock_at, reason, attempts_count) 
           VALUES (?, ?, ?, ?)`,
          [username, unlockAt.toISOString(), reason, attemptsCount],
          function(err) {
            if (err) {
              reject(err);
            } else {
              logger.warn('Account locked', { username, durationMinutes, reason, attemptsCount });
              resolve({
                locked: true,
                unlocksAt: unlockAt,
                reason: reason
              });
            }
          }
        );
      });
    } catch (error) {
      logger.error('Failed to lock account', { username, error: error.message });
      throw error;
    }
  }

  /**
   * Unlock an account
   * @param {string} username - Username to unlock
   */
  async unlockAccount(username) {
    try {
      return new Promise((resolve, reject) => {
        this.db.run(
          `DELETE FROM account_lockouts WHERE username = ?`,
          [username],
          function(err) {
            if (err) {
              reject(err);
            } else {
              logger.info('Account unlocked', { username });
              resolve(true);
            }
          }
        );
      });
    } catch (error) {
      logger.error('Failed to unlock account', { username, error: error.message });
      throw error;
    }
  }

  /**
   * Check if login should be allowed based on failed attempts
   * Implements progressive lockout:
   * - 3 failed attempts: warning
   * - 5 failed attempts: 15-minute lockout
   * - 10 failed attempts: 1-hour lockout
   * - 15+ failed attempts: 24-hour lockout
   *
   * @param {string} username - Username attempting login
   * @param {string} ip - IP address of attempt
   * @returns {Promise<Object>} { allowed: boolean, reason: string|null }
   */
  async checkLoginAllowed(username, ip) {
    try {
      // Check if account is locked
      const lockStatus = await this.isAccountLocked(username);
      if (lockStatus.locked) {
        const minutesRemaining = Math.ceil((lockStatus.unlocksAt - Date.now()) / 60000);
        return {
          allowed: false,
          reason: `Account is locked. Try again in ${minutesRemaining} minutes.`,
          lockStatus
        };
      }

      // Get failed attempts in last 15 minutes
      const failedAttempts = await this.getFailedAttempts(username, 15);

      // Determine if we should lock the account
      let shouldLock = false;
      let lockDuration = 15;
      let lockReason = '';

      if (failedAttempts >= 15) {
        shouldLock = true;
        lockDuration = 1440; // 24 hours
        lockReason = 'Too many failed login attempts (15+)';
      } else if (failedAttempts >= 10) {
        shouldLock = true;
        lockDuration = 60; // 1 hour
        lockReason = 'Too many failed login attempts (10+)';
      } else if (failedAttempts >= 5) {
        shouldLock = true;
        lockDuration = 15; // 15 minutes
        lockReason = 'Too many failed login attempts (5+)';
      }

      if (shouldLock) {
        await this.lockAccount(username, lockDuration, lockReason, failedAttempts);
        const minutesRemaining = lockDuration;
        return {
          allowed: false,
          reason: `Account is locked due to too many failed attempts. Try again in ${minutesRemaining} minutes.`,
          lockStatus: { locked: true, unlocksAt: new Date(Date.now() + lockDuration * 60 * 1000) }
        };
      }

      // Allow login but warn if approaching lockout
      let warning = null;
      if (failedAttempts >= 3) {
        const attemptsRemaining = 5 - failedAttempts;
        warning = `Warning: ${attemptsRemaining} more failed attempts will lock your account.`;
      }

      return {
        allowed: true,
        reason: null,
        warning: warning,
        failedAttempts: failedAttempts
      };
    } catch (error) {
      logger.error('Error checking login allowed', { username, ip, error: error.message });
      // On error, allow login to prevent lockout of legitimate users
      return { allowed: true, reason: null };
    }
  }

  /**
   * Clean up old login attempt records (older than 30 days)
   */
  async cleanupOldAttempts() {
    try {
      return new Promise((resolve, reject) => {
        this.db.run(
          `DELETE FROM login_attempts 
           WHERE timestamp < datetime('now', '-30 days')`,
          function(err) {
            if (err) {
              reject(err);
            } else {
              logger.info('Cleaned up old login attempts', { deletedRows: this.changes });
              resolve(this.changes);
            }
          }
        );
      });
    } catch (error) {
      logger.error('Failed to cleanup old attempts', { error: error.message });
    }
  }

  /**
   * Get login attempt statistics for a username
   * @param {string} username - Username to get stats for
   * @returns {Promise<Object>} Statistics object
   */
  async getLoginStatistics(username) {
    try {
      return new Promise((resolve, reject) => {
        this.db.get(
          `SELECT 
             COUNT(*) as total_attempts,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_attempts,
             SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_attempts,
             MAX(timestamp) as last_attempt
           FROM login_attempts 
           WHERE username = ?`,
          [username],
          (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve({
                totalAttempts: row?.total_attempts || 0,
                successfulAttempts: row?.successful_attempts || 0,
                failedAttempts: row?.failed_attempts || 0,
                lastAttempt: row?.last_attempt ? new Date(row.last_attempt) : null
              });
            }
          }
        );
      });
    } catch (error) {
      logger.error('Failed to get login statistics', { username, error: error.message });
      return {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        lastAttempt: null
      };
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new AccountLockoutManager();
  }
  return instance;
}

module.exports = {
  getInstance,
  AccountLockoutManager
};
