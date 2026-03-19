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
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Migration: add accountEnabled if missing
      const upCols = await DatabaseManager.query('PRAGMA table_info(user_policies)');
      const colNames = (upCols || []).map(c => c.name);
      if (!colNames.includes('accountEnabled')) {
        await DatabaseManager.query(
          'ALTER TABLE user_policies ADD COLUMN accountEnabled INTEGER NOT NULL DEFAULT 1'
        );
        console.log('Migrated user_policies: added accountEnabled');
      }
      if (!colNames.includes('expiresAt')) {
        await DatabaseManager.query(
          'ALTER TABLE user_policies ADD COLUMN expiresAt TEXT'
        );
        console.log('Migrated user_policies: added expiresAt');
      }
      if (!colNames.includes('isAdmin')) {
        await DatabaseManager.query(
          'ALTER TABLE user_policies ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0'
        );
        console.log('Migrated user_policies: added isAdmin');
      }
      if (!colNames.includes('allowDownloads')) {
        await DatabaseManager.query(
          'ALTER TABLE user_policies ADD COLUMN allowDownloads INTEGER NOT NULL DEFAULT 1'
        );
        console.log('Migrated user_policies: added allowDownloads');
      }

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

      console.log('âœ… Policy schema initialized');
    } catch (error) {
      console.error('Error initializing policy schema:', error);
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

      console.log(`Synced admin status for user ${userId}: ${isAdmin === 1}`);
      return { success: true, synced: true };
    } catch (error) {
      console.error('Error syncing admin status from Jellyfin:', error);
      return { success: false, synced: false };
    }
  }

  /**
   * Migrate existing admin users from Jellyfin to database
   * Run once during startup to populate admin status for existing users
   */
  static async migrateAdminUsersFromJellyfin(jellyfinApi) {
    try {
      console.log('Starting migration of admin users from Jellyfin...');
      
      if (!jellyfinApi) {
        console.warn('JellyfinAPI not available for admin user migration');
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
          console.log(`Migrated admin user: ${user.Name} (${user.Id})`);
        }
      }

      console.log(`✅ Admin user migration complete: ${migratedCount} users migrated`);
      return { success: true, migratedCount };
    } catch (error) {
      console.error('Error during admin user migration:', error);
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
      console.error('Error getting user policy:', error);
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
        console.error(`Warning: Could not update Jellyfin stream limit for user ${userId}:`, jellyfinError.message);
        // Local DB tier was saved; Jellyfin update failure is non-fatal.
      }

      return { success: true, tier: tierId, maxStreams: tierConfig.maxConcurrentStreams };
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
      console.error('Error checking stream permission:', error);
      // On error, allow stream (fail-open approach)
      return { allowed: true };
    }
  }

  /**
   * Check if device is whitelisted for user (if whitelist enabled)
   */
  // DEPRECATED: Device whitelist feature removed

  /**
   * Add device to whitelist
   */
  // DEPRECATED: Device whitelist feature removed

  /**
   * Remove device from whitelist
   */
  // DEPRECATED: Device whitelist feature removed

  /**
   * Get whitelisted devices for user
   */
  // DEPRECATED: Device whitelist feature removed

  /**
   * Enable/disable device whitelist for user
   */
  // DEPRECATED: Device whitelist feature removed

  /**
   * Check if current time is within user's access schedule
   * Uses Jellyfin's AccessSchedules via API
   */
  // DEPRECATED: Access schedule feature removed

  /**
   * Check if day matches Jellyfin schedule patterns
   */
  // DEPRECATED: Access schedule feature removed

  /**
   * Enable/disable access schedule enforcement
   */
  // DEPRECATED: Access schedule feature removed

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
      console.error('Error logging policy audit:', error);
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
      console.error('Error getting audit log:', error);
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
      console.error('Error getting all policies:', error);
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
      console.error('Error getting tiers:', error);
      return [];
    }
  }

  static async getTier(id) {
    try {
      return await DatabaseManager.queryOne('SELECT * FROM tiers WHERE id = ?', [id]);
    } catch (error) {
      console.error('Error getting tier:', error);
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
        console.error('Warning: Could not propagate stream limit to Jellyfin:', jellyfinError.message);
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
      await JellyfinAPI.updateUserPolicy(userId, {
        IsAdministrator: isAdmin ? true : false
      });

      await this.logPolicyAudit(userId, 'ADMIN_STATUS', isAdmin ? 'GRANTED' : 'REVOKED');
      console.log(`User ${userId} admin status: ${isAdmin}`);
      return { success: true, isAdmin };
    } catch (error) {
      console.error('Error setting admin status:', error);
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
      await JellyfinAPI.updateUserPolicy(userId, {
        EnableContentDownloading: allowed ? true : false
      });

      await this.logPolicyAudit(userId, 'DOWNLOADS', allowed ? 'ENABLED' : 'DISABLED');
      console.log(`User ${userId} downloads: ${allowed}`);
      return { success: true, allowed };
    } catch (error) {
      console.error('Error setting downloads:', error);
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
      console.error('Error checking account access:', error);
      return { allowed: true }; // Fail-open on unexpected error
    }
  }
}

module.exports = PolicyManager;
