const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const PolicyManager = require('../models/PolicyManager');
const AuditLogger = require('../models/AuditLogger');
const SetupManager = require('../models/SetupManager');
const NotificationManager = require('../models/NotificationManager');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * POST /api/users/bulk-action
 * Perform bulk operations on multiple users
 * Actions: enable, disable, delete, set-tier
 */
router.post('/bulk-action', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userIds, action, data } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    if (!action || typeof action !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Action is required'
      });
    }

    // Validate action
    const validActions = ['enable', 'disable', 'delete', 'set-tier'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Process each user
    for (const userId of userIds) {
      try {
        switch (action) {
          case 'enable':
            // Set user enabled in Jellyfin policy
            await jellyfin.updateUser(userId, { Policy: { IsDisabled: false } });
            await AuditLogger.log('BULK_USER_ENABLE', req.session.user.Id, `user:${userId}`,
              {}, 'success', req.ip);
            NotificationManager.getInstance().notifyUserEnabled(userId).catch(e => logger.warn('Notify enable failed:', e.message));
            results.success++;
            break;

          case 'disable':
            // Set user disabled in Jellyfin policy
            await jellyfin.updateUser(userId, { Policy: { IsDisabled: true } });
            await AuditLogger.log('BULK_USER_DISABLE', req.session.user.Id, `user:${userId}`,
              {}, 'success', req.ip);
            NotificationManager.getInstance().notifyUserDisabled(userId).catch(e => logger.warn('Notify disable failed:', e.message));
            results.success++;
            break;

          case 'delete':
            // Delete user from Jellyfin
            await jellyfin.deleteUser(userId);
            await AuditLogger.log('BULK_USER_DELETE', req.session.user.Id, `user:${userId}`,
              {}, 'success', req.ip);
            NotificationManager.getInstance().notifyUserDeleted(userId).catch(e => logger.warn('Notify delete failed:', e.message));
            results.success++;
            break;

          case 'set-tier':
            // Set user tier
            if (!data || !data.tier) {
              throw new Error('Tier must be specified for set-tier action');
            }
            await PolicyManager.setUserTier(userId, data.tier);
            await AuditLogger.log('BULK_USER_SET_TIER', req.session.user.Id, `user:${userId}`,
              { tier: data.tier }, 'success', req.ip);
            results.success++;
            break;
        }
      } catch (err) {
        logger.error(`Bulk action ${action} failed for user ${userId}:`, err.message);
        results.failed++;
        results.errors.push({
          userId,
          error: err.message
        });
      }
    }

    res.json({
      success: true,
      action,
      results
    });
  } catch (err) {
    logger.error('Bulk action error:', err.message);
    await AuditLogger.log('BULK_ACTION_ERROR', req.session.user?.Id, 'user:bulk',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({
      success: false,
      message: err.message || 'Bulk action failed'
    });
  }
});

/**
 * POST /api/users/bulk-delete
 * Delete multiple users at once with confirmation
 */
router.post('/bulk-delete', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userIds, confirmationHash } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    // Require only 1-2 confirmations for safety
    if (!confirmationHash) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation is required',
        confirmationRequired: true
      });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
    const results = { deleted: 0, failed: 0, errors: [] };

    for (const userId of userIds) {
      try {
        await jellyfin.deleteUser(userId);
        await AuditLogger.log('USER_DELETED', req.session.user.Id, `user:${userId}`,
          { bulkDelete: true }, 'success', req.ip);
        results.deleted++;
      } catch (err) {
        logger.error(`Failed to delete user ${userId}:`, err.message);
        results.failed++;
        results.errors.push({ userId, error: err.message });
      }
    }

    res.json({
      success: true,
      message: `${results.deleted} user(s) deleted`,
      results
    });
  } catch (err) {
    logger.error('Bulk delete error:', err.message);
    res.status(500).json({
      success: false,
      message: 'Bulk delete failed'
    });
  }
});

module.exports = router;
