/**
 * Webhook Manager
 * Manages webhooks for event-driven integrations
 */

const DatabaseManager = require('./DatabaseManager');
const axios = require('axios');
const logger = require('../utils/logger');

class WebhookManager {
  static instance = null;

  static getInstance() {
    if (!WebhookManager.instance) {
      WebhookManager.instance = new WebhookManager();
      WebhookManager.instance.initializeSchema();
    }
    return WebhookManager.instance;
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const db = DatabaseManager.getInstance();

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Webhooks table
        db.run(`
          CREATE TABLE IF NOT EXISTS webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            url TEXT NOT NULL,
            events TEXT NOT NULL,
            secret TEXT,
            active INTEGER DEFAULT 1,
            retry_count INTEGER DEFAULT 3,
            timeout_seconds INTEGER DEFAULT 30,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create webhooks table', { error: err.message });
            reject(err);
          }
        });

        // Webhook events table
        db.run(`
          CREATE TABLE IF NOT EXISTS webhook_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            webhook_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            response_code INTEGER,
            response_body TEXT,
            attempts INTEGER DEFAULT 0,
            last_attempt DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create webhook_events table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_webhook_events_webhook_id ON webhook_events(webhook_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            logger.info('Webhook schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Create webhook
   */
  async createWebhook(userId, url, events, secret = null) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const eventsJson = JSON.stringify(events);

      db.run(
        `INSERT INTO webhooks (user_id, url, events, secret) VALUES (?, ?, ?, ?)`,
        [userId, url, eventsJson, secret],
        function(err) {
          if (err) {
            logger.error('Failed to create webhook', { error: err.message, userId });
            reject(err);
          } else {
            logger.info('Webhook created', { webhookId: this.lastID, userId });
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * Get user's webhooks
   */
  async getUserWebhooks(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.all(
        `SELECT id, url, events, active, created_at FROM webhooks WHERE user_id = ? ORDER BY created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get user webhooks', { error: err.message, userId });
            reject(err);
          } else {
            const webhooks = (rows || []).map(row => ({
              ...row,
              events: JSON.parse(row.events)
            }));
            resolve(webhooks);
          }
        }
      );
    });
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.get(
        `SELECT * FROM webhooks WHERE id = ?`,
        [webhookId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get webhook', { error: err.message, webhookId });
            reject(err);
          } else if (row) {
            resolve({
              ...row,
              events: JSON.parse(row.events)
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Update webhook
   */
  async updateWebhook(webhookId, updates) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const { url, events, active, secret } = updates;
      const eventsJson = events ? JSON.stringify(events) : null;

      const fields = [];
      const values = [];

      if (url !== undefined) {
        fields.push('url = ?');
        values.push(url);
      }
      if (events !== undefined) {
        fields.push('events = ?');
        values.push(eventsJson);
      }
      if (active !== undefined) {
        fields.push('active = ?');
        values.push(active ? 1 : 0);
      }
      if (secret !== undefined) {
        fields.push('secret = ?');
        values.push(secret);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(webhookId);

      db.run(
        `UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`,
        values,
        (err) => {
          if (err) {
            logger.error('Failed to update webhook', { error: err.message, webhookId });
            reject(err);
          } else {
            logger.info('Webhook updated', { webhookId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();

      db.serialize(() => {
        // Delete webhook events
        db.run(`DELETE FROM webhook_events WHERE webhook_id = ?`, [webhookId]);

        // Delete webhook
        db.run(`DELETE FROM webhooks WHERE id = ?`, [webhookId], (err) => {
          if (err) {
            logger.error('Failed to delete webhook', { error: err.message, webhookId });
            reject(err);
          } else {
            logger.info('Webhook deleted', { webhookId });
            resolve();
          }
        });
      });
    });
  }

  /**
   * Trigger webhook event
   */
  async triggerEvent(eventType, payload, userId = null) {
    try {
      const db = DatabaseManager.getInstance();

      // Find webhooks subscribed to this event
      const query = userId
        ? `SELECT * FROM webhooks WHERE user_id = ? AND active = 1 AND events LIKE ?`
        : `SELECT * FROM webhooks WHERE active = 1 AND events LIKE ?`;

      const params = userId
        ? [userId, `%"${eventType}"%`]
        : [`%"${eventType}"%`];

      db.all(query, params, async (err, webhooks) => {
        if (err) {
          logger.error('Failed to find webhooks for event', { error: err.message, eventType });
          return;
        }

        for (const webhook of webhooks || []) {
          await this.queueWebhookEvent(webhook.id, eventType, payload);
        }
      });
    } catch (error) {
      logger.error('Failed to trigger webhook event', { error: error.message, eventType });
    }
  }

  /**
   * Queue webhook event for delivery
   */
  async queueWebhookEvent(webhookId, eventType, payload) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const payloadJson = JSON.stringify(payload);

      db.run(
        `INSERT INTO webhook_events (webhook_id, event_type, payload) VALUES (?, ?, ?)`,
        [webhookId, eventType, payloadJson],
        async (err) => {
          if (err) {
            logger.error('Failed to queue webhook event', { error: err.message, webhookId });
            reject(err);
          } else {
            // Attempt immediate delivery
            await this.deliverWebhookEvent(webhookId, eventType, payload);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Deliver webhook event
   */
  async deliverWebhookEvent(webhookId, eventType, payload, attempt = 1) {
    try {
      const webhook = await this.getWebhook(webhookId);
      if (!webhook) {
        logger.warn('Webhook not found', { webhookId });
        return;
      }

      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': new Date().toISOString()
      };

      // Add signature if secret is configured
      if (webhook.secret) {
        const crypto = require('crypto');
        const signature = crypto
          .createHmac('sha256', webhook.secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const response = await axios.post(webhook.url, payload, {
        headers,
        timeout: webhook.timeout_seconds * 1000
      });

      // Mark as delivered
      await this.updateWebhookEventStatus(webhookId, eventType, 'delivered', response.status, response.data);
      logger.info('Webhook delivered successfully', { webhookId, eventType, statusCode: response.status });
    } catch (error) {
      logger.warn('Webhook delivery failed', {
        webhookId,
        eventType,
        attempt,
        error: error.message
      });

      // Retry if attempts remaining
      const webhook = await this.getWebhook(webhookId);
      if (attempt < webhook.retry_count) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        setTimeout(() => {
          this.deliverWebhookEvent(webhookId, eventType, payload, attempt + 1);
        }, delay);
      } else {
        // Mark as failed
        await this.updateWebhookEventStatus(
          webhookId,
          eventType,
          'failed',
          error.response?.status || 0,
          error.message
        );
      }
    }
  }

  /**
   * Update webhook event status
   */
  async updateWebhookEventStatus(webhookId, eventType, status, responseCode = null, responseBody = null) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.run(
        `UPDATE webhook_events 
         SET status = ?, response_code = ?, response_body = ?, attempts = attempts + 1, last_attempt = CURRENT_TIMESTAMP
         WHERE webhook_id = ? AND event_type = ? AND status = 'pending'
         LIMIT 1`,
        [status, responseCode, responseBody, webhookId, eventType],
        (err) => {
          if (err) {
            logger.error('Failed to update webhook event status', { error: err.message });
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get webhook events
   */
  async getWebhookEvents(webhookId, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.all(
        `SELECT id, event_type, status, response_code, attempts, created_at 
         FROM webhook_events 
         WHERE webhook_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [webhookId, limit, offset],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get webhook events', { error: err.message });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Retry failed webhook events
   */
  async retryFailedEvents(webhookId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      db.all(
        `SELECT id, event_type, payload FROM webhook_events 
         WHERE webhook_id = ? AND status = 'failed'`,
        [webhookId],
        async (err, events) => {
          if (err) {
            logger.error('Failed to get failed events', { error: err.message });
            reject(err);
          } else {
            let retried = 0;
            for (const event of events || []) {
              await this.deliverWebhookEvent(webhookId, event.event_type, JSON.parse(event.payload));
              retried++;
            }
            logger.info('Failed webhook events retried', { webhookId, count: retried });
            resolve(retried);
          }
        }
      );
    });
  }

  /**
   * Cleanup old webhook events
   */
  async cleanupOldEvents(daysOld = 30) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

      db.run(
        `DELETE FROM webhook_events WHERE created_at < ? AND status IN ('delivered', 'failed')`,
        [cutoffDate],
        function(err) {
          if (err) {
            logger.error('Failed to cleanup webhook events', { error: err.message });
            reject(err);
          } else {
            logger.info('Old webhook events cleaned up', { deletedCount: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = WebhookManager;
