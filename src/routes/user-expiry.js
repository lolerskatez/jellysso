const express = require('express');
const router = express.Router();
const UserExpiryManager = require('../models/UserExpiryManager');
const AuditLogger = require('../models/AuditLogger');
const { requireAuth, requireAdmin, csrfProtection } = require('../middleware');

// Initialize managers
const expiryManager = UserExpiryManager.getInstance();
const auditLogger = AuditLogger.getInstance();

/**
 * GET /api/users/expiry - List users with expiry info (admin only)
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { filter } = req.query; // 'all', 'expiring_soon', 'expired'

    let users;

    if (filter === 'expiring_soon') {
      users = await expiryManager.getUsersExpiringWithin(7);
    } else if (filter === 'expired') {
      users = await expiryManager.getExpiredUsers();
    } else {
      // Return stats instead of all users
      const stats = await expiryManager.getExpiryStats();
      return res.json({
        success: true,
        stats
      });
    }

    res.json({
      success: true,
      users,
      total: users.length,
      filter
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get user expiry info' });
  }
});

/**
 * GET /api/users/expiry/stats - Get expiry statistics (admin only)
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await expiryManager.getExpiryStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get expiry stats' });
  }
});

/**
 * POST /api/users/:id/expiry - Set user expiry (admin only)
 */
router.post('/:id/expiry', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { expiresAt, reason = 'manual_admin' } = req.body;

    if (!expiresAt) {
      return res.status(400).json({ success: false, error: 'Expiry date is required' });
    }

    await expiryManager.setUserExpiry(id, new Date(expiresAt), reason);

    auditLogger.log('info', 'USER_EXPIRY_SET', {
      adminId: req.user.id,
      userId: id,
      expiresAt,
      reason
    });

    res.json({
      success: true,
      message: 'User expiry set',
      expiresAt
    });
  } catch (error) {
    auditLogger.log('error', 'USER_EXPIRY_SET_ERROR', {
      adminId: req.user?.id,
      userId: req.params.id,
      error: error.message
    });
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/users/:id/expiry - Clear user expiry (admin only)
 */
router.delete('/:id/expiry', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await expiryManager.clearUserExpiry(id);

    auditLogger.log('info', 'USER_EXPIRY_CLEARED', {
      adminId: req.user.id,
      userId: id
    });

    res.json({ success: true, message: 'User expiry cleared' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/users/:id/lifecycle - Get user lifecycle history (admin only or user self)
 */
router.get('/:id/lifecycle', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Allow user to see their own, or admin to see any
    if (req.user.id !== id && !req.user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const history = await expiryManager.getUserLifecycleHistory(id);

    res.json({
      success: true,
      history
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get lifecycle history' });
  }
});

/**
 * POST /api/users/expiry/cleanup - Bulk cleanup old disabled users (admin only)
 */
router.post('/cleanup', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { olderThanDays = 90 } = req.body;

    if (olderThanDays < 1) {
      return res.status(400).json({ success: false, error: 'olderThanDays must be at least 1' });
    }

    const deletedCount = await expiryManager.bulkCleanupDisabledUsers(olderThanDays);

    auditLogger.log('info', 'USERS_CLEANUP_PERFORMED', {
      adminId: req.user.id,
      deletedCount,
      olderThanDays
    });

    res.json({
      success: true,
      message: `Deleted ${deletedCount} users`,
      deletedCount
    });
  } catch (error) {
    auditLogger.log('error', 'CLEANUP_ERROR', {
      adminId: req.user?.id,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/users/expiry/send-warnings - Manually trigger expiry warnings (admin only)
 */
router.post('/send-warnings', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await expiryManager.sendExpiryWarnings();

    auditLogger.log('info', 'EXPIRY_WARNINGS_MANUAL', {
      adminId: req.user.id,
      count
    });

    res.json({
      success: true,
      message: `Sent ${count} expiry warning notifications`,
      count
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/users/expiry/disable-expired - Manually trigger expiry disabling (admin only)
 */
router.post('/disable-expired', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await expiryManager.disableExpiredUsers();

    auditLogger.log('info', 'EXPIRED_USERS_MANUAL_DISABLE', {
      adminId: req.user.id,
      count
    });

    res.json({
      success: true,
      message: `Disabled ${count} expired users`,
      count
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
