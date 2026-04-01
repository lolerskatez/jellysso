const express = require('express');
const router = express.Router();
const InviteManager = require('../models/InviteManager');
const SignupProfileManager = require('../models/SignupProfileManager');
const AuditLogger = require('../models/AuditLogger');
const UserExpiryManager = require('../models/UserExpiryManager');
const NotificationManager = require('../models/NotificationManager');
const SetupManager = require('../models/SetupManager');
const { getBaseUrl } = require('../utils/urlHelper');
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

    const invites = await inviteManager.listInvites(filters);

    res.json({
      success: true,
      invites: invites.map(inv => {
        let meta = {};
        try { meta = typeof inv.metadata === 'string' ? JSON.parse(inv.metadata) : (inv.metadata || {}); } catch {}
        return { ...inv, label: meta.label || null };
      }),
      total: invites.length
    });
  } catch (error) {
    auditLogger.log('error', 'INVITES_LIST_ERROR', {
      userId: req.session.user?.Id,
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
      expiryDays = null,
      maxUses = 1,
      userExpiryDays = null,
      label = null,
      recipientEmail = null
    } = req.body;

    // Validate inputs
    if (!signupProfileId) {
      return res.status(400).json({ success: false, error: 'Signup profile ID is required' });
    }

    const safeMaxUses = Math.max(1, parseInt(maxUses) || 1);
    const safeUserExpiryDays = userExpiryDays ? Math.max(1, parseInt(userExpiryDays)) : null;

    // Calculate invite expiry date if specified
    let expiresAt = null;
    if (expiryDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiryDays));
    }

    const adminId = req.session.user?.Id || 'admin';

    const safeLabel = label ? String(label).trim().substring(0, 64) : null;
    const metadata = safeLabel ? { label: safeLabel } : {};

    // Generate invites
    let invites;
    if (count === 1) {
      invites = [await inviteManager.createInvite(signupProfileId, adminId, expiresAt, metadata, safeMaxUses, safeUserExpiryDays)];
    } else if (count > 1 && count <= 1000) {
      invites = await inviteManager.bulkGenerateInvites(signupProfileId, adminId, count, expiresAt, safeMaxUses, safeUserExpiryDays);
      // Apply label to bulk invites if provided
      if (safeLabel) {
        await Promise.all(invites.map(inv => inviteManager.setInviteLabel(inv.code, safeLabel)));
      }
    } else {
      return res.status(400).json({ success: false, error: 'Count must be between 1 and 1000' });
    }

    auditLogger.log('info', 'INVITES_CREATED', {
      userId: adminId,
      count: invites.length,
      profileId: signupProfileId,
      expiryDays,
      maxUses: safeMaxUses,
      userExpiryDays: safeUserExpiryDays
    });

    // Deliver invite link via email if a recipient address was provided
    const safeEmail = recipientEmail ? String(recipientEmail).trim() : null;
    if (safeEmail && invites.length === 1) {
      // Basic email format validation before attempting delivery
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
        const inviteUrl = `${getBaseUrl(req)}/signup?invite=${invites[0].code}`;
        const nm = NotificationManager.getInstance();
        const expiryNote = invites[0].expiresAt
          ? `This invite expires on ${new Date(invites[0].expiresAt).toLocaleDateString()}.`
          : 'This invite has no expiry date.';
        nm.sendEmailNotification(safeEmail, {
          title: "You've been invited",
          subject: "Your Invitation",
          body: `You have been invited to create an account.\n\nClick the link below to get started:\n${inviteUrl}\n\n${expiryNote}`,
          format: 'text'
        }).catch(err => auditLogger.log('warn', 'INVITE_EMAIL_SEND_FAILED', {
          userId: adminId,
          recipientEmail: safeEmail,
          error: err.message
        }));
      } else {
        return res.status(400).json({ success: false, error: 'Invalid recipient email address' });
      }
    }

    res.json({
      success: true,
      invites: invites.map(inv => ({
        ...inv,
        label: safeLabel || (inv.metadata && typeof inv.metadata === 'object' ? inv.metadata.label : null) || null
      })),
      count: invites.length
    });
  } catch (error) {
    auditLogger.log('error', 'INVITE_CREATE_ERROR', {
      userId: req.session.user?.Id,
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

    await inviteManager.revokeInvite(code, req.session.user?.Id);

    auditLogger.log('info', 'INVITE_REVOKED', {
      userId: req.session.user?.Id,
      code
    });

    res.json({ success: true, message: 'Invite revoked' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to revoke invite' });
  }
});

/**
 * POST /api/invites/:code/accept - Accept invite and create user
 * Body: { userId, contactMethods?: { discord?: string, telegram?: string, matrix?: string } }
 * (This endpoint is called after signup form submission)
 */
router.post('/:code/accept', csrfProtection, publicLimiter, async (req, res) => {
  try {
    const { code } = req.params;
    const { userId, contactMethods } = req.body;
    const ContactMethodManager = require('../models/ContactMethodManager');

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Validate invite
    const invite = await inviteManager.validateInvite(code);

    // Accept the invite (returns updated invite row with userExpiryDays)
    const acceptedInvite = await inviteManager.acceptInvite(code, userId);

    // Wire per-invite user account expiry if configured
    const userExpiryDays = invite.userExpiryDays || acceptedInvite.userExpiryDays;
    if (userExpiryDays && parseInt(userExpiryDays) > 0) {
      try {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + parseInt(userExpiryDays));
        await UserExpiryManager.getInstance().setUserExpiry(userId, expiryDate, 'invite');
        auditLogger.log('info', 'USER_EXPIRY_SET_FROM_INVITE', { userId, userExpiryDays, expiryDate });
      } catch (expiryErr) {
        auditLogger.log('warn', 'INVITE_EXPIRY_WIRE_FAILED', { userId, error: expiryErr.message });
      }
    }

    // Track acceptance
    await inviteManager.trackInviteUsage(code, 'accepted', { userId });

    // If contact methods were provided during signup, initiate verification
    const verifications = {};
    if (contactMethods && typeof contactMethods === 'object') {
      const contactMgr = ContactMethodManager.getInstance();
      
      try {
        if (contactMethods.discord && contactMethods.discord.trim()) {
          const discord = await contactMgr.addDiscordMethod(userId, contactMethods.discord.trim());
          const verification = await contactMgr.createVerificationRequest(userId, 'discord', contactMethods.discord.trim());
          verifications.discord = { id: verification.id, code: verification.code };
          auditLogger.log('info', 'DISCORD_ADDED_ON_SIGNUP', { userId, code });
        }
        
        if (contactMethods.telegram && contactMethods.telegram.trim()) {
          const telegram = await contactMgr.addTelegramMethod(userId, contactMethods.telegram.trim());
          const verification = await contactMgr.createVerificationRequest(userId, 'telegram', contactMethods.telegram.trim());
          verifications.telegram = { id: verification.id, code: verification.code };
          auditLogger.log('info', 'TELEGRAM_ADDED_ON_SIGNUP', { userId, code });
        }
        
        if (contactMethods.matrix && contactMethods.matrix.trim()) {
          const matrix = await contactMgr.addMatrixMethod(userId, contactMethods.matrix.trim());
          const verification = await contactMgr.createVerificationRequest(userId, 'matrix', contactMethods.matrix.trim());
          verifications.matrix = { id: verification.id, code: verification.code };
          auditLogger.log('info', 'MATRIX_ADDED_ON_SIGNUP', { userId, code });
        }
      } catch (contactError) {
        // Don't fail invite acceptance if contact method setup fails
        auditLogger.log('warn', 'CONTACT_METHOD_SETUP_FAILED', { userId, error: contactError.message });
        // But continue - the user was created successfully
      }
    }

    res.json({ 
      success: true, 
      message: 'Invite accepted',
      verifications: Object.keys(verifications).length > 0 ? verifications : undefined
    });
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

/**
 * PATCH /api/invites/:code/label - Set or update invite label (admin only)
 * Body: { label: string }
 */
router.patch('/:code/label', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const { label } = req.body;

    if (!label || typeof label !== 'string') {
      return res.status(400).json({ success: false, error: 'Label is required' });
    }

    if (label.length > 100) {
      return res.status(400).json({ success: false, error: 'Label must be 100 characters or less' });
    }

    // Verify invite exists
    const invite = await inviteManager.getInviteByCode(code);
    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    await inviteManager.setInviteLabel(code, label.trim());

    auditLogger.log('info', 'INVITE_LABEL_SET', {
      userId: req.session.user?.Id,
      code,
      label,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Invite label updated',
      label: label.trim()
    });
  } catch (error) {
    auditLogger.log('error', 'SET_LABEL_ERROR', {
      code: req.params.code,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/invites/:code/label - Get invite label
 */
router.get('/:code/label', async (req, res) => {
  try {
    const { code } = req.params;
    const label = await inviteManager.getInviteLabel(code);

    res.json({
      success: true,
      label: label || null
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/invites/label/:label - List invites by label (admin only)
 */
router.get('/label/:label', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { label } = req.params;
    const invites = await inviteManager.listInvitesByLabel(label);

    res.json({
      success: true,
      invites,
      total: invites.length
    });
  } catch (error) {
    auditLogger.log('error', 'LIST_BY_LABEL_ERROR', {
      label: req.params.label,
      error: error.message
    });
    res.status(500).json({ success: false, error: 'Failed to list invites' });
  }
});

/**
 * POST /api/invites/:code/send - Pre-send invite via email or Discord (admin only) 
 * This records that an invite was sent to a user via email/Discord
 * TODO: Integrate with NotificationService for actual sending
 * Body: { method: 'email'|'discord'|'telegram', recipient: string }
 */
router.post('/:code/send', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const { method, recipient } = req.body;

    const validMethods = ['email', 'discord', 'telegram', 'matrix'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid delivery method' });
    }

    if (!recipient || typeof recipient !== 'string' || recipient.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Recipient is required' });
    }

    // Verify invite exists and is active
    const invite = await inviteManager.getInviteByCode(code);
    if (!invite) {
      return res.status(404).json({ success: false, error: 'Invite not found' });
    }

    if (invite.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Cannot send ${invite.status} invite` });
    }

    // Record the pre-send
    await inviteManager.recordPreSend(code, method, recipient.trim());

    // Attempt actual delivery via NotificationManager
    try {
      const config = SetupManager.getConfig();
      const baseUrl = getBaseUrl(config);
      const inviteUrl = `${baseUrl}/signup?invite=${encodeURIComponent(code)}`;
      const serverName = config.serverName || config.appName || 'JellySSO';
      const notificationMgr = NotificationManager.getInstance();

      if (method === 'email') {
        await notificationMgr.sendEmailNotification(recipient.trim(), 'invite_send', {
          inviteUrl,
          serverName,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'
        });
      } else if (method === 'discord') {
        await notificationMgr.sendDiscordNotification(recipient.trim(), 'invite_send', {
          inviteUrl,
          serverName,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'
        });
      } else if (method === 'telegram') {
        await notificationMgr.sendTelegramNotification(recipient.trim(), 'invite_send', {
          inviteUrl,
          serverName,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'
        });
      } else if (method === 'matrix') {
        await notificationMgr.sendMatrixNotification(recipient.trim(), 'invite_send', {
          inviteUrl,
          serverName,
          expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never'
        });
      }
    } catch (sendErr) {
      auditLogger.log('warn', 'INVITE_SEND_DELIVERY_FAILED', {
        code, method, recipient, error: sendErr.message
      });
      // Still respond success — pre-send was recorded even if delivery failed
    }

    auditLogger.log('info', 'INVITE_PRESEND', {
      userId: req.session.user?.Id,
      code,
      method,
      recipient,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Invite sent via ${method}`,
      method,
      recipient: recipient.trim()
    });
  } catch (error) {
    auditLogger.log('error', 'INVITE_PRESEND_ERROR', {
      code: req.params.code,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message || 'Failed to send invite' });
  }
});

/**
 * GET /api/invites/:code/presend-stats - Get pre-send statistics (admin only)
 */
router.get('/:code/presend-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const stats = await inviteManager.getPresendStats(code);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
