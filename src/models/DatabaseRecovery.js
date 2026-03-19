/**
 * Database connection recovery and resilience
 * Implements retry logic and graceful degradation
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class DatabaseRecovery {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
    this.isHealthy = true;
    this.lastHealthCheck = Date.now();
    this.healthCheckInterval = 30000; // 30 seconds
  }

  /**
   * Execute query with automatic retry on failure
   * @param {string} sql - SQL query
   * @param {array} params - Query parameters
   * @param {number} retries - Current retry count
   * @returns {Promise}
   */
  async executeWithRetry(sql, params = [], retries = 0) {
    try {
      return await this.execute(sql, params);
    } catch (error) {
      if (retries < this.maxRetries && this.isRetryableError(error)) {
        logger.warn(`Query failed, retrying (${retries + 1}/${this.maxRetries})`, {
          error: error.message,
          sql: sql.substring(0, 100)
        });

        // Exponential backoff
        const delay = this.retryDelay * Math.pow(2, retries);
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.executeWithRetry(sql, params, retries + 1);
      }

      logger.error('Query failed after retries', {
        error: error.message,
        sql: sql.substring(0, 100),
        retries
      });

      throw error;
    }
  }

  /**
   * Execute a query
   * @param {string} sql - SQL query
   * @param {array} params - Query parameters
   * @returns {Promise}
   */
  async execute(sql, params = []) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;

      if (!db) {
        reject(new Error('Database connection not available'));
        return;
      }

      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Check if error is retryable
   * @param {Error} error
   * @returns {boolean}
   */
  isRetryableError(error) {
    const retryableErrors = [
      'SQLITE_BUSY',
      'SQLITE_IOERR',
      'SQLITE_CANTOPEN',
      'database is locked',
      'disk I/O error',
      'unable to open database'
    ];

    return retryableErrors.some(msg => error.message.includes(msg));
  }

  /**
   * Perform health check on database
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const now = Date.now();
      if (now - this.lastHealthCheck < this.healthCheckInterval) {
        return this.isHealthy;
      }

      await this.execute('SELECT 1');
      this.isHealthy = true;
      this.lastHealthCheck = now;
      logger.debug('Database health check passed');
      return true;
    } catch (error) {
      this.isHealthy = false;
      logger.error('Database health check failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get database health status
   * @returns {object}
   */
  getHealthStatus() {
    return {
      healthy: this.isHealthy,
      lastCheck: new Date(this.lastHealthCheck).toISOString(),
      message: this.isHealthy ? 'Database is healthy' : 'Database connection issues detected'
    };
  }

  /**
   * Attempt to recover database connection
   * @returns {Promise<boolean>}
   */
  async recover() {
    try {
      logger.warn('Attempting to recover database connection');

      // Close existing connection
      const db = DatabaseManager.getInstance().db;
      if (db) {
        await new Promise((resolve) => {
          db.close(() => resolve());
        });
      }

      // Reinitialize
      DatabaseManager.getInstance().ensureDatabase();

      // Test connection
      const healthy = await this.healthCheck();
      if (healthy) {
        logger.info('Database connection recovered successfully');
        return true;
      }

      logger.error('Failed to recover database connection');
      return false;
    } catch (error) {
      logger.error('Error during database recovery', { error: error.message });
      return false;
    }
  }

  /**
   * Execute query with fallback response on failure
   * @param {string} sql - SQL query
   * @param {array} params - Query parameters
   * @param {*} fallbackValue - Value to return on failure
   * @returns {Promise}
   */
  async executeWithFallback(sql, params = [], fallbackValue = null) {
    try {
      return await this.executeWithRetry(sql, params);
    } catch (error) {
      logger.warn('Query failed, returning fallback value', {
        error: error.message,
        fallback: fallbackValue
      });
      return fallbackValue;
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new DatabaseRecovery();
  }
  return instance;
}

module.exports = { DatabaseRecovery, getInstance };
