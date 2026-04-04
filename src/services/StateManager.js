/**
 * Centralized State Management Service
 * Replaces global.appCache with proper state management
 */

const logger = require('../utils/logger');
const CONSTANTS = require('../utils/constants');

class StateManager {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0
    };
    this.maxSize = CONSTANTS.CACHE.MAX_SIZE;
    this.defaultTTL = CONSTANTS.CACHE.TTL;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, value, ttl = this.defaultTTL) {
    // Check size limit
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    const expiresAt = Date.now() + ttl;
    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      accessCount: 0
    });

    logger.debug(`Cache set: ${key} (TTL: ${ttl}ms)`);
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} - Cached value or undefined
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.expirations++;
      logger.debug(`Cache expired: ${key}`);
      return undefined;
    }

    // Update access stats
    entry.accessCount++;
    this.stats.hits++;
    logger.debug(`Cache hit: ${key}`);

    return entry.value;
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
    logger.debug(`Cache deleted: ${key}`);
  }

  /**
   * Clear entire cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`Cache cleared (${size} entries removed)`);
  }

  /**
   * Invalidate cache by pattern
   * @param {string|RegExp} pattern - Pattern to match
   * @returns {number} - Number of entries invalidated
   */
  invalidatePattern(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    logger.debug(`Cache invalidated by pattern: ${pattern} (${count} entries)`);
    return count;
  }

  /**
   * Evict oldest entry (LRU)
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      logger.debug(`Cache evicted: ${oldestKey}`);
    }
  }

  /**
   * Get cache statistics
   * @returns {object}
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0
    };
    logger.info('Cache statistics reset');
  }

  /**
   * Get cache contents (debug mode)
   * @returns {object}
   */
  debug() {
    const contents = {};
    for (const [key, entry] of this.cache.entries()) {
      contents[key] = {
        value: entry.value,
        expiresAt: new Date(entry.expiresAt).toISOString(),
        createdAt: new Date(entry.createdAt).toISOString(),
        accessCount: entry.accessCount,
        expired: Date.now() > entry.expiresAt
      };
    }
    return contents;
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    let count = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      logger.debug(`Cache cleanup removed ${count} expired entries`);
    }

    return count;
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new StateManager();
  }
  return instance;
}

module.exports = { StateManager, getInstance };
