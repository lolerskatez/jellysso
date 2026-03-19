/**
 * API Key Manager
 * Manages API keys for programmatic access
 */

const DatabaseManager = require('./DatabaseManager');
const crypto = require('crypto');
const logger = require('../utils/logger');

class APIKeyManager {
  static instance = null;

  static getInstance() {
    if (!APIKeyManager.instance) {
      APIKeyManager.instance = new APIKeyManager();
      APIKeyManager.instance.initializeSchema();
    }
    return APIKeyManager.instance;
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const dbManager = DatabaseManager.getInstance();
    const db = dbManager.db;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // API Keys table
        db.run(`
          CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            permissions TEXT,
            last_used DATETIME,
            last_ip TEXT,
            request_count INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create api_keys table', { error: err.message });
            reject(err);
          }
        });

        // API Key usage log
        db.run(`
          CREATE TABLE IF NOT EXISTS api_key_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create api_key_usage table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)
        `);

        db.run(`
          CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_id ON api_key_usage(api_key_id)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            logger.info('API Key schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Generate new API key
   */
  async createAPIKey(userId, name, permissions = [], expiresAt = null) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      
      // Generate random key
      const key = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(key).digest('hex');
      const permissionsJson = JSON.stringify(permissions);

      db.run(
        `INSERT INTO api_keys (user_id, key_hash, name, permissions, expires_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, keyHash, name, permissionsJson, expiresAt],
        function(err) {
          if (err) {
            logger.error('Failed to create API key', { error: err.message, userId });
            reject(err);
          } else {
            logger.info('API key created', { keyId: this.lastID, userId, name });
            resolve({
              id: this.lastID,
              key: key, // Only returned once at creation
              name,
              permissions,
              createdAt: new Date().toISOString()
            });
          }
        }
      );
    });
  }

  /**
   * Validate API key
   */
  async validateAPIKey(key) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      const keyHash = crypto.createHash('sha256').update(key).digest('hex');

      db.get(
        `SELECT id, user_id, name, permissions, active, expires_at FROM api_keys 
         WHERE key_hash = ?`,
        [keyHash],
        (err, row) => {
          if (err) {
            logger.error('Failed to validate API key', { error: err.message });
            reject(err);
          } else if (!row) {
            resolve(null);
          } else if (!row.active) {
            resolve(null);
          } else if (row.expires_at && new Date(row.expires_at) < new Date()) {
            resolve(null);
          } else {
            resolve({
              id: row.id,
              userId: row.user_id,
              name: row.name,
              permissions: JSON.parse(row.permissions || '[]')
            });
          }
        }
      );
    });
  }

  /**
   * Get user's API keys
   */
  async getUserAPIKeys(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      db.all(
        `SELECT id, name, permissions, last_used, last_ip, request_count, active, created_at, expires_at 
         FROM api_keys 
         WHERE user_id = ? 
         ORDER BY created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get user API keys', { error: err.message, userId });
            reject(err);
          } else {
            const keys = (rows || []).map(row => ({
              ...row,
              permissions: JSON.parse(row.permissions || '[]')
            }));
            resolve(keys);
          }
        }
      );
    });
  }

  /**
   * Get API key by ID
   */
  async getAPIKey(keyId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      db.get(
        `SELECT id, user_id, name, permissions, last_used, last_ip, request_count, active, created_at, expires_at 
         FROM api_keys 
         WHERE id = ?`,
        [keyId],
        (err, row) => {
          if (err) {
            logger.error('Failed to get API key', { error: err.message, keyId });
            reject(err);
          } else if (row) {
            resolve({
              ...row,
              permissions: JSON.parse(row.permissions || '[]')
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Update API key
   */
  async updateAPIKey(keyId, updates) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      const { name, permissions, active, expiresAt } = updates;

      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push('name = ?');
        values.push(name);
      }
      if (permissions !== undefined) {
        fields.push('permissions = ?');
        values.push(JSON.stringify(permissions));
      }
      if (active !== undefined) {
        fields.push('active = ?');
        values.push(active ? 1 : 0);
      }
      if (expiresAt !== undefined) {
        fields.push('expires_at = ?');
        values.push(expiresAt);
      }

      if (fields.length === 0) {
        resolve();
        return;
      }

      values.push(keyId);

      db.run(
        `UPDATE api_keys SET ${fields.join(', ')} WHERE id = ?`,
        values,
        (err) => {
          if (err) {
            logger.error('Failed to update API key', { error: err.message, keyId });
            reject(err);
          } else {
            logger.info('API key updated', { keyId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Revoke API key
   */
  async revokeAPIKey(keyId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      db.run(
        `UPDATE api_keys SET active = 0 WHERE id = ?`,
        [keyId],
        (err) => {
          if (err) {
            logger.error('Failed to revoke API key', { error: err.message, keyId });
            reject(err);
          } else {
            logger.info('API key revoked', { keyId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Delete API key
   */
  async deleteAPIKey(keyId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;

      db.serialize(() => {
        // Delete usage logs
        db.run(`DELETE FROM api_key_usage WHERE api_key_id = ?`, [keyId]);

        // Delete key
        db.run(`DELETE FROM api_keys WHERE id = ?`, [keyId], (err) => {
          if (err) {
            logger.error('Failed to delete API key', { error: err.message, keyId });
            reject(err);
          } else {
            logger.info('API key deleted', { keyId });
            resolve();
          }
        });
      });
    });
  }

  /**
   * Record API key usage
   */
  async recordUsage(keyId, endpoint, method, statusCode, ip, userAgent) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;

      db.serialize(() => {
        // Insert usage log
        db.run(
          `INSERT INTO api_key_usage (api_key_id, endpoint, method, status_code, ip_address, user_agent) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [keyId, endpoint, method, statusCode, ip, userAgent]
        );

        // Update last used and request count
        db.run(
          `UPDATE api_keys SET last_used = CURRENT_TIMESTAMP, last_ip = ?, request_count = request_count + 1 
           WHERE id = ?`,
          [ip, keyId],
          (err) => {
            if (err) {
              logger.error('Failed to record API key usage', { error: err.message, keyId });
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    });
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(keyId, days = 30) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      db.all(
        `SELECT method, status_code, COUNT(*) as count 
         FROM api_key_usage 
         WHERE api_key_id = ? AND created_at > ?
         GROUP BY method, status_code`,
        [keyId, cutoffDate],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get API key usage stats', { error: err.message, keyId });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get API key usage log
   */
  async getUsageLog(keyId, limit = 50, offset = 0) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;
      db.all(
        `SELECT endpoint, method, status_code, ip_address, created_at 
         FROM api_key_usage 
         WHERE api_key_id = ? 
         ORDER BY created_at DESC 
         LIMIT ? OFFSET ?`,
        [keyId, limit, offset],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get API key usage log', { error: err.message, keyId });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Cleanup expired API keys
   */
  async cleanupExpiredKeys() {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance().db;

      db.serialize(() => {
        // Get expired keys
        db.all(
          `SELECT id FROM api_keys WHERE expires_at < CURRENT_TIMESTAMP`,
          async (err, rows) => {
            if (err) {
              logger.error('Failed to cleanup expired keys', { error: err.message });
              reject(err);
            } else {
              for (const row of rows || []) {
                await this.deleteAPIKey(row.id);
              }
              logger.info('Expired API keys cleaned up', { count: rows?.length || 0 });
              resolve(rows?.length || 0);
            }
          }
        );
      });
    });
  }

  /**
   * Cleanup old usage logs
   */
  async cleanupUsageLogs(daysOld = 90) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.getInstance();
      const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

      db.run(
        `DELETE FROM api_key_usage WHERE created_at < ?`,
        [cutoffDate],
        function(err) {
          if (err) {
            logger.error('Failed to cleanup usage logs', { error: err.message });
            reject(err);
          } else {
            logger.info('Old API key usage logs cleaned up', { deletedCount: this.changes });
            resolve(this.changes);
          }
        }
      );
    });
  }
}

module.exports = APIKeyManager;
