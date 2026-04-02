const express = require('express');
const router = express.Router();
const InviteRequestManager = require('../models/InviteRequestManager');
const InviteManager = require('../models/InviteManager');
const AuditLogger = require('../models/AuditLogger');
const NotificationManager = require('../models/NotificationManager');
const SetupManager = require('../models/SetupManager');
const { getBaseUrl } = require('../utils/urlHelper');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const requestManager = InviteRequestManager.getInstance();
const inviteManager = InviteManager.getInstance();
const auditLogger = AuditLogger;

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many invite requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * POST /api/invite-requests - Submit a new invite request (public)
 */
router.post('/', requestLimiter, async (req, res) => {
  try {
    const { name, email, reason } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const safeName = String(name).trim().substring(0, 100);
    const safeEmail = email ? String(email).trim().substring(0, 200) : null;
    const safeReason = reason ? String(reason).trim().substring(0, 1000) : null;

    // Basic email format validation
    if (safeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    const request = await requestManager.createRequest({
      name: safeName,
      email: safeEmail,
      reason: safeReason
    });

    auditLogger.log('info', 'INVITE_REQUEST_SUBMITTED', { id: request.id, name: safeName });

    res.json({ success: true, message: 'Your request has been submitted. An admin will review it shortly.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to submit request' });
  }
});

/**
 * GET /api/invite-requests - List invite requests (admin only)
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const requests = await requestManager.listRequests(status ? { status } : {});
    res.json({ success: true, requests, total: requests.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load requests' });
  }
});

/**
 * POST /api/invite-requests/:id/approve - Approve and auto-generate invite (admin only)
 * Body: { signupProfileId, expiryDays?, note? }
 */
router.post('/:id/approve', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { signupProfileId, expiryDays, note } = req.body;

    if (!signupProfileId) {
      return res.status(400).json({ success: false, error: 'Signup profile ID is required' });
    }

    const request = await requestManager.getRequest(id);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been reviewed' });
    }

    const adminId = req.session.user?.Id || 'admin';

    // Create expiry date if specified
    let expiresAt = null;
    if (expiryDays && parseInt(expiryDays) > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiryDays));
    }

    const invite = await inviteManager.createInvite(signupProfileId, adminId, expiresAt, {}, 1, null);

    await requestManager.updateStatus(id, 'approved', {
      reviewedBy: adminId,
      reviewNote: note || null,
      inviteId: invite.id
    });

    auditLogger.log('info', 'INVITE_REQUEST_APPROVED', {
      requestId: id,
      inviteCode: invite.code,
      reviewedBy: adminId
    });

    // Send invite link via email if requester provided one
    if (request.email) {
      try {
        const inviteUrl = `${getBaseUrl(req)}/signup?invite=${invite.code}`;
        const nm = NotificationManager.getInstance();
        const appName = SetupManager.getConfig().appName || 'JellySSO';
        await nm.sendEmail(
          request.email,
          `Your ${appName} invite is ready`,
          `<p>Hi ${request.name},</p>
           <p>Your invite request has been approved! Click the link below to create your account:</p>
           <p><a href="${inviteUrl}">${inviteUrl}</a></p>
           ${expiresAt ? `<p>This invite expires on ${expiresAt.toLocaleDateString()}.</p>` : ''}`,
          `Hi ${request.name},\n\nYour invite request has been approved!\n\nSign up here: ${inviteUrl}`
        );
      } catch (emailErr) {
        // Don't fail the approval if email sending fails
        auditLogger.log('warn', 'INVITE_REQUEST_EMAIL_FAILED', { requestId: id, error: emailErr.message });
      }
    }

    const inviteUrl = `${getBaseUrl(req)}/signup?invite=${invite.code}`;
    res.json({ success: true, invite: { ...invite, signupUrl: inviteUrl } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to approve request' });
  }
});

/**
 * POST /api/invite-requests/:id/deny - Deny an invite request (admin only)
 * Body: { note? }
 */
router.post('/:id/deny', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;

    const request = await requestManager.getRequest(id);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: 'Request has already been reviewed' });
    }

    const adminId = req.session.user?.Id || 'admin';

    await requestManager.updateStatus(id, 'denied', {
      reviewedBy: adminId,
      reviewNote: note || null
    });

    auditLogger.log('info', 'INVITE_REQUEST_DENIED', { requestId: id, reviewedBy: adminId });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to deny request' });
  }
});

/**
 * DELETE /api/invite-requests/:id - Delete a request (admin only)
 */
router.delete('/:id', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await requestManager.deleteRequest(id);
    auditLogger.log('info', 'INVITE_REQUEST_DELETED', { requestId: id, reviewedBy: req.session.user?.Id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete request' });
  }
});

module.exports = router;
