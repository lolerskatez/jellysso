const crypto = require('crypto');
const DatabaseManager = require('../models/DatabaseManager');
const logger = require('../utils/logger');

/**
 * NotificationQueue - Manages notification delivery queue
 * Features:
 * - Async delivery with retries
 * - Deduplication
 * - Rate limiting per channel
 * - Complete delivery logging
 */
class NotificationQueue {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.db;
    this.processing = false;
    this.rateLimits = {
      email: { max: 10, interval: 1000 }, // 10 per second
      discord: { max: 5, interval: 1000 }, // 5 per second
      telegram: { max: 5, interval: 1000 } // 5 per second
    };
    this.lastSentTime = {
      email: {},
      discord: {},
      telegram: {}
    };
  }

  static getInstance() {
    if (!NotificationQueue.instance) {
      NotificationQueue.instance = new NotificationQueue();
    }
    return NotificationQueue.instance;
  }

  /**
   * Add notification to queue
   * 
   * @param {Object} options
   *   - userId: User ID
   *   - templateKey: Template key
   *   - channels: Array of channels ['email', 'discord']
   *   - variables: Object with variables for template
   *   - priority: 'high', 'normal', 'low' (default: normal)
   *   - deduplicateKey: Optional dedup key
   */
  async enqueue(options) {
    const {
      userId,
      templateKey,
      channels = ['email'],
      variables = {},
      priority = 'normal',
      deduplicateKey = null,
      maxRetries = 3
    } = options;

    // Validation
    if (!userId) throw new Error('userId is required');
    if (!templateKey) throw new Error('templateKey is required');
    if (!Array.isArray(channels) || channels.length === 0) {
      throw new Error('channels must be non-empty array');
    }

    // Check for duplicate
    if (deduplicateKey) {
      const isDuplicate = await this.isDuplicate(userId, deduplicateKey);
      if (isDuplicate) {
        logger.debug(`Skipping duplicate notification: ${deduplicateKey}`);
        return null;
      }
    }

    // Create queue entry
    const id = crypto.randomUUID();
    const entry = {
      id,
      user_id: userId,
      template_key: templateKey,
      channels: JSON.stringify(channels),
      variables: JSON.stringify(variables),
      status: 'pending',
      retry_count: 0,
      max_retries: maxRetries,
      priority: priority,
      error_message: null,
      created_at: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO notification_queue 
         (id, user_id, template_key, channels, variables, status, retry_count, max_retries, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.user_id,
          entry.template_key,
          entry.channels,
          entry.variables,
          entry.status,
          entry.retry_count,
          entry.max_retries,
          entry.priority,
          entry.created_at
        ],
        (err) => {
          if (err) return reject(err);
          resolve(entry);
        }
      );
    });
  }

  /**
   * Check if notification is duplicate
   */
  isDuplicate(userId, deduplicateKey) {
    return new Promise((resolve, reject) => {
      const timeWindow = 60000; // 1 minute
      const cutoff = new Date(Date.now() - timeWindow).toISOString();

      this.db.get(
        `SELECT id FROM notification_queue 
         WHERE user_id = ? AND template_key = ? 
         AND status = 'pending' 
         AND created_at > ?
         LIMIT 1`,
        [userId, deduplicateKey, cutoff],
        (err, row) => {
          if (err) return reject(err);
          resolve(!!row);
        }
      );
    });
  }

  /**
   * Get next pending notification to process
   */
  getNextPending() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM notification_queue 
         WHERE status = 'pending' AND retry_count < max_retries
         ORDER BY 
          CASE priority WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
          created_at ASC
         LIMIT 1`,
        (err, row) => {
          if (err) return reject(err);
          if (row) {
            row.channels = JSON.parse(row.channels);
            row.variables = JSON.parse(row.variables);
          }
          resolve(row);
        }
      );
    });
  }

  /**
   * Update queue entry status
   */
  updateStatus(id, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
      const query = errorMessage
        ? 'UPDATE notification_queue SET status = ?, error_message = ? WHERE id = ?'
        : 'UPDATE notification_queue SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?';

      const params = errorMessage
        ? [status, errorMessage, id]
        : [status, id];

      this.db.run(query, params, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  /**
   * Increment retry count
   */
  incrementRetry(id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE notification_queue SET retry_count = retry_count + 1 WHERE id = ?',
        [id],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  /**
   * Log notification delivery
   */
  logDelivery(userId, templateKey, channel, status, errorMessage = null) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const deliveredAt = status === 'sent' ? new Date().toISOString() : null;

      this.db.run(
        `INSERT INTO notification_logs 
         (id, user_id, template_key, channel, status, error_message, delivered_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, userId, templateKey, channel, status, errorMessage, deliveredAt],
        (err) => {
          if (err) return reject(err);
          resolve(id);
        }
      );
    });
  }

  /**
   * Get delivery logs for user
   */
  getDeliveryLogs(userId, limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM notification_logs 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        [userId, limit],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        }
      );
    });
  }

  /**
   * Check if should rate limit (per channel, per user)
   */
  shouldRateLimit(channel, userId) {
    const limit = this.rateLimits[channel];
    if (!limit) return false;

    const now = Date.now();
    if (!this.lastSentTime[channel]) {
      this.lastSentTime[channel] = {};
    }

    const lastSent = this.lastSentTime[channel][userId] || 0;
    const timeSinceLastSent = now - lastSent;

    return timeSinceLastSent < (limit.interval / limit.max);
  }

  /**
   * Update last sent time for rate limiting
   */
  updateRateLimit(channel, userId) {
    if (!this.lastSentTime[channel]) {
      this.lastSentTime[channel] = {};
    }
    this.lastSentTime[channel][userId] = Date.now();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
         FROM notification_queue`,
        (err, row) => {
          if (err) return reject(err);
          resolve(row || {});
        }
      );
    });
  }

  /**
   * Cleanup old queue entries (older than 30 days)
   */
  cleanup(daysToKeep = 30) {
    return new Promise((resolve, reject) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysToKeep);

      this.db.run(
        'DELETE FROM notification_queue WHERE created_at < ? AND status IN (?, ?)',
        [cutoff.toISOString(), 'sent', 'failed'],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes);
        }
      );
    });
  }
}

module.exports = NotificationQueue;
