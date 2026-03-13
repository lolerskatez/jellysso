const DatabaseManager = require('./DatabaseManager');

class AuditLogger {
  constructor() {
    // Cache the audit_logging flag to avoid a DB hit on every log call.
    // invalidateCache() should be called whenever the setting is changed.
    this._auditEnabledCache = null;
    this._auditCacheTime = 0;
  }

  /**
   * Read the audit_logging flag from DB, with a 60-second cache.
   * Returns true (enabled) when the setting is missing or set to any value other than 'false'.
   */
  async _isAuditEnabled() {
    const now = Date.now();
    if (this._auditEnabledCache !== null && now - this._auditCacheTime < 60_000) {
      return this._auditEnabledCache;
    }
    try {
      const val = await DatabaseManager.getSetting('audit_logging');
      this._auditEnabledCache = val !== 'false';
    } catch (_) {
      // If we can't read the DB, default to enabled so logs aren't silently dropped
      this._auditEnabledCache = true;
    }
    this._auditCacheTime = now;
    return this._auditEnabledCache;
  }

  /**
   * Invalidate the cached audit_logging flag so the next log() call re-reads from DB.
   * Call this whenever the audit_logging setting is updated.
   */
  invalidateCache() {
    this._auditEnabledCache = null;
    this._auditCacheTime = 0;
  }

  /**
   * Log an audit event
   * @param {string|object} action - The action performed OR an object with {action, userId, resource, details, status, ip}
   * @param {string} userId - The user who performed the action
   * @param {string} resource - The resource affected (e.g., 'user:123', 'settings:system')
   * @param {object} details - Additional details about the action
   * @param {string} status - 'success' or 'failure'
   * @param {string} ip - Client IP address
   */
  async log(action, userId, resource, details = {}, status = 'success', ip = null) {
    // Handle object parameter format for backwards compatibility
    if (typeof action === 'object' && action !== null) {
      const logObj = action;
      action = logObj.action;
      userId = logObj.userId;
      resource = logObj.resource;
      details = logObj.details || {};
      status = logObj.status || 'success';
      ip = logObj.ip;
    }

    // Respect the audit_logging toggle — skip writing if disabled
    const enabled = await this._isAuditEnabled();
    if (!enabled) return false;

    try {
      await DatabaseManager.insertAuditLog(
        action,
        userId || 'system',
        resource,
        status,
        ip,
        details
      );
      return true;
    } catch (error) {
      console.error('Error writing audit log:', error);
      return false;
    }
  }

  /**
   * Log user creation
   */
  async logUserCreate(userId, createdUserName, createdUserEmail, ip) {
    return this.log('USER_CREATE', userId, `user:${createdUserName}`, {
      username: createdUserName,
      email: createdUserEmail
    }, 'success', ip);
  }

  /**
   * Log user update
   */
  async logUserUpdate(userId, targetUserId, changes, ip) {
    return this.log('USER_UPDATE', userId, `user:${targetUserId}`, {
      changes
    }, 'success', ip);
  }

  /**
   * Log user deletion
   */
  async logUserDelete(userId, deletedUserId, deletedUserName, ip) {
    return this.log('USER_DELETE', userId, `user:${deletedUserName}`, {
      userId: deletedUserId
    }, 'success', ip);
  }

  /**
   * Log settings update
   */
  async logSettingsUpdate(userId, settingsType, changes, ip) {
    return this.log('SETTINGS_UPDATE', userId, `settings:${settingsType}`, {
      settingsType,
      changes
    }, 'success', ip);
  }

  /**
   * Log system configuration update
   */
  async logSystemConfigUpdate(userId, changes, ip) {
    return this.log('SYSTEM_CONFIG_UPDATE', userId, 'system:config', {
      changes
    }, 'success', ip);
  }

  /**
   * Log API key regeneration
   */
  async logApiKeyRegenerate(userId, ip) {
    return this.log('API_KEY_REGENERATE', userId, 'system:apikey', {}, 'success', ip);
  }

  /**
   * Log failed login attempt
   */
  async logFailedLogin(username, reason, ip) {
    return this.log('LOGIN_FAILED', 'unknown', `user:${username}`, {
      reason
    }, 'failure', ip);
  }

  /**
   * Log successful login
   */
  async logSuccessfulLogin(userId, ip) {
    return this.log('LOGIN_SUCCESS', userId, `user:${userId}`, {}, 'success', ip);
  }

  /**
   * Log QuickConnect authentication
   */
  async logQuickConnectAuth(userId, ip) {
    return this.log('QUICKCONNECT_AUTH', userId, `quickconnect:${userId}`, {}, 'success', ip);
  }

  /**
   * Get audit logs with filtering
   * @param {object} options - Filter options (action, userId, resource, startDate, endDate, limit)
   */
  async getLogs(options = {}) {
    try {
      return await DatabaseManager.getAuditLogs(options);
    } catch (error) {
      console.error('Error reading audit logs:', error);
      return [];
    }
  }

  /**
   * Clear old audit logs (keep last N days)
   */
  async cleanup(daysToKeep = 90) {
    try {
      const deletedCount = await DatabaseManager.cleanupAuditLogs(daysToKeep);
      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up audit logs:', error);
      return 0;
    }
  }
}

module.exports = new AuditLogger();
