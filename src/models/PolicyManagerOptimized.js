/**
 * Optimized PolicyManager methods to fix N+1 query problems
 * Batch queries instead of looping with individual queries
 */

const DatabaseManager = require('./DatabaseManager');

class PolicyManagerOptimized {
  /**
   * Get user counts for all tiers in a single query (fixes N+1 problem)
   * @returns {Promise<object>} - { tierId: count, ... }
   */
  static async getUserCountsByTier() {
    try {
      const rows = await DatabaseManager.query(
        `SELECT tier, COUNT(*) as count FROM user_policies GROUP BY tier`
      );

      const counts = {};
      rows.forEach(row => {
        counts[row.tier] = row.count;
      });

      return counts;
    } catch (error) {
      console.error('Error getting user counts by tier:', error);
      return {};
    }
  }

  /**
   * Get all tiers with user counts in a single operation
   * @returns {Promise<array>} - Array of tiers with userCount property
   */
  static async getAllTiersWithCounts() {
    try {
      const tiers = await DatabaseManager.query(`SELECT * FROM tiers ORDER BY sortOrder`);
      const counts = await this.getUserCountsByTier();

      return tiers.map(tier => ({
        ...tier,
        userCount: counts[tier.id] || 0
      }));
    } catch (error) {
      console.error('Error getting tiers with counts:', error);
      return [];
    }
  }

  /**
   * Get all user policies with tier information in a single query
   * @returns {Promise<array>}
   */
  static async getAllPoliciesWithTiers() {
    try {
      return await DatabaseManager.query(`
        SELECT 
          up.*,
          t.displayName as tierName,
          t.badgeColor,
          COUNT(DISTINCT wd.id) as whitelistedDeviceCount
        FROM user_policies up
        LEFT JOIN tiers t ON up.tier = t.id
        LEFT JOIN whitelisted_devices wd ON up.userId = wd.userId
        GROUP BY up.userId
        ORDER BY up.updatedAt DESC
      `);
    } catch (error) {
      console.error('Error getting all policies with tiers:', error);
      return [];
    }
  }

  /**
   * Get user policy with related data in a single query
   * @param {string} userId
   * @returns {Promise<object>}
   */
  static async getUserPolicyWithDetails(userId) {
    try {
      return await DatabaseManager.queryOne(`
        SELECT 
          up.*,
          t.displayName as tierName,
          t.badgeColor,
          COUNT(DISTINCT wd.id) as whitelistedDeviceCount
        FROM user_policies up
        LEFT JOIN tiers t ON up.tier = t.id
        LEFT JOIN whitelisted_devices wd ON up.userId = wd.userId
        WHERE up.userId = ?
        GROUP BY up.userId
      `, [userId]);
    } catch (error) {
      console.error('Error getting user policy with details:', error);
      return null;
    }
  }

  /**
   * Get users on a specific tier
   * @param {string} tierId
   * @returns {Promise<number>}
   */
  static async getUsersOnTier(tierId) {
    try {
      const result = await DatabaseManager.queryOne(
        `SELECT COUNT(*) as count FROM user_policies WHERE tier = ?`,
        [tierId]
      );
      return result?.count || 0;
    } catch (error) {
      console.error('Error getting users on tier:', error);
      return 0;
    }
  }

  /**
   * Get all users on a specific tier
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
      console.error('Error getting all users on tier:', error);
      return [];
    }
  }

  /**
   * Batch update user tiers
   * @param {array} updates - Array of { userId, tierId }
   * @returns {Promise<number>} - Number of updated records
   */
  static async batchUpdateUserTiers(updates) {
    try {
      let totalUpdated = 0;

      for (const { userId, tierId } of updates) {
        const tierConfig = await this.getTier(tierId);
        if (!tierConfig) {
          console.warn(`Invalid tier: ${tierId}`);
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
      console.error('Error batch updating user tiers:', error);
      return 0;
    }
  }

  /**
   * Get audit logs with user information (avoid N+1)
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
        FROM policy_audit_log pl
        LEFT JOIN user_policies up ON pl.userId = up.userId
        LEFT JOIN tiers t ON up.tier = t.id
        WHERE pl.userId = ?
        ORDER BY pl.createdAt DESC
        LIMIT ?
      `, [userId, limit]);
    } catch (error) {
      console.error('Error getting audit log with user info:', error);
      return [];
    }
  }

  /**
   * Get policy statistics in a single query
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
      console.error('Error getting policy statistics:', error);
      return {};
    }
  }

  /**
   * Get tier distribution statistics
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
      console.error('Error getting tier distribution:', error);
      return [];
    }
  }
}

module.exports = PolicyManagerOptimized;
