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
 * GET /admin/tiers
 * List all configured tiers
 */
router.get('/admin/tiers', requireAuth, requireAdmin, async (req, res) => {
  try {
    const tiers = await PolicyManager.getAllTiers();
    // Annotate each tier with its current user count
    const annotated = await Promise.all(
      tiers.map(async t => ({
        ...t,
        userCount: await PolicyManager.getUsersOnTier(t.id)
      }))
    );
    res.json({ success: true, tiers: annotated });
  } catch (error) {
    console.error('Error getting tiers:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve tiers' });
  }
});

/**
 * POST /admin/tiers
 * Create a new tier
 */
router.post('/admin/tiers', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id, displayName, maxConcurrentStreams, deviceWhitelistEnabled, enforceAccessSchedule, badgeColor, sortOrder } = req.body;
    const tier = await PolicyManager.createTier({ id, displayName, maxConcurrentStreams, deviceWhitelistEnabled, enforceAccessSchedule, badgeColor, sortOrder });

    await AuditLogger.log('ADMIN_TIER_CREATED', req.session.user.Id, `admin:tier:${id}`,
      { displayName, maxConcurrentStreams }, 'success', req.ip);

    res.status(201).json({ success: true, tier });
  } catch (error) {
    console.error('Error creating tier:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * PUT /admin/tiers/:id
 * Update an existing tier
 */
router.put('/admin/tiers/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { displayName, maxConcurrentStreams, deviceWhitelistEnabled, enforceAccessSchedule, badgeColor, sortOrder } = req.body;
    const tier = await PolicyManager.updateTier(req.params.id, { displayName, maxConcurrentStreams, deviceWhitelistEnabled, enforceAccessSchedule, badgeColor, sortOrder });

    await AuditLogger.log('ADMIN_TIER_UPDATED', req.session.user.Id, `admin:tier:${req.params.id}`,
      { displayName, maxConcurrentStreams }, 'success', req.ip);

    res.json({ success: true, tier });
  } catch (error) {
    console.error('Error updating tier:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /admin/tiers/:id
 * Delete a tier (blocked if users are assigned)
 */
router.delete('/admin/tiers/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const result = await PolicyManager.deleteTier(req.params.id);

    await AuditLogger.log('ADMIN_TIER_DELETED', req.session.user.Id, `admin:tier:${req.params.id}`,
      {}, 'success', req.ip);

    res.json(result);
  } catch (error) {
    console.error('Error deleting tier:', error.message);
    res.status(400).json({ success: false, message: error.message });
  }
});

/**
 * POST /admin/user/:userId/account-status
 * Enable/disable account and optionally set/clear expiry
 * Body: { enabled: boolean, expiresAt: string|null } — expiresAt omitted = unchanged
 */
router.post('/admin/user/:userId/account-status', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userId } = req.params;
    const { enabled, expiresAt } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: '"enabled" (boolean) is required' });
    }

    // Validate expiresAt when present
    if (expiresAt !== undefined && expiresAt !== null) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiresAt datetime' });
      }
    }

    const result = await PolicyManager.setAccountStatus(userId, enabled, expiresAt);

    // Mirror enable/disable to Jellyfin's own IsDisabled flag
    try {
      const SetupManager = require('../models/SetupManager');
      const JellyfinAPI = require('../models/JellyfinAPI');
      const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
      await jellyfin.updateUserPolicy(userId, { IsDisabled: !enabled });
    } catch (jellyfinErr) {
      console.error('Warning: Could not mirror account status to Jellyfin:', jellyfinErr.message);
    }

    await AuditLogger.log('ADMIN_ACCOUNT_STATUS_CHANGED', req.session.user.Id, `admin:user:${userId}`,
      { enabled, expiresAt: expiresAt ?? 'unchanged' }, 'success', req.ip);

    res.json({ success: true, ...result, expiresAt: expiresAt !== undefined ? expiresAt : undefined });
  } catch (error) {
    console.error('Error updating account status:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /admin/policies
 * Get all user policies merged with Jellyfin user data
 */
router.get('/admin/policies', requireAuth, requireAdmin, async (req, res) => {
  try {
    const SetupManager = require('../models/SetupManager');
    const JellyfinAPI = require('../models/JellyfinAPI');
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    // Fetch all Jellyfin users, DB policies and tiers in parallel
    const [jellyfinUsers, dbPolicies, tiers] = await Promise.all([
      jellyfin.getUsers(),
      PolicyManager.getAllPolicies(),
      PolicyManager.getAllTiers()
    ]);

    // Index DB policies by userId for O(1) lookup
    const policyMap = new Map(dbPolicies.map(p => [p.userId, p]));

    // Build merged list: every Jellyfin user gets a row
    const now = new Date();
    const policies = (jellyfinUsers || []).map(u => {
      const p = policyMap.get(u.Id);
      const accountEnabled = p ? !!p.accountEnabled : true;
      const expiresAt = p ? p.expiresAt : null;
      const expired = expiresAt ? new Date(expiresAt) < now : false;

      let accountStatus = 'active';
      if (!accountEnabled) accountStatus = 'disabled';
      else if (expired) accountStatus = 'expired';

      return {
        userId: u.Id,
        username: u.Name || u.Id,
        isJellyfinAdmin: !!(u.Policy && u.Policy.IsAdministrator),
        isJellyfinDisabled: !!(u.Policy && u.Policy.IsDisabled),
        tier: p ? p.tier : 'free',
        maxConcurrentStreams: p ? p.maxConcurrentStreams : 1,
        deviceWhitelistEnabled: p ? !!p.deviceWhitelistEnabled : false,
        enforceAccessSchedule: p ? !!p.enforceAccessSchedule : false,
        whitelistedDeviceCount: p ? (p.whitelistedDeviceCount || 0) : 0,
        accountEnabled,
        expiresAt,
        accountStatus,
        updatedAt: p ? p.updatedAt : null
      };
    });

    res.json({
      success: true,
      policies,
      totalUsers: policies.length,
      tiers
    });

    await AuditLogger.log('ADMIN_VIEW_ALL_POLICIES', req.session.user.Id, 'admin:policy',
      { policyCount: policies.length }, 'success', req.ip);
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
