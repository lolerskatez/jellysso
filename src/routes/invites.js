const express = require('express');
const router = express.Router();
const InviteManager = require('../models/InviteManager');
const SignupProfileManager = require('../models/SignupProfileManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Initialize managers
const inviteManager = InviteManager.getInstance();
const profileManager = SignupProfileManager.getInstance();
const auditLogger = AuditLogger;

// Rate limiting for public endpoints
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * GET /api/invites - List invites (admin only)
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, limit } = req.query;
    const filters = {};

    if (status) filters.status = status;
    if (limit) filters.limit = parseInt(limit);

    const invites = await inviteManager.listInvites({
      ...filters,
      createdBy: req.user.id // Admins only see invites they created (unless super admin)
    });

    res.json({
      success: true,
      invites,
      total: invites.length
    });
  } catch (error) {
    auditLogger.log('error', 'INVITES_LIST_ERROR', {
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({ success: false, error: 'Failed to list invites' });
  }
});

/**
 * GET /api/invites/stats - Get invite statistics (admin only)
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await inviteManager.getInviteStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get statistics' });
  }
});

/**
 * POST /api/invites - Create new invite(s) (admin only)
 */
router.post('/', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      signupProfileId,
      count = 1,
      expiryDays = null
    } = req.body;

    // Validate inputs
    if (!signupProfileId) {
      return res.status(400).json({ success: false, error: 'Signup profile ID is required' });
    }

    // Calculate expiry date if specified
    let expiresAt = null;
    if (expiryDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiryDays);
    }

    // Generate invites
    let invites;
    if (count === 1) {
      invites = [await inviteManager.createInvite(signupProfileId, req.user.id, expiresAt)];
    } else if (count > 1 && count <= 1000) {
      invites = await inviteManager.bulkGenerateInvites(signupProfileId, req.user.id, count, expiresAt);
    } else {
      return res.status(400).json({ success: false, error: 'Count must be between 1 and 1000' });
    }

    auditLogger.log('info', 'INVITES_CREATED', {
      userId: req.user.id,
      count: invites.length,
      profileId: signupProfileId,
      expiryDays
    });

    res.json({
      success: true,
      invites,
      count: invites.length
    });
  } catch (error) {
    auditLogger.log('error', 'INVITE_CREATE_ERROR', {
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message || 'Failed to create invite' });
  }
});

/**
 * GET /api/invites/:code - Get individual invite details
 */
router.get('/:code', publicLimiter, async (req, res) => {
  try {
    const { code } = req.params;

    // Validate invite without requiring auth (public endpoint)
    const invite = await inviteManager.validateInvite(code);

    // Don't expose createdBy to public
    delete invite.createdBy;

    // Track that the invite was viewed
    await inviteManager.trackInviteUsage(code, 'viewed', {
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      invite,
      profileId: invite.signupProfileId
    });
  } catch (error) {
    auditLogger.log('warn', 'INVITE_VALIDATE_FAIL', {
      code: req.params.code,
      error: error.message
    });
    res.status(400).json({ success: false, error: error.message || 'Invalid invite code' });
  }
});

/**
 * DELETE /api/invites/:code - Revoke invite (admin only)
 */
router.delete('/:code', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;

    await inviteManager.revokeInvite(code, req.user.id);

    auditLogger.log('info', 'INVITE_REVOKED', {
      userId: req.user.id,
      code
    });

    res.json({ success: true, message: 'Invite revoked' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to revoke invite' });
  }
});

/**
 * POST /api/invites/:code/accept - Accept invite and create user
 * (This endpoint is called after signup form submission)
 */
router.post('/:code/accept', csrfProtection, publicLimiter, async (req, res) => {
  try {
    const { code } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Validate invite
    const invite = await inviteManager.validateInvite(code);

    // Accept the invite
    await inviteManager.acceptInvite(code, userId);

    // Track acceptance
    await inviteManager.trackInviteUsage(code, 'accepted', { userId });

    res.json({ success: true, message: 'Invite accepted' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Failed to accept invite' });
  }
});

/**
 * GET /api/invites/:code/usage-stats - Get usage stats for an invite
 */
router.get('/:code/usage-stats', async (req, res) => {
  try {
    const { code } = req.params;
    const stats = await inviteManager.getInviteUsageStats(code);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get usage stats' });
  }
});

module.exports = router;
