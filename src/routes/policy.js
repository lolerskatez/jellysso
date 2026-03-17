const express = require('express');
const router = express.Router();
const PolicyManager = require('../models/PolicyManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');

// Middleware: Require authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// Middleware: Require admin access
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.Policy && req.session.user.Policy.IsAdministrator) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Admin access required' });
  }
};

/**
 * USER ENDPOINTS
 */

/**
 * GET /user/policy
 * Get current user's policy settings
 */
router.get('/user/policy', requireAuth, async (req, res) => {
  try {
    const policy = await PolicyManager.getUserPolicy(req.session.user.Id);
    const devices = await PolicyManager.getWhitelistedDevices(req.session.user.Id);

    res.json({
      success: true,
      policy: {
        tier: policy.tier,
        maxConcurrentStreams: policy.maxConcurrentStreams,
        deviceWhitelistEnabled: !!policy.deviceWhitelistEnabled,
        enforceAccessSchedule: !!policy.enforceAccessSchedule
      },
      whitelistedDevices: devices,
      availableTiers: PolicyManager.TIERS
    });
  } catch (error) {
    console.error('Error getting user policy:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve policy settings'
    });
  }
});

/**
 * GET /user/audit-log
 * Get current user's policy audit log
 */
router.get('/user/audit-log', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const logs = await PolicyManager.getAuditLog(req.session.user.Id, limit);

    res.json({
      success: true,
      logs: logs.map(log => ({
        type: log.policyType,
        action: log.action,
        reason: log.reason,
        device: log.deviceId,
        timestamp: log.createdAt
      }))
    });
  } catch (error) {
    console.error('Error getting audit log:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log'
    });
  }
});

/**
 * POST /user/device/whitelist
 * Add current device to user's whitelist
 */
router.post('/user/device/whitelist', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { deviceId, deviceName, deviceType } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId is required'
      });
    }

    await PolicyManager.whitelistDevice(
      req.session.user.Id,
      deviceId,
      deviceName,
      deviceType
    );

    await AuditLogger.log('POLICY_DEVICE_WHITELISTED', req.session.user.Id, 'policy:device',
      { deviceId, deviceName },
      'success', req.ip);

    res.json({
      success: true,
      message: `Device whitelisted: ${deviceName || deviceId}`
    });
  } catch (error) {
    console.error('Error whitelisting device:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to whitelist device'
    });
  }
});

/**
 * DELETE /user/device/whitelist/:deviceId
 * Remove device from user's whitelist
 */
router.delete('/user/device/whitelist/:deviceId', requireAuth, async (req, res) => {
  try {
    await PolicyManager.unwhitelistDevice(req.session.user.Id, req.params.deviceId);

    await AuditLogger.log('POLICY_DEVICE_REMOVED', req.session.user.Id, 'policy:device',
      { deviceId: req.params.deviceId },
      'success', req.ip);

    res.json({
      success: true,
      message: 'Device removed from whitelist'
    });
  } catch (error) {
    console.error('Error removing device:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to remove device'
    });
  }
});

/**
 * POST /user/device-whitelist/enable
 * Allow users to opt in/out of device whitelist enforcement on their own account
 */
router.post('/user/device-whitelist/enable', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { enabled } = req.body;

    const result = await PolicyManager.setDeviceWhitelistEnabled(req.session.user.Id, !!enabled);

    await AuditLogger.log('POLICY_DEVICE_WHITELIST_TOGGLE', req.session.user.Id, 'policy:device-whitelist',
      { enabled: !!enabled },
      'success', req.ip);

    res.json(result);
  } catch (error) {
    console.error('Error toggling device whitelist:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update device whitelist setting'
    });
  }
});

/**
 * ADMIN ENDPOINTS
 */

/**
 * GET /admin/policies
 * Get all user policies
 */
router.get('/admin/policies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const policies = await PolicyManager.getAllPolicies();

    res.json({
      success: true,
      policies: policies.map(p => ({
        userId: p.userId,
        tier: p.tier,
        maxConcurrentStreams: p.maxConcurrentStreams,
        deviceWhitelistEnabled: !!p.deviceWhitelistEnabled,
        enforceAccessSchedule: !!p.enforceAccessSchedule,
        whitelistedDeviceCount: p.whitelistedDeviceCount || 0,
        updatedAt: p.updatedAt
      })),
      totalUsers: policies.length,
      availableTiers: PolicyManager.TIERS
    });

    await AuditLogger.log('ADMIN_VIEW_ALL_POLICIES', req.session.user.Id, 'admin:policy',
      { policyCount: policies.length },
      'success', req.ip);
  } catch (error) {
    console.error('Error getting policies:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve policies'
    });
  }
});

/**
 * POST /admin/user/:userId/tier
 * Set user tier (stream limit)
 */
router.post('/admin/user/:userId/tier', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { tier } = req.body;

    if (!tier) {
      return res.status(400).json({
        success: false,
        message: 'tier is required'
      });
    }

    const result = await PolicyManager.setUserTier(req.params.userId, tier);

    await AuditLogger.log('ADMIN_SET_USER_TIER', req.session.user.Id, `admin:policy:${req.params.userId}`,
      { tier, maxStreams: result.maxStreams },
      'success', req.ip);

    res.json({
      success: true,
      message: `User tier set to ${tier}`,
      ...result
    });
  } catch (error) {
    console.error('Error setting user tier:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/user/:userId/device-whitelist/enable
 * Enable device whitelist enforcement for user
 */
router.post('/admin/user/:userId/device-whitelist/enable', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { enabled } = req.body;

    const result = await PolicyManager.setDeviceWhitelistEnabled(req.params.userId, enabled);

    await AuditLogger.log('ADMIN_DEVICE_WHITELIST_TOGGLE', req.session.user.Id, `admin:policy:${req.params.userId}`,
      { enabled },
      'success', req.ip);

    res.json(result);
  } catch (error) {
    console.error('Error toggling device whitelist:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update device whitelist setting'
    });
  }
});

/**
 * POST /admin/user/:userId/access-schedule/enforce
 * Enable/disable access schedule enforcement
 */
router.post('/admin/user/:userId/access-schedule/enforce', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { enforce } = req.body;

    const result = await PolicyManager.setEnforceAccessSchedule(req.params.userId, enforce);

    await AuditLogger.log('ADMIN_ACCESS_SCHEDULE_TOGGLE', req.session.user.Id, `admin:policy:${req.params.userId}`,
      { enforce },
      'success', req.ip);

    res.json(result);
  } catch (error) {
    console.error('Error toggling access schedule enforcement:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update access schedule setting'
    });
  }
});

/**
 * GET /admin/user/:userId/audit-log
 * Get audit log for specific user
 */
router.get('/admin/user/:userId/audit-log', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const logs = await PolicyManager.getAuditLog(req.params.userId, limit);

    res.json({
      success: true,
      userId: req.params.userId,
      logs: logs.map(log => ({
        type: log.policyType,
        action: log.action,
        reason: log.reason,
        device: log.deviceId,
        session: log.sessionId,
        ipAddress: log.ipAddress,
        timestamp: log.createdAt
      }))
    });
  } catch (error) {
    console.error('Error getting user audit log:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve audit log'
    });
  }
});

module.exports = router;
