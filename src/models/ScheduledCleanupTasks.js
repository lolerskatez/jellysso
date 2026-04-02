/**
 * Scheduled cleanup tasks for database maintenance
 * Automatically cleans up old records and optimizes database
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');
const CONSTANTS = require('../config/constants');

class ScheduledCleanupTasks {
  constructor() {
    this.tasks = new Map();
    this.isRunning = false;
  }

  /**
   * Initialize all scheduled cleanup tasks
   */
  initializeTasks() {
    logger.info('Initializing scheduled cleanup tasks');

    // Cleanup audit logs
    this.scheduleTask(
      'cleanup-audit-logs',
      () => this.cleanupAuditLogs(),
      CONSTANTS.MAINTENANCE.AUDIT_LOG_CLEANUP_INTERVAL
    );

    // Cleanup sessions
    this.scheduleTask(
      'cleanup-sessions',
      () => this.cleanupSessions(),
      CONSTANTS.MAINTENANCE.SESSION_CLEANUP_INTERVAL
    );

    // Cleanup expired API keys
    this.scheduleTask(
      'cleanup-api-keys',
      () => this.cleanupExpiredApiKeys(),
      CONSTANTS.MAINTENANCE.AUDIT_LOG_CLEANUP_INTERVAL
    );

    // Cleanup webhook events
    this.scheduleTask(
      'cleanup-webhook-events',
      () => this.cleanupWebhookEvents(),
      CONSTANTS.MAINTENANCE.AUDIT_LOG_CLEANUP_INTERVAL
    );

    // Cleanup login attempts
    this.scheduleTask(
      'cleanup-login-attempts',
      () => this.cleanupLoginAttempts(),
      CONSTANTS.MAINTENANCE.SESSION_CLEANUP_INTERVAL
    );

    // Database optimization — skip immediate run; VACUUM cannot run while
    // startup SQL statements (index creation etc.) are still in progress.
    this.scheduleTask(
      'optimize-database',
      () => this.optimizeDatabase(),
      CONSTANTS.MAINTENANCE.DATABASE_OPTIMIZE_INTERVAL,
      false
    );

    logger.info('Scheduled cleanup tasks initialized');
  }

  /**
   * Schedule a task to run at regular intervals
   * @param {string} taskName - Name of the task
   * @param {function} taskFn - Function to execute
   * @param {number} interval - Interval in milliseconds
   * @param {boolean} [runImmediately=true] - Whether to run the task once on startup
   */
  scheduleTask(taskName, taskFn, interval, runImmediately = true) {
    // Optionally run immediately on first schedule
    if (runImmediately) {
      taskFn().catch(err => {
        logger.error(`Task ${taskName} failed on initial run`, { error: err.message });
      });
    }

    // Then schedule for regular intervals
    const timerId = setInterval(() => {
      taskFn().catch(err => {
        logger.error(`Task ${taskName} failed`, { error: err.message });
      });
    }, interval);

    this.tasks.set(taskName, { timerId, interval });
    logger.debug(`Task scheduled: ${taskName} (interval: ${interval}ms)`);
  }

  /**
   * Cleanup old audit logs
   */
  async cleanupAuditLogs() {
    try {
      const daysToKeep = CONSTANTS.DATABASE.AUDIT_LOG_RETENTION_DAYS;
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

      const result = await new Promise((resolve, reject) => {
        DatabaseManager.db.run(
          `DELETE FROM audit_logs WHERE timestamp < ?`,
          [cutoffDate],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });

      if (result > 0) {
        logger.info(`Cleaned up ${result} old audit logs (older than ${daysToKeep} days)`);
      }
    } catch (error) {
      logger.error('Error cleaning up audit logs', { error: error.message });
    }
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupSessions() {
    try {
      const daysToKeep = CONSTANTS.DATABASE.SESSION_RETENTION_DAYS;
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

      const result = await new Promise((resolve, reject) => {
        DatabaseManager.db.run(
          `DELETE FROM sessions WHERE expires < ?`,
          [cutoffDate],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });

      if (result > 0) {
        logger.info(`Cleaned up ${result} expired sessions`);
      }
    } catch (error) {
      logger.error('Error cleaning up sessions', { error: error.message });
    }
  }

  /**
   * Cleanup expired API keys
   */
  async cleanupExpiredApiKeys() {
    try {
      // Guard: table may not exist yet if APIKeyManager hasn't initialized
      const tableExists = await new Promise((resolve) => {
        DatabaseManager.db.get(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'`,
          (err, row) => resolve(!err && !!row)
        );
      });
      if (!tableExists) return;
      const result = await new Promise((resolve, reject) => {
        DatabaseManager.db.run(
          `DELETE FROM api_keys WHERE expires_at < datetime('now')`,
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });

      if (result > 0) {
        logger.info(`Cleaned up ${result} expired API keys`);
      }
    } catch (error) {
      logger.error('Error cleaning up API keys', { error: error.message });
    }
  }

  /**
   * Cleanup old webhook events
   */
  async cleanupWebhookEvents() {
    try {
      const daysToKeep = CONSTANTS.DATABASE.WEBHOOK_EVENT_RETENTION_DAYS;
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

      const result = await new Promise((resolve, reject) => {
        DatabaseManager.db.run(
          `DELETE FROM webhook_events WHERE created_at < ?`,
          [cutoffDate],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });

      if (result > 0) {
        logger.info(`Cleaned up ${result} old webhook events (older than ${daysToKeep} days)`);
      }
    } catch (error) {
      logger.error('Error cleaning up webhook events', { error: error.message });
    }
  }

  /**
   * Cleanup old login attempts
   */
  async cleanupLoginAttempts() {
    try {
      const cutoffDate = new Date(Date.now() - CONSTANTS.ACCOUNT_LOCKOUT.ATTEMPT_WINDOW).toISOString();

      const result = await new Promise((resolve, reject) => {
        DatabaseManager.db.run(
          `DELETE FROM login_attempts WHERE timestamp < ?`,
          [cutoffDate],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      });

      if (result > 0) {
        logger.info(`Cleaned up ${result} old login attempts`);
      }
    } catch (error) {
      logger.error('Error cleaning up login attempts', { error: error.message });
    }
  }

  /**
   * Optimize database (VACUUM and ANALYZE)
   */
  async optimizeDatabase() {
    try {
      logger.info('Running database optimization');

      await new Promise((resolve, reject) => {
        DatabaseManager.db.run('VACUUM', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        DatabaseManager.db.run('ANALYZE', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.info('Database optimization completed');
    } catch (error) {
      logger.error('Error optimizing database', { error: error.message });
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stopAllTasks() {
    logger.info('Stopping all scheduled cleanup tasks');

    for (const [taskName, { timerId }] of this.tasks.entries()) {
      clearInterval(timerId);
      logger.debug(`Task stopped: ${taskName}`);
    }

    this.tasks.clear();
  }

  /**
   * Get task status
   * @returns {object}
   */
  getTaskStatus() {
    const status = {};
    for (const [taskName, { interval }] of this.tasks.entries()) {
      status[taskName] = {
        running: true,
        interval: `${interval}ms`
      };
    }
    return status;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new ScheduledCleanupTasks();
  }
  return instance;
}

module.exports = { ScheduledCleanupTasks, getInstance };
