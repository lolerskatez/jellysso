/**
 * Distributed Cache Manager
 * Supports both in-memory caching and Redis for distributed deployments
 */

const logger = require('../utils/logger');
const CacheManager = require('./CacheManager');

class DistributedCacheManager {
  static instance = null;
  static redis = null;

  static getInstance() {
    if (!DistributedCacheManager.instance) {
      DistributedCacheManager.instance = new DistributedCacheManager();
    }
    return DistributedCacheManager.instance;
  }

  constructor() {
    this.useRedis = process.env.REDIS_URL ? true : false;
    this.localCache = new CacheManager({
      defaultTTL: 5 * 60 * 1000,
      maxSize: 1000
    });
    this.initializeRedis();
  }

  /**
   * Initialize Redis connection if configured
   */
  async initializeRedis() {
    if (!this.useRedis) {
      logger.info('Redis not configured, using in-memory cache only');
      return;
    }

    try {
      const redis = require('redis');
      const client = redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Redis reconnection failed after 10 attempts');
              return new Error('Redis max retries exceeded');
            }
            return retries * 100;
          }
        }
      });

      client.on('error', (err) => {
        logger.error('Redis client error', { error: err.message });
      });

      client.on('connect', () => {
        logger.info('Redis connected successfully');
      });

      client.on('disconnect', () => {
        logger.warn('Redis disconnected');
      });

      await client.connect();
      DistributedCacheManager.redis = client;
      logger.info('Distributed cache initialized with Redis');
    } catch (error) {
      logger.warn('Failed to initialize Redis, falling back to in-memory cache', {
        error: error.message
      });
      this.useRedis = false;
    }
  }

  /**
   * Get value from cache (Redis first, then local)
   */
  async get(key) {
    try {
      // Try Redis first if available
      if (this.useRedis && DistributedCacheManager.redis) {
        const value = await DistributedCacheManager.redis.get(key);
        if (value) {
          logger.debug('Cache hit (Redis)', { key });
          // Also store in local cache for faster access
          this.localCache.set(key, JSON.parse(value));
          return JSON.parse(value);
        }
      }

      // Fall back to local cache
      const localValue = this.localCache.get(key);
      if (localValue) {
        logger.debug('Cache hit (local)', { key });
        return localValue;
      }

      logger.debug('Cache miss', { key });
      return undefined;
    } catch (error) {
      logger.error('Cache get error', { key, error: error.message });
      return undefined;
    }
  }

  /**
   * Set value in cache (both Redis and local)
   */
  async set(key, value, options = {}) {
    try {
      const ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default
      const ttlSeconds = Math.ceil(ttl / 1000);

      // Set in local cache
      this.localCache.set(key, value, { ttl });

      // Set in Redis if available
      if (this.useRedis && DistributedCacheManager.redis) {
        await DistributedCacheManager.redis.setEx(
          key,
          ttlSeconds,
          JSON.stringify(value)
        );
        logger.debug('Cache set (Redis)', { key, ttlSeconds });
      } else {
        logger.debug('Cache set (local)', { key });
      }
    } catch (error) {
      logger.error('Cache set error', { key, error: error.message });
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key) {
    try {
      // Delete from local cache
      this.localCache.invalidate(key);

      // Delete from Redis if available
      if (this.useRedis && DistributedCacheManager.redis) {
        await DistributedCacheManager.redis.del(key);
        logger.debug('Cache deleted (Redis)', { key });
      } else {
        logger.debug('Cache deleted (local)', { key });
      }
    } catch (error) {
      logger.error('Cache delete error', { key, error: error.message });
    }
  }

  /**
   * Clear all cache entries matching pattern
   */
  async clear(pattern = '*') {
    try {
      // Clear local cache (pattern matching)
      if (pattern === '*') {
        this.localCache.clear?.();
      }

      // Clear Redis if available
      if (this.useRedis && DistributedCacheManager.redis) {
        const keys = await DistributedCacheManager.redis.keys(pattern);
        if (keys.length > 0) {
          await DistributedCacheManager.redis.del(keys);
          logger.info('Cache cleared', { pattern, deletedCount: keys.length });
        }
      } else {
        logger.info('Local cache cleared', { pattern });
      }
    } catch (error) {
      logger.error('Cache clear error', { pattern, error: error.message });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats() {
    try {
      const stats = {
        useRedis: this.useRedis,
        redisConnected: this.useRedis && DistributedCacheManager.redis?.isOpen,
        localCacheSize: this.localCache.size?.() || 0
      };

      if (this.useRedis && DistributedCacheManager.redis) {
        const info = await DistributedCacheManager.redis.info('stats');
        stats.redisStats = info;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get cache stats', { error: error.message });
      return { error: error.message };
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.useRedis && DistributedCacheManager.redis) {
      await DistributedCacheManager.redis.quit();
      logger.info('Redis connection closed');
    }
  }
}

module.exports = DistributedCacheManager;
