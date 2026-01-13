const DatabaseManager = require('./DatabaseManager');

class AuditLogger {
  /**
   * Log an audit event
   * @param {string} action - The action performed (e.g., 'USER_CREATE', 'SETTINGS_UPDATE')
   * @param {string} userId - The user who performed the action
   * @param {string} resource - The resource affected (e.g., 'user:123', 'settings:system')
   * @param {object} details - Additional details about the action
   * @param {string} status - 'success' or 'failure'
   * @param {string} ip - Client IP address
   */
  async log(action, userId, resource, details = {}, status = 'success', ip = null) {
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
