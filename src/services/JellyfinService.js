/**
 * Jellyfin API Service - Abstraction layer for Jellyfin API calls
 * Provides circuit breaker, timeout handling, and error recovery
 */

const JellyfinAPI = require('../models/JellyfinAPI');
const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');

class JellyfinService {
  constructor(baseURL, apiKey = null) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.api = new JellyfinAPI(baseURL, apiKey);
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      threshold: 5,
      resetTimeout: 60000 // 1 minute
    };
  }

  /**
   * Execute API call with circuit breaker pattern
   * @param {string} method - Method name
   * @param {array} args - Method arguments
   * @returns {Promise}
   */
  async executeWithCircuitBreaker(method, args) {
    // Check circuit breaker state
    if (this.circuitBreaker.state === 'open') {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure > this.circuitBreaker.resetTimeout) {
        // Try to recover
        this.circuitBreaker.state = 'half-open';
        logger.info('Circuit breaker entering half-open state');
      } else {
        throw new Error('Circuit breaker is open. Service temporarily unavailable.');
      }
    }

    try {
      const result = await this.executeWithRetry(method, args);
      
      // Success - update circuit breaker
      if (this.circuitBreaker.state === 'half-open') {
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failureCount = 0;
        logger.info('Circuit breaker closed - service recovered');
      }
      
      return result;
    } catch (error) {
      // Failure - update circuit breaker
      this.circuitBreaker.failureCount++;
      this.circuitBreaker.lastFailureTime = Date.now();

      if (this.circuitBreaker.failureCount >= this.circuitBreaker.threshold) {
        this.circuitBreaker.state = 'open';
        logger.error('Circuit breaker opened due to repeated failures');
      }

      throw error;
    }
  }

  /**
   * Execute API call with retry logic
   * @param {string} method - Method name
   * @param {array} args - Method arguments
   * @param {number} retries - Current retry count
   * @returns {Promise}
   */
  async executeWithRetry(method, args, retries = 0) {
    try {
      if (!this.api[method]) {
        throw new Error(`Method ${method} not found on JellyfinAPI`);
      }

      return await this.api[method](...args);
    } catch (error) {
      if (retries < CONSTANTS.JELLYFIN_API.RETRY_ATTEMPTS && this.isRetryableError(error)) {
        const delay = CONSTANTS.JELLYFIN_API.RETRY_DELAY * Math.pow(2, retries);
        logger.warn(`API call failed, retrying (${retries + 1}/${CONSTANTS.JELLYFIN_API.RETRY_ATTEMPTS})`, {
          method,
          error: error.message,
          delay
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(method, args, retries + 1);
      }

      logger.error('API call failed after retries', {
        method,
        error: error.message,
        retries
      });

      throw error;
    }
  }

  /**
   * Check if error is retryable
   * @param {Error} error
   * @returns {boolean}
   */
  isRetryableError(error) {
    const retryableErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'timeout',
      '503',
      '502',
      '504'
    ];

    return retryableErrors.some(msg => 
      error.message.includes(msg) || error.code?.includes(msg)
    );
  }

  /**
   * Get users with error handling
   */
  async getUsers() {
    return this.executeWithCircuitBreaker('getUsers', []);
  }

  /**
   * Authenticate user
   */
  async authenticateByName(username, password) {
    return this.executeWithCircuitBreaker('authenticateByName', [username, password]);
  }

  /**
   * Get user by ID
   */
  async getUser(userId) {
    return this.executeWithCircuitBreaker('getUser', [userId]);
  }

  /**
   * Update user
   */
  async updateUser(userId, userData) {
    return this.executeWithCircuitBreaker('updateUser', [userId, userData]);
  }

  /**
   * Create user
   */
  async createUser(userData) {
    return this.executeWithCircuitBreaker('createUser', [userData]);
  }

  /**
   * Delete user
   */
  async deleteUser(userId) {
    return this.executeWithCircuitBreaker('deleteUser', [userId]);
  }

  /**
   * Get active sessions
   */
  async getActiveSessions(userId) {
    return this.executeWithCircuitBreaker('getActiveSessions', [userId]);
  }

  /**
   * Get system info
   */
  async getSystemInfo() {
    return this.executeWithCircuitBreaker('getSystemInfo', []);
  }

  /**
   * Test connection
   */
  async testConnection() {
    return this.executeWithCircuitBreaker('testConnection', []);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      state: this.circuitBreaker.state,
      failureCount: this.circuitBreaker.failureCount,
      lastFailureTime: this.circuitBreaker.lastFailureTime ? 
        new Date(this.circuitBreaker.lastFailureTime).toISOString() : null
    };
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    this.circuitBreaker = {
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      threshold: 5,
      resetTimeout: 60000
    };
    logger.info('Circuit breaker reset');
  }
}

module.exports = JellyfinService;
