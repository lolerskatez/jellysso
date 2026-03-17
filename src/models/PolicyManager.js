const DatabaseManager = require('./DatabaseManager');
const JellyfinAPI = require('./JellyfinAPI');
const SetupManager = require('./SetupManager');

/**
 * PolicyManager: Enforces playback policies for users
 * - Stream count limits (tier-based)
 * - Time-based access windows
 * - Device whitelisting
 * - Usage auditing
 */
class PolicyManager {
  /**
   * Predefined policy tiers
   */
  static TIERS = {
    'free': {
      name: 'Free',
      maxStreams: 1,
      description: 'Single stream only'
    },
    'standard': {
      name: 'Standard',
      maxStreams: 2,
      description: 'Two simultaneous streams'
    },
    'premium': {
      name: 'Premium',
      maxStreams: 4,
      description: 'Four simultaneous streams'
    },
    'admin': {
      name: 'Admin',
      maxStreams: 999,
      description: 'Unlimited streams'
    }
  };

  /**
   * Initialize database schema for policies
   */
  static async initializeSchema() {
    try {
      // User policies table
      await DatabaseManager.run(`
        CREATE TABLE IF NOT EXISTS user_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT UNIQUE NOT NULL,
          tier TEXT NOT NULL DEFAULT 'standard',
          maxConcurrentStreams INTEGER NOT NULL DEFAULT 2,
          deviceWhitelistEnabled INTEGER NOT NULL DEFAULT 0,
          enforceAccessSchedule INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Device whitelist table
      await DatabaseManager.run(`
        CREATE TABLE IF NOT EXISTS device_whitelist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT NOT NULL,
          deviceId TEXT NOT NULL,
          deviceName TEXT,
          deviceType TEXT,
          allowedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(userId, deviceId),
          FOREIGN KEY(userId) REFERENCES user_policies(userId)
        )
      `);

      // Policy enforcement audit table
      await DatabaseManager.run(`
        CREATE TABLE IF NOT EXISTS policy_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT NOT NULL,
          policyType TEXT NOT NULL,
          action TEXT NOT NULL,
          reason TEXT,
          deviceId TEXT,
          sessionId TEXT,
          ipAddress TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ Policy schema initialized');
    } catch (error) {
      console.error('Error initializing policy schema:', error);
    }
  }

  /**
   * Get user policy (creates default if doesn't exist)
   */
  static async getUserPolicy(userId) {
    try {
      let policy = await DatabaseManager.get(
        'SELECT * FROM user_policies WHERE userId = ?',
        [userId]
      );

      // Create default policy for new users
      if (!policy) {
        const defaultTier = 'standard';
        const tier = this.TIERS[defaultTier];
        
        await DatabaseManager.run(
          `INSERT INTO user_policies (userId, tier, maxConcurrentStreams)
           VALUES (?, ?, ?)`,
          [userId, defaultTier, tier.maxStreams]
        );

        policy = await DatabaseManager.get(
          'SELECT * FROM user_policies WHERE userId = ?',
          [userId]
        );
      }

      return policy;
    } catch (error) {
      console.error('Error getting user policy:', error);
      throw error;
    }
  }

  /**
   * Set user to a tier
   */
  static async setUserTier(userId, tier) {
    if (!this.TIERS[tier]) {
      throw new Error(`Invalid tier: ${tier}. Must be one of: ${Object.keys(this.TIERS).join(', ')}`);
    }

    try {
      const tierConfig = this.TIERS[tier];
      const policy = await this.getUserPolicy(userId);

      await DatabaseManager.run(
        `UPDATE user_policies 
         SET tier = ?, maxConcurrentStreams = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE userId = ?`,
        [tier, tierConfig.maxStreams, userId]
      );

      return { success: true, tier, maxStreams: tierConfig.maxStreams };
    } catch (error) {
      console.error('Error setting user tier:', error);
      throw error;
    }
  }

  /**
   * Check if user can start a new stream
   * Returns: { allowed: boolean, reason?: string }
   */
  static async canStartStream(userId, sessionId, deviceId, ipAddress) {
    try {
      const policy = await this.getUserPolicy(userId);
      const jellyfin = new JellyfinAPI(
        SetupManager.getConfig().jellyfinUrl,
        SetupManager.getConfig().apiKey
      );

      // Check 1: Stream count limit
      const activeSessions = await jellyfin.getActiveSessions(userId);
      if (activeSessions.length >= policy.maxConcurrentStreams) {
        const reason = `Stream limit reached (${policy.maxConcurrentStreams} max)`;
        await this.logPolicyAudit(userId, 'STREAM_LIMIT', 'DENIED', reason, deviceId, sessionId, ipAddress);
        return {
          allowed: false,
          reason,
          limit: policy.maxConcurrentStreams,
          current: activeSessions.length
        };
      }

      // Check 2: Device whitelist (if enabled)
      if (policy.deviceWhitelistEnabled) {
        const whitelisted = await this.isDeviceWhitelisted(userId, deviceId);
        if (!whitelisted) {
          const reason = 'Device not whitelisted';
          await this.logPolicyAudit(userId, 'DEVICE_RESTRICTION', 'DENIED', reason, deviceId, sessionId, ipAddress);
          return {
            allowed: false,
            reason,
            requiresDeviceApproval: true
          };
        }
      }

      // Check 3: Access schedule (if enabled)
      if (policy.enforceAccessSchedule) {
        const inWindow = await this.isInAccessWindow(userId);
        if (!inWindow) {
          const reason = 'Outside access window';
          await this.logPolicyAudit(userId, 'ACCESS_SCHEDULE', 'DENIED', reason, deviceId, sessionId, ipAddress);
          return {
            allowed: false,
            reason
          };
        }
      }

      // All checks passed
      await this.logPolicyAudit(userId, 'STREAM_START', 'ALLOWED', 'Stream started', deviceId, sessionId, ipAddress);
      return { allowed: true };

    } catch (error) {
      console.error('Error checking stream permission:', error);
      // On error, allow stream (fail-open approach)
      return { allowed: true };
    }
  }

  /**
   * Check if device is whitelisted for user (if whitelist enabled)
   */
  static async isDeviceWhitelisted(userId, deviceId) {
    try {
      const whitelisted = await DatabaseManager.get(
        'SELECT * FROM device_whitelist WHERE userId = ? AND deviceId = ?',
        [userId, deviceId]
      );
      return !!whitelisted;
    } catch (error) {
      console.error('Error checking device whitelist:', error);
      return false;
    }
  }

  /**
   * Add device to whitelist
   */
  static async whitelistDevice(userId, deviceId, deviceName = null, deviceType = null) {
    try {
      await DatabaseManager.run(
        `INSERT OR REPLACE INTO device_whitelist (userId, deviceId, deviceName, deviceType)
         VALUES (?, ?, ?, ?)`,
        [userId, deviceId, deviceName, deviceType]
      );

      return { success: true, message: `Device whitelisted: ${deviceName || deviceId}` };
    } catch (error) {
      console.error('Error whitelisting device:', error);
      throw error;
    }
  }

  /**
   * Remove device from whitelist
   */
  static async unwhitelistDevice(userId, deviceId) {
    try {
      await DatabaseManager.run(
        'DELETE FROM device_whitelist WHERE userId = ? AND deviceId = ?',
        [userId, deviceId]
      );

      return { success: true, message: 'Device removed from whitelist' };
    } catch (error) {
      console.error('Error removing device from whitelist:', error);
      throw error;
    }
  }

  /**
   * Get whitelisted devices for user
   */
  static async getWhitelistedDevices(userId) {
    try {
      const devices = await DatabaseManager.all(
        'SELECT * FROM device_whitelist WHERE userId = ? ORDER BY allowedAt DESC',
        [userId]
      );
      return devices || [];
    } catch (error) {
      console.error('Error getting whitelisted devices:', error);
      return [];
    }
  }

  /**
   * Enable/disable device whitelist for user
   */
  static async setDeviceWhitelistEnabled(userId, enabled) {
    try {
      await DatabaseManager.run(
        `UPDATE user_policies
         SET deviceWhitelistEnabled = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE userId = ?`,
        [enabled ? 1 : 0, userId]
      );

      return {
        success: true,
        deviceWhitelistEnabled: !!enabled,
        message: `Device whitelist ${enabled ? 'enabled' : 'disabled'}`
      };
    } catch (error) {
      console.error('Error setting device whitelist:', error);
      throw error;
    }
  }

  /**
   * Check if current time is within user's access schedule
   * Uses Jellyfin's AccessSchedules via API
   */
  static async isInAccessWindow(userId) {
    try {
      const policy = await this.getUserPolicy(userId);
      
      // If access schedule not enforced, always allow
      if (!policy.enforceAccessSchedule) {
        return true;
      }

      // Get user's Jellyfin access schedule
      const jellyfin = new JellyfinAPI(
        SetupManager.getConfig().jellyfinUrl,
        SetupManager.getConfig().apiKey
      );

      const userInfo = await jellyfin.getUser(userId);
      const schedules = userInfo.Policy?.AccessSchedules || [];

      // If no schedules defined, allow access
      if (!schedules || schedules.length === 0) {
        return true;
      }

      // Check if current time matches any schedule
      const now = new Date();
      const currentDayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
      const currentHour = now.getHours() + now.getMinutes() / 60;

      for (const schedule of schedules) {
        const matches = this.dayMatches(schedule.DayOfWeek, currentDayOfWeek);
        if (matches && currentHour >= schedule.StartHour && currentHour < schedule.EndHour) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error('Error checking access window:', error);
      return true; // Fail-open: allow on error
    }
  }

  /**
   * Check if day matches Jellyfin schedule patterns
   */
  static dayMatches(scheduleDayPattern, currentDay) {
    if (scheduleDayPattern === 'Everyday') return true;
    if (scheduleDayPattern === currentDay) return true;
    
    if (scheduleDayPattern === 'Weekday') {
      return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(currentDay);
    }
    
    if (scheduleDayPattern === 'Weekend') {
      return ['Saturday', 'Sunday'].includes(currentDay);
    }

    return false;
  }

  /**
   * Enable/disable access schedule enforcement
   */
  static async setEnforceAccessSchedule(userId, enforce) {
    try {
      await DatabaseManager.run(
        `UPDATE user_policies
         SET enforceAccessSchedule = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE userId = ?`,
        [enforce ? 1 : 0, userId]
      );

      return {
        success: true,
        enforceAccessSchedule: !!enforce,
        message: `Access schedule enforcement ${enforce ? 'enabled' : 'disabled'}`
      };
    } catch (error) {
      console.error('Error setting access schedule enforcement:', error);
      throw error;
    }
  }

  /**
   * Log policy audit event
   */
  static async logPolicyAudit(userId, policyType, action, reason = null, deviceId = null, sessionId = null, ipAddress = null) {
    try {
      await DatabaseManager.run(
        `INSERT INTO policy_audit (userId, policyType, action, reason, deviceId, sessionId, ipAddress)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, policyType, action, reason, deviceId, sessionId, ipAddress]
      );
    } catch (error) {
      console.error('Error logging policy audit:', error);
    }
  }

  /**
   * Get policy audit log for user
   */
  static async getAuditLog(userId, limit = 100) {
    try {
      const logs = await DatabaseManager.all(
        `SELECT * FROM policy_audit WHERE userId = ?
         ORDER BY createdAt DESC LIMIT ?`,
        [userId, limit]
      );
      return logs || [];
    } catch (error) {
      console.error('Error getting audit log:', error);
      return [];
    }
  }

  /**
   * Get all policies for admin view
   */
  static async getAllPolicies() {
    try {
      const policies = await DatabaseManager.all(
        `SELECT p.*, COUNT(DISTINCT dw.deviceId) as whitelistedDeviceCount
         FROM user_policies p
         LEFT JOIN device_whitelist dw ON p.userId = dw.userId
         GROUP BY p.userId
         ORDER BY p.updatedAt DESC`
      );
      return policies || [];
    } catch (error) {
      console.error('Error getting all policies:', error);
      return [];
    }
  }
}

module.exports = PolicyManager;
