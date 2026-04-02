const DatabaseManager = require('./DatabaseManager');
const JellyfinAPI = require('./JellyfinAPI');
const SetupManager = require('./SetupManager');
const logger = require('../utils/logger');

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
    'single': {
      name: 'Single',
      maxStreams: 1,
      description: 'Single stream only'
    },
    'standard': {
      name: 'Standard',
      maxStreams: 2,
      description: 'Two simultaneous streams'
    },
    'unlimited': {
      name: 'Unlimited',
      maxStreams: 999,
      description: 'Unlimited streams'
    },
    'admin': {
      name: 'Admin',
      maxStreams: 999,
      description: 'Administrator access'
    }
  };

  /**
   * Initialize database schema for policies
   */
  static async initializeSchema() {
    try {
      // Tiers table (source of truth for tier definitions)
      await DatabaseManager.query(`
        CREATE TABLE IF NOT EXISTS tiers (
          id TEXT PRIMARY KEY,
          displayName TEXT NOT NULL,
          maxConcurrentStreams INTEGER NOT NULL DEFAULT 1,
          badgeColor TEXT NOT NULL DEFAULT '#95a5a6',
          sortOrder INTEGER NOT NULL DEFAULT 0,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed built-in tiers — INSERT OR IGNORE is idempotent
      const seedTiers = [
        { id: 'single',    displayName: 'Single',    maxConcurrentStreams: 1,   badgeColor: '#95a5a6', sortOrder: 0 },
        { id: 'standard',  displayName: 'Standard',  maxConcurrentStreams: 2,   badgeColor: '#3498db', sortOrder: 1 },
        { id: 'unlimited', displayName: 'Unlimited', maxConcurrentStreams: 999, badgeColor: '#27ae60', sortOrder: 2 },
        { id: 'admin',     displayName: 'Admin',     maxConcurrentStreams: 999, badgeColor: '#f39c12', sortOrder: 3 }
      ];
      for (const t of seedTiers) {
        await DatabaseManager.query(
          `INSERT OR IGNORE INTO tiers (id, displayName, maxConcurrentStreams, badgeColor, sortOrder)
           VALUES (?, ?, ?, ?, ?)`,
          [t.id, t.displayName, t.maxConcurrentStreams, t.badgeColor, t.sortOrder]
        );
      }

      // User policies table
      await DatabaseManager.query(`
        CREATE TABLE IF NOT EXISTS user_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT UNIQUE NOT NULL,
          tier TEXT NOT NULL DEFAULT 'single',
          maxConcurrentStreams INTEGER NOT NULL DEFAULT 1,
          accountEnabled INTEGER NOT NULL DEFAULT 1,
          expiresAt TEXT,
          isAdmin INTEGER NOT NULL DEFAULT 0,
          allowDownloads INTEGER NOT NULL DEFAULT 1,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Policy enforcement audit table
      await DatabaseManager.query(`
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

      // Device whitelist table
      await DatabaseManager.query(`
        CREATE TABLE IF NOT EXISTS device_whitelist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT NOT NULL,
          deviceId TEXT NOT NULL,
          deviceName TEXT,
          deviceType TEXT,
          addedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(userId, deviceId)
        )
      `);

      logger.info('âœ… Policy schema initialized');
    } catch (error) {
      logger.error('Error initializing policy schema:', error);
    }
  }

  /**
   * Sync admin status from Jellyfin to database
   * Called during login to ensure consistency
   */
  static async syncAdminStatusFromJellyfin(userId, jellyfinUser) {
    try {
      if (!jellyfinUser || !jellyfinUser.Policy) return;

      const isAdmin = jellyfinUser.Policy.IsAdministrator ? 1 : 0;
      
      // Ensure policy row exists
      await this.getUserPolicy(userId);
      
      // Update admin status from Jellyfin
      await DatabaseManager.query(
        'UPDATE user_policies SET isAdmin = ? WHERE userId = ?',
        [isAdmin, userId]
      );

      logger.info(`Synced admin status for user ${userId}: ${isAdmin === 1}`);
      return { success: true, synced: true };
    } catch (error) {
      logger.error('Error syncing admin status from Jellyfin:', error);
      return { success: false, synced: false };
    }
  }

  /**
   * Migrate existing admin users from Jellyfin to database
   * Run once during startup to populate admin status for existing users
   */
  static async migrateAdminUsersFromJellyfin(jellyfinApi) {
    try {
      logger.info('Starting migration of admin users from Jellyfin...');
      
      if (!jellyfinApi) {
        logger.warn('JellyfinAPI not available for admin user migration');
        return { success: false, migrateCount: 0, reason: 'API unavailable' };
      }

      const users = await jellyfinApi.getUsers();
      let migratedCount = 0;

      for (const user of users) {
        if (user.Policy?.IsAdministrator) {
          // Ensure user has a policy record
          await this.getUserPolicy(user.Id);
          
          // Set admin flag
          await DatabaseManager.query(
            'UPDATE user_policies SET isAdmin = 1 WHERE userId = ?',
            [user.Id]
          );
          
          migratedCount++;
          logger.info(`Migrated admin user: ${user.Name} (${user.Id})`);
        }
      }

      logger.info(`✅ Admin user migration complete: ${migratedCount} users migrated`);
      return { success: true, migratedCount };
    } catch (error) {
      logger.error('Error during admin user migration:', error);
      return { success: false, migratedCount: 0, error: error.message };
    }
  }

  /**
   * Get user policy (creates default if doesn't exist)
   */
  static async getUserPolicy(userId) {
    try {
      let policy = await DatabaseManager.queryOne(
        'SELECT * FROM user_policies WHERE userId = ?',
        [userId]
      );

      // Create default policy for new users
      if (!policy) {
        const defaultTier = 'single';
        const tierConfig = await this.getTier(defaultTier);
        const maxStreams = tierConfig ? tierConfig.maxConcurrentStreams : 1;

        await DatabaseManager.query(
          `INSERT INTO user_policies (userId, tier, maxConcurrentStreams, accountEnabled)
           VALUES (?, ?, ?, 1)`,
          [userId, defaultTier, maxStreams]
        );

        policy = await DatabaseManager.queryOne(
          'SELECT * FROM user_policies WHERE userId = ?',
          [userId]
        );
      }

      return policy;
    } catch (error) {
      logger.error('Error getting user policy:', error);
      throw error;
    }
  }

  /**
   * Set user to a tier
   */
  static async setUserTier(userId, tierId) {
    // Look up tier from DB; fall back to static definition for resilience
    let tierConfig = await this.getTier(tierId);
    if (!tierConfig) {
      const staticTier = this.TIERS[tierId];
      if (!staticTier) {
        throw new Error(`Invalid tier: ${tierId}. Must be one of the configured tiers.`);
      }
      tierConfig = { maxConcurrentStreams: staticTier.maxStreams };
    }

    try {
      await this.getUserPolicy(userId); // ensure row exists

      await DatabaseManager.query(
        `UPDATE user_policies 
         SET tier = ?, maxConcurrentStreams = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE userId = ?`,
        [tierId, tierConfig.maxConcurrentStreams, userId]
      );

      // Propagate stream limit to Jellyfin's native SimultaneousStreamLimit so
      // enforcement happens inside Jellyfin itself (not just soft-checked here).
      try {
        const jellyfin = new JellyfinAPI(
          SetupManager.getConfig().jellyfinUrl,
          SetupManager.getConfig().apiKey
        );
        await jellyfin.updateUserPolicy(userId, {
          SimultaneousStreamLimit: tierConfig.maxConcurrentStreams
        });
      } catch (jellyfinError) {
        logger.error(`Warning: Could not update Jellyfin stream limit for user ${userId}:`, jellyfinError.message);
        // Local DB tier was saved; Jellyfin update failure is non-fatal.
      }

      return { success: true, tier: tierId, maxStreams: tierConfig.maxConcurrentStreams };
    } catch (error) {
      logger.error('Error setting user tier:', error);
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

      // Check: Stream count limit
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

      // All checks passed
      await this.logPolicyAudit(userId, 'STREAM_START', 'ALLOWED', 'Stream started', deviceId, sessionId, ipAddress);
      return { allowed: true };

    } catch (error) {
      logger.error('Error checking stream permission:', error);
      return { allowed: false, reason: 'policy_check_error' };
    }
  }

  /**
   * Log policy audit event
   */
  static async logPolicyAudit(userId, policyType, action, reason = null, deviceId = null, sessionId = null, ipAddress = null) {
    try {
      await DatabaseManager.query(
        `INSERT INTO policy_audit (userId, policyType, action, reason, deviceId, sessionId, ipAddress)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, policyType, action, reason, deviceId, sessionId, ipAddress]
      );
    } catch (error) {
      logger.error('Error logging policy audit:', error);
    }
  }

  /**
   * Get policy audit log for user
   */
  static async getAuditLog(userId, limit = 100) {
    try {
      const logs = await DatabaseManager.query(
        `SELECT * FROM policy_audit WHERE userId = ?
         ORDER BY createdAt DESC LIMIT ?`,
        [userId, limit]
      );
      return logs || [];
    } catch (error) {
      logger.error('Error getting audit log:', error);
      return [];
    }
  }

  /**
   * Get all policies for admin view
   */
  static async getAllPolicies() {
    try {
      const policies = await DatabaseManager.query(
        `SELECT p.*, COUNT(DISTINCT dw.deviceId) as whitelistedDeviceCount
         FROM user_policies p
         LEFT JOIN device_whitelist dw ON p.userId = dw.userId
         GROUP BY p.userId
         ORDER BY p.updatedAt DESC`
      );
      return policies || [];
    } catch (error) {
      logger.error('Error getting all policies:', error);
      return [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tier CRUD
  // ───────────────────────────────────────────────────────────────────────────

  static async getAllTiers() {
    try {
      const tiers = await DatabaseManager.query(
        'SELECT * FROM tiers ORDER BY sortOrder ASC, displayName ASC'
      );
      return tiers || [];
    } catch (error) {
      logger.error('Error getting tiers:', error);
      return [];
    }
  }

  static async getTier(id) {
    try {
      return await DatabaseManager.queryOne('SELECT * FROM tiers WHERE id = ?', [id]);
    } catch (error) {
      logger.error('Error getting tier:', error);
      return null;
    }
  }

  static async createTier({ id, displayName, maxConcurrentStreams, badgeColor = '#95a5a6', sortOrder = 0 }) {
    if (!id || !displayName) throw new Error('Tier id and displayName are required');
    if (!/^[a-z0-9_-]+$/.test(id)) throw new Error('Tier id must be lowercase alphanumeric, hyphens, or underscores only');
    const streams = parseInt(maxConcurrentStreams);
    if (isNaN(streams) || streams < 1) throw new Error('maxConcurrentStreams must be a positive integer');

    const existing = await this.getTier(id);
    if (existing) throw new Error(`Tier "${id}" already exists`);

    await DatabaseManager.query(
      `INSERT INTO tiers (id, displayName, maxConcurrentStreams, badgeColor, sortOrder)
       VALUES (?, ?, ?, ?, ?)`,
      [id, displayName, streams, badgeColor, sortOrder]
    );
    return this.getTier(id);
  }

  static async updateTier(id, { displayName, maxConcurrentStreams, badgeColor, sortOrder }) {
    const existing = await this.getTier(id);
    if (!existing) throw new Error(`Tier "${id}" not found`);

    const streams = maxConcurrentStreams !== undefined ? parseInt(maxConcurrentStreams) : existing.maxConcurrentStreams;
    if (isNaN(streams) || streams < 1) throw new Error('maxConcurrentStreams must be a positive integer');

    await DatabaseManager.query(
      `UPDATE tiers SET
         displayName = ?,
         maxConcurrentStreams = ?,
         badgeColor = ?,
         sortOrder = ?,
         updatedAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        displayName !== undefined ? displayName : existing.displayName,
        streams,
        badgeColor !== undefined ? badgeColor : existing.badgeColor,
        sortOrder !== undefined ? sortOrder : existing.sortOrder,
        id
      ]
    );

    // If stream limit changed, bulk-update all users on this tier
    if (streams !== existing.maxConcurrentStreams) {
      await DatabaseManager.query(
        `UPDATE user_policies SET maxConcurrentStreams = ?, updatedAt = CURRENT_TIMESTAMP WHERE tier = ?`,
        [streams, id]
      );
      // Propagate to Jellyfin for each affected user (non-fatal on failure)
      try {
        const usersOnTier = await DatabaseManager.query(
          'SELECT userId FROM user_policies WHERE tier = ?', [id]
        );
        if (usersOnTier && usersOnTier.length > 0) {
          const jellyfin = new JellyfinAPI(
            SetupManager.getConfig().jellyfinUrl,
            SetupManager.getConfig().apiKey
          );
          await Promise.allSettled(
            usersOnTier.map(u => jellyfin.updateUserPolicy(u.userId, { SimultaneousStreamLimit: streams }))
          );
        }
      } catch (jellyfinError) {
        logger.error('Warning: Could not propagate stream limit to Jellyfin:', jellyfinError.message);
      }
    }

    return this.getTier(id);
  }

  static async deleteTier(id) {
    const existing = await this.getTier(id);
    if (!existing) throw new Error(`Tier "${id}" not found`);

    const usersRow = await DatabaseManager.queryOne(
      'SELECT COUNT(*) as count FROM user_policies WHERE tier = ?', [id]
    );
    const userCount = usersRow ? usersRow.count : 0;
    if (userCount > 0) {
      throw new Error(`Cannot delete tier "${id}": ${userCount} user(s) are currently assigned to it`);
    }

    await DatabaseManager.query('DELETE FROM tiers WHERE id = ?', [id]);
    return { success: true, message: `Tier "${id}" deleted` };
  }

  static async getUsersOnTier(tierId) {
    try {
      const row = await DatabaseManager.queryOne(
        'SELECT COUNT(*) as count FROM user_policies WHERE tier = ?', [tierId]
      );
      return row ? row.count : 0;
    } catch (error) {
      return 0;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Account Status
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Enable or disable a user's account, and optionally set/clear an expiry.
   * expiresAt: ISO datetime string to set, null to clear, undefined to leave unchanged.
   */
  static async setAdminStatus(userId, isAdmin) {
    try {
      await this.getUserPolicy(userId); // ensure row exists

      await DatabaseManager.query(
        'UPDATE user_policies SET isAdmin = ? WHERE userId = ?',
        [isAdmin ? 1 : 0, userId]
      );

      // Sync to Jellyfin
      await JellyfinAPI.getAdminInstance().updateUserPolicy(userId, {
        IsAdministrator: isAdmin ? true : false
      });

      await this.logPolicyAudit(userId, 'ADMIN_STATUS', isAdmin ? 'GRANTED' : 'REVOKED');
      logger.info(`User ${userId} admin status: ${isAdmin}`);
      return { success: true, isAdmin };
    } catch (error) {
      logger.error('Error setting admin status:', error);
      throw error;
    }
  }

  static async setDownloadsAllowed(userId, allowed) {
    try {
      await this.getUserPolicy(userId); // ensure row exists

      await DatabaseManager.query(
        'UPDATE user_policies SET allowDownloads = ? WHERE userId = ?',
        [allowed ? 1 : 0, userId]
      );

      // Sync to Jellyfin
      await JellyfinAPI.getAdminInstance().updateUserPolicy(userId, {
        EnableContentDownloading: allowed ? true : false
      });

      await this.logPolicyAudit(userId, 'DOWNLOADS', allowed ? 'ENABLED' : 'DISABLED');
      logger.info(`User ${userId} downloads: ${allowed}`);
      return { success: true, allowed };
    } catch (error) {
      logger.error('Error setting downloads:', error);
      throw error;
    }
  }

  static async setAccountStatus(userId, enabled, expiresAt = undefined) {
    await this.getUserPolicy(userId); // ensure row exists

    const setClauses = ['accountEnabled = ?', 'updatedAt = CURRENT_TIMESTAMP'];
    const params = [enabled ? 1 : 0];

    if (expiresAt !== undefined) {
      setClauses.push('expiresAt = ?');
      params.push(expiresAt); // null clears it, ISO string sets it
    }

    params.push(userId);
    await DatabaseManager.query(
      `UPDATE user_policies SET ${setClauses.join(', ')} WHERE userId = ?`,
      params
    );

    return { success: true, accountEnabled: !!enabled };
  }

  /**
   * Check if an account is allowed to log in.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  static async checkAccountAccess(userId) {
    try {
      const policy = await DatabaseManager.queryOne(
        'SELECT accountEnabled, expiresAt FROM user_policies WHERE userId = ?',
        [userId]
      );

      // No policy row means new/untracked user — allow by default
      if (!policy) return { allowed: true };

      if (!policy.accountEnabled) {
        return { allowed: false, reason: 'Your account has been suspended. Please contact an administrator.' };
      }

      if (policy.expiresAt) {
        const expiry = new Date(policy.expiresAt);
        if (!isNaN(expiry.getTime()) && expiry < new Date()) {
          return { allowed: false, reason: 'Your account access has expired. Please contact an administrator.' };
        }
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error checking account access:', error);
      return { allowed: false, reason: 'Account access check failed. Please try again later.' };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Batch / Optimized Queries
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get user counts for all tiers in a single query (avoids N+1 problem)
   * @returns {Promise<object>} - { tierId: count, ... }
   */
  static async getUserCountsByTier() {
    try {
      const rows = await DatabaseManager.query(
        `SELECT tier, COUNT(*) as count FROM user_policies GROUP BY tier`
      );
      const counts = {};
      rows.forEach(row => { counts[row.tier] = row.count; });
      return counts;
    } catch (error) {
      logger.error('Error getting user counts by tier:', error);
      return {};
    }
  }

  /**
   * Get all tiers with user counts in a single operation
   * @returns {Promise<array>}
   */
  static async getAllTiersWithCounts() {
    try {
      const tiers = await DatabaseManager.query(`SELECT * FROM tiers ORDER BY sortOrder`);
      const counts = await this.getUserCountsByTier();
      return tiers.map(tier => ({ ...tier, userCount: counts[tier.id] || 0 }));
    } catch (error) {
      logger.error('Error getting tiers with counts:', error);
      return [];
    }
  }

  /**
   * Get all user policies joined with tier information
   * @returns {Promise<array>}
   */
  static async getAllPoliciesWithTiers() {
    try {
      return await DatabaseManager.query(`
        SELECT
          up.*,
          t.displayName as tierName,
          t.badgeColor
        FROM user_policies up
        LEFT JOIN tiers t ON up.tier = t.id
        ORDER BY up.updatedAt DESC
      `);
    } catch (error) {
      logger.error('Error getting all policies with tiers:', error);
      return [];
    }
  }

  /**
   * Get a single user's policy joined with tier information
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  static async getUserPolicyWithDetails(userId) {
    try {
      return await DatabaseManager.queryOne(`
        SELECT
          up.*,
          t.displayName as tierName,
          t.badgeColor
        FROM user_policies up
        LEFT JOIN tiers t ON up.tier = t.id
        WHERE up.userId = ?
      `, [userId]);
    } catch (error) {
      logger.error('Error getting user policy with details:', error);
      return null;
    }
  }

  /**
   * Get all userId values assigned to a specific tier
   * @param {string} tierId
   * @returns {Promise<array>}
   */
  static async getAllUsersOnTier(tierId) {
    try {
      return await DatabaseManager.query(
        `SELECT userId FROM user_policies WHERE tier = ? ORDER BY updatedAt DESC`,
        [tierId]
      );
    } catch (error) {
      logger.error('Error getting all users on tier:', error);
      return [];
    }
  }

  /**
   * Batch-update multiple users to a new tier
   * @param {Array<{userId: string, tierId: string}>} updates
   * @returns {Promise<number>} number of records updated
   */
  static async batchUpdateUserTiers(updates) {
    try {
      let totalUpdated = 0;
      for (const { userId, tierId } of updates) {
        const tierConfig = await this.getTier(tierId);
        if (!tierConfig) {
          logger.warn(`batchUpdateUserTiers: invalid tier "${tierId}", skipping`);
          continue;
        }
        await DatabaseManager.query(
          `UPDATE user_policies SET tier = ?, maxConcurrentStreams = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?`,
          [tierId, tierConfig.maxConcurrentStreams, userId]
        );
        totalUpdated++;
      }
      return totalUpdated;
    } catch (error) {
      logger.error('Error batch updating user tiers:', error);
      return 0;
    }
  }

  /**
   * Get audit log entries for a user, joined with tier information
   * @param {string} userId
   * @param {number} limit
   * @returns {Promise<array>}
   */
  static async getAuditLogWithUserInfo(userId, limit = 100) {
    try {
      return await DatabaseManager.query(`
        SELECT
          pl.*,
          up.tier,
          t.displayName as tierName
        FROM policy_audit pl
        LEFT JOIN user_policies up ON pl.userId = up.userId
        LEFT JOIN tiers t ON up.tier = t.id
        WHERE pl.userId = ?
        ORDER BY pl.createdAt DESC
        LIMIT ?
      `, [userId, limit]);
    } catch (error) {
      logger.error('Error getting audit log with user info:', error);
      return [];
    }
  }

  /**
   * Aggregate policy statistics for the admin dashboard (single query)
   * @returns {Promise<object>}
   */
  static async getPolicyStatistics() {
    try {
      const stats = await DatabaseManager.queryOne(`
        SELECT
          COUNT(*) as totalUsers,
          COUNT(CASE WHEN accountEnabled = 1 THEN 1 END) as activeUsers,
          COUNT(CASE WHEN accountEnabled = 0 THEN 1 END) as disabledUsers,
          COUNT(CASE WHEN expiresAt IS NOT NULL AND expiresAt < datetime('now') THEN 1 END) as expiredUsers,
          COUNT(DISTINCT tier) as uniqueTiers,
          AVG(maxConcurrentStreams) as avgMaxStreams
        FROM user_policies
      `);
      return stats || {};
    } catch (error) {
      logger.error('Error getting policy statistics:', error);
      return {};
    }
  }

  /**
   * Get per-tier distribution statistics
   * @returns {Promise<array>}
   */
  static async getTierDistribution() {
    try {
      return await DatabaseManager.query(`
        SELECT
          t.id,
          t.displayName,
          COUNT(up.userId) as userCount,
          AVG(up.maxConcurrentStreams) as avgStreams
        FROM tiers t
        LEFT JOIN user_policies up ON t.id = up.tier
        GROUP BY t.id
        ORDER BY t.sortOrder
      `);
    } catch (error) {
      logger.error('Error getting tier distribution:', error);
      return [];
    }
  }

  /**
   * Get all whitelisted devices for a user
   */
  static async getWhitelistedDevices(userId) {
    try {
      return await DatabaseManager.query(
        `SELECT * FROM device_whitelist WHERE userId = ? ORDER BY addedAt DESC`,
        [userId]
      ) || [];
    } catch (error) {
      logger.error('Error getting whitelisted devices:', error);
      return [];
    }
  }

  /**
   * Add a device to a user's whitelist
   */
  static async whitelistDevice(userId, deviceId, deviceName = null, deviceType = null) {
    try {
      await DatabaseManager.query(
        `INSERT OR REPLACE INTO device_whitelist (userId, deviceId, deviceName, deviceType)
         VALUES (?, ?, ?, ?)`,
        [userId, deviceId, deviceName, deviceType]
      );
    } catch (error) {
      logger.error('Error whitelisting device:', error);
      throw error;
    }
  }

  /**
   * Remove a device from a user's whitelist
   */
  static async unwhitelistDevice(userId, deviceId) {
    try {
      await DatabaseManager.query(
        `DELETE FROM device_whitelist WHERE userId = ? AND deviceId = ?`,
        [userId, deviceId]
      );
    } catch (error) {
      logger.error('Error unwhitelisting device:', error);
      throw error;
    }
  }

  /**
   * Get all whitelisted devices across all users (admin view)
   */
  static async getAllWhitelistedDevices() {
    try {
      return await DatabaseManager.query(
        `SELECT * FROM device_whitelist ORDER BY addedAt DESC`
      ) || [];
    } catch (error) {
      logger.error('Error getting all whitelisted devices:', error);
      return [];
    }
  }
}

module.exports = PolicyManager;
