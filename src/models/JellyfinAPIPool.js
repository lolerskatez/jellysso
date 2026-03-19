/**
 * Jellyfin API Connection Pool & Request Queue
 * Manages connection pooling and request queuing to prevent overwhelming Jellyfin server
 */

const axios = require('axios');
const logger = require('../utils/logger');
const JellyfinAPI = require('./JellyfinAPI');

class JellyfinAPIPool {
  static instance = null;

  static getInstance() {
    if (!JellyfinAPIPool.instance) {
      JellyfinAPIPool.instance = new JellyfinAPIPool();
    }
    return JellyfinAPIPool.instance;
  }

  constructor() {
    this.poolSize = parseInt(process.env.JELLYFIN_POOL_SIZE || '5');
    this.maxQueueSize = parseInt(process.env.JELLYFIN_MAX_QUEUE || '100');
    this.requestTimeout = parseInt(process.env.JELLYFIN_TIMEOUT || '30000');
    this.retryAttempts = parseInt(process.env.JELLYFIN_RETRY_ATTEMPTS || '3');
    this.retryDelay = parseInt(process.env.JELLYFIN_RETRY_DELAY || '1000');

    this.connections = [];
    this.activeRequests = 0;
    this.requestQueue = [];
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      averageResponseTime: 0
    };

    this.initializePool();
  }

  /**
   * Initialize connection pool
   */
  initializePool() {
    logger.info('Initializing Jellyfin API connection pool', {
      poolSize: this.poolSize,
      maxQueueSize: this.maxQueueSize,
      timeout: this.requestTimeout
    });

    for (let i = 0; i < this.poolSize; i++) {
      this.connections.push({
        id: i,
        inUse: false,
        lastUsed: null,
        requestCount: 0
      });
    }
  }

  /**
   * Get available connection from pool
   */
  async getConnection() {
    // Try to find an available connection
    const available = this.connections.find(conn => !conn.inUse);
    
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }

    // If no connection available, wait for one to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const conn = this.connections.find(c => !c.inUse);
        if (conn) {
          clearInterval(checkInterval);
          conn.inUse = true;
          conn.lastUsed = Date.now();
          resolve(conn);
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(null);
      }, 30000);
    });
  }

  /**
   * Release connection back to pool
   */
  releaseConnection(connection) {
    if (connection) {
      connection.inUse = false;
      connection.requestCount++;
    }
  }

  /**
   * Execute API request with pooling and retry logic
   */
  async executeRequest(method, url, data = null, config = {}) {
    const startTime = Date.now();
    this.stats.totalRequests++;

    // Check queue size
    if (this.requestQueue.length >= this.maxQueueSize) {
      logger.warn('Request queue full, rejecting request', {
        queueSize: this.requestQueue.length,
        maxQueue: this.maxQueueSize
      });
      this.stats.failedRequests++;
      throw new Error('Request queue full');
    }

    // Get connection from pool
    const connection = await this.getConnection();
    if (!connection) {
      logger.error('Failed to get connection from pool');
      this.stats.failedRequests++;
      throw new Error('No available connections in pool');
    }

    try {
      let lastError;
      
      // Retry logic
      for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
        try {
          const response = await this.executeWithTimeout(method, url, data, config);
          
          const duration = Date.now() - startTime;
          this.updateStats(duration, true);
          
          logger.debug('Jellyfin API request successful', {
            method,
            url,
            duration,
            connectionId: connection.id,
            attempt: attempt + 1
          });

          return response;
        } catch (error) {
          lastError = error;
          
          // Don't retry on client errors (4xx)
          if (error.response?.status >= 400 && error.response?.status < 500) {
            throw error;
          }

          // Wait before retrying
          if (attempt < this.retryAttempts - 1) {
            const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            logger.warn('Retrying Jellyfin API request', {
              method,
              url,
              attempt: attempt + 1,
              delay
            });
          }
        }
      }

      // All retries failed
      const duration = Date.now() - startTime;
      this.updateStats(duration, false);
      logger.error('Jellyfin API request failed after retries', {
        method,
        url,
        attempts: this.retryAttempts,
        error: lastError?.message
      });

      throw lastError;
    } finally {
      this.releaseConnection(connection);
      this.processQueue();
    }
  }

  /**
   * Execute request with timeout
   */
  executeWithTimeout(method, url, data, config) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, this.requestTimeout);

      const axiosConfig = {
        ...config,
        timeout: this.requestTimeout,
        method,
        url,
        ...(data && { data })
      };

      axios(axiosConfig)
        .then(response => {
          clearTimeout(timeout);
          resolve(response.data);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Queue a request for later execution
   */
  async queueRequest(method, url, data = null, config = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        method,
        url,
        data,
        config,
        resolve,
        reject,
        timestamp: Date.now()
      });

      this.stats.queuedRequests = this.requestQueue.length;
      logger.debug('Request queued', {
        queueSize: this.requestQueue.length,
        url
      });

      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  async processQueue() {
    if (this.requestQueue.length === 0) return;

    // Check if we can process more requests
    const availableConnections = this.connections.filter(c => !c.inUse).length;
    if (availableConnections === 0) return;

    const request = this.requestQueue.shift();
    if (!request) return;

    try {
      const result = await this.executeRequest(
        request.method,
        request.url,
        request.data,
        request.config
      );
      request.resolve(result);
    } catch (error) {
      request.reject(error);
    }

    this.stats.queuedRequests = this.requestQueue.length;

    // Process next request
    if (this.requestQueue.length > 0) {
      setImmediate(() => this.processQueue());
    }
  }

  /**
   * Update statistics
   */
  updateStats(duration, success) {
    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }

    // Update average response time
    const totalRequests = this.stats.successfulRequests + this.stats.failedRequests;
    this.stats.averageResponseTime = 
      (this.stats.averageResponseTime * (totalRequests - 1) + duration) / totalRequests;
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const activeConnections = this.connections.filter(c => c.inUse).length;
    
    return {
      ...this.stats,
      poolSize: this.poolSize,
      activeConnections,
      availableConnections: this.poolSize - activeConnections,
      queuedRequests: this.requestQueue.length,
      successRate: this.stats.totalRequests > 0 
        ? (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
        : 'N/A',
      averageResponseTime: Math.round(this.stats.averageResponseTime) + 'ms'
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      queuedRequests: 0,
      averageResponseTime: 0
    };
    logger.info('API pool statistics reset');
  }

  /**
   * Health check
   */
  async healthCheck(jellyfinUrl, apiKey) {
    try {
      const response = await this.executeRequest(
        'GET',
        `${jellyfinUrl}/System/Info`,
        null,
        { headers: { 'X-MediaBrowser-Token': apiKey } }
      );
      return { healthy: true, version: response.Version };
    } catch (error) {
      logger.error('Jellyfin health check failed', { error: error.message });
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Drain queue and close connections
   */
  async shutdown() {
    logger.info('Shutting down Jellyfin API pool');
    
    // Wait for active requests to complete
    let timeout = 30000; // 30 seconds
    while (this.activeRequests > 0 && timeout > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      timeout -= 100;
    }

    if (this.activeRequests > 0) {
      logger.warn('Forced shutdown with active requests', {
        activeRequests: this.activeRequests
      });
    }

    // Reject queued requests
    this.requestQueue.forEach(req => {
      req.reject(new Error('Pool shutting down'));
    });
    this.requestQueue = [];

    logger.info('Jellyfin API pool shutdown complete');
  }
}

module.exports = JellyfinAPIPool;
