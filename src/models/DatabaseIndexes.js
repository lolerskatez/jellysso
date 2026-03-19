/**
 * Database indexing strategy for performance optimization
 * Creates indexes on frequently queried columns
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class DatabaseIndexes {
  /**
   * Initialize all database indexes
   */
  static async initializeIndexes() {
    try {
      logger.info('Creating database indexes for performance optimization');

      // Audit logs indexes
      await this.createIndex('audit_logs', 'idx_audit_userId', 'userId');
      await this.createIndex('audit_logs', 'idx_audit_action', 'action');
      await this.createIndex('audit_logs', 'idx_audit_timestamp', 'timestamp');
      await this.createIndex('audit_logs', 'idx_audit_status', 'status');
      await this.createIndex('audit_logs', 'idx_audit_userId_timestamp', ['userId', 'timestamp']);

      // User policies indexes
      await this.createIndex('user_policies', 'idx_user_tier', 'tier');
      await this.createIndex('user_policies', 'idx_user_accountEnabled', 'accountEnabled');
      await this.createIndex('user_policies', 'idx_user_expiresAt', 'expiresAt');

      // Session activity indexes
      await this.createIndex('session_activity', 'idx_session_userId', 'user_id');
      await this.createIndex('session_activity', 'idx_session_loginTime', 'login_time');
      await this.createIndex('session_activity', 'idx_session_logoutTime', 'logout_time');
      await this.createIndex('session_activity', 'idx_session_userId_loginTime', ['user_id', 'login_time']);

      // Login attempts indexes
      await this.createIndex('login_attempts', 'idx_login_username', 'username');
      await this.createIndex('login_attempts', 'idx_login_ipAddress', 'ip_address');
      await this.createIndex('login_attempts', 'idx_login_timestamp', 'timestamp');
      await this.createIndex('login_attempts', 'idx_login_username_timestamp', ['username', 'timestamp']);

      // Account lockouts indexes
      await this.createIndex('account_lockouts', 'idx_lockout_username', 'username');
      await this.createIndex('account_lockouts', 'idx_lockout_lockedUntil', 'locked_until');

      // Password history indexes
      await this.createIndex('password_history', 'idx_pwd_userId', 'user_id');
      await this.createIndex('password_history', 'idx_pwd_changedAt', 'changed_at');

      // API keys indexes
      await this.createIndex('api_keys', 'idx_apikey_userId', 'user_id');
      await this.createIndex('api_keys', 'idx_apikey_expiresAt', 'expires_at');
      await this.createIndex('api_keys', 'idx_apikey_revoked', 'revoked');

      // Webhook indexes
      await this.createIndex('webhooks', 'idx_webhook_userId', 'user_id');
      await this.createIndex('webhooks', 'idx_webhook_enabled', 'enabled');

      // Webhook events indexes
      await this.createIndex('webhook_events', 'idx_webhook_event_webhookId', 'webhook_id');
      await this.createIndex('webhook_events', 'idx_webhook_event_timestamp', 'timestamp');
      await this.createIndex('webhook_events', 'idx_webhook_event_status', 'status');

      // Settings indexes
      await this.createIndex('settings', 'idx_settings_key', 'key');

      logger.info('Database indexes created successfully');
    } catch (error) {
      logger.error('Error creating database indexes', { error: error.message });
    }
  }

  /**
   * Create an index if it doesn't already exist
   * @param {string} tableName - Table name
   * @param {string} indexName - Index name
   * @param {string|array} columns - Column name or array of column names
   */
  static async createIndex(tableName, indexName, columns) {
    try {
      const columnStr = Array.isArray(columns) ? columns.join(', ') : columns;
      const sql = `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnStr})`;
      
      await new Promise((resolve, reject) => {
        DatabaseManager.db.run(sql, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      logger.debug(`Index created: ${indexName} on ${tableName}`);
    } catch (error) {
      // Index may already exist or other non-critical error
      logger.debug(`Could not create index ${indexName}: ${error.message}`);
    }
  }

  /**
   * Analyze query performance (SQLite EXPLAIN QUERY PLAN)
   * @param {string} sql - SQL query to analyze
   * @returns {Promise<array>} - Query plan
   */
  static async analyzeQuery(sql) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(`EXPLAIN QUERY PLAN ${sql}`, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Optimize database (VACUUM and ANALYZE)
   */
  static async optimizeDatabase() {
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
}

module.exports = DatabaseIndexes;
