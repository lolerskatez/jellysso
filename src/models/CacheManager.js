/**
 * Advanced Caching Strategy
 * Caches frequently accessed data with TTL and invalidation
 */
class CacheManager {
  constructor(options = {}) {
    this.cache = new Map();
    this.options = {
      defaultTTL: options.defaultTTL || 5 * 60 * 1000, // 5 minutes
      maxSize: options.maxSize || 1000, // max cache entries
      enableStats: options.enableStats !== false,
      ...options
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };

    this.listeners = new Map(); // For cache event listeners
  }

  /**
   * Get value from cache
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.options.enableStats) this.stats.misses++;
      return null;
    }

    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      if (this.options.enableStats) this.stats.misses++;
      this.emit('expired', key);
      return null;
    }

    if (this.options.enableStats) {
      this.stats.hits++;
      entry.hits = (entry.hits || 0) + 1;
      entry.lastAccessed = Date.now();
    }

    return entry.value;
  }

  /**
   * Set value in cache with optional TTL
   */
  set(key, value, ttl = this.options.defaultTTL) {
    // Evict if cache is full (LRU strategy)
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry = {
      value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : null,
      hits: 0,
      lastAccessed: Date.now()
    };

    this.cache.set(key, entry);
    if (this.options.enableStats) this.stats.sets++;
    this.emit('set', key, value);

    return this;
  }

  /**
   * Delete key from cache
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted && this.options.enableStats) this.stats.deletes++;
    if (deleted) this.emit('delete', key);
    return deleted;
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
    this.emit('clear');
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get or compute value
   */
  getOrSet(key, computeFn, ttl = this.options.defaultTTL) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    // Compute and cache
    const value = computeFn();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Async version: get or compute with promise
   */
  async getOrSetAsync(key, computeFn, ttl = this.options.defaultTTL) {
    const cached = this.get(key);
    if (cached !== null) return cached;

    try {
      const value = await computeFn();
      this.set(key, value, ttl);
      return value;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Invalidate keys matching pattern
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    let count = 0;

    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache entry with metadata
   */
  getEntry(key) {
    return this.cache.get(key) || null;
  }

  /**
   * Evict least recently used entry
   */
  evictLRU() {
    let lruKey = null;
    let lruTime = Date.now();

    for (const [key, entry] of this.cache) {
      const accessTime = entry.lastAccessed || entry.createdAt;
      if (accessTime < lruTime) {
        lruTime = accessTime;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      if (this.options.enableStats) this.stats.evictions++;
      this.emit('evict', lruKey);
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    let count = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;

    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: hitRate.toFixed(2) + '%',
      maxSize: this.options.maxSize
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };
  }

  /**
   * Listen to cache events
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Emit cache events
   */
  emit(event, ...args) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => {
      try {
        cb(...args);
      } catch (error) {
        console.error(`Cache event error (${event}):`, error);
      }
    });
  }

  /**
   * Get cache contents for debugging
   */
  debug() {
    const contents = {};
    for (const [key, entry] of this.cache) {
      contents[key] = {
        value: entry.value,
        expiresAt: entry.expiresAt,
        hits: entry.hits,
        createdAt: new Date(entry.createdAt).toISOString()
      };
    }
    return contents;
  }
}

module.exports = CacheManager;
