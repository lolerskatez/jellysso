const express = require('express');
const router = express.Router();
const UserExpiryManager = require('../models/UserExpiryManager');
const ContactMethodManager = require('../models/ContactMethodManager');
const UserProfileManager = require('../models/UserProfileManager');
const DatabaseManager = require('../models/DatabaseManager');
const AuditLogger = require('../models/AuditLogger');
const InviteManager = require('../models/InviteManager');
const { getBaseUrl } = require('../utils/urlHelper');
const { requireAuth } = require('../middleware/auth');

const expiryManager = UserExpiryManager.getInstance();
const contactManager = ContactMethodManager.getInstance();

/**
 * GET /api/user/account-status
 * Get comprehensive account status including expiry, contact methods, and referral info
 */
router.get('/account-status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.Id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Get user profile
    const profile = await UserProfileManager.getProfile(userId).catch(() => null);

    // Get expiry information
    let expiryInfo = {
      expiresAt: null,
      daysRemaining: null,
      status: 'active',
      isExpiringSoon: false,
      message: null
    };

    try {
      const expiry = await expiryManager.getUserExpiry(userId);
      if (expiry) {
        expiryInfo.expiresAt = expiry;
        const now = new Date();
        const expiryDate = new Date(expiry);
        const daysRemaining = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
        
        expiryInfo.daysRemaining = daysRemaining;
        
        if (daysRemaining < 0) {
          expiryInfo.status = 'expired';
          expiryInfo.message = 'Your account has expired';
        } else if (daysRemaining <= 7) {
          expiryInfo.status = 'expiring_soon';
          expiryInfo.isExpiringSoon = true;
          expiryInfo.message = `Your account expires in ${daysRemaining} days`;
        } else {
          expiryInfo.status = 'active';
          expiryInfo.message = `Your account expires in ${daysRemaining} days`;
        }
      }
    } catch (err) {
      // User has no expiry set (likely admin)
      AuditLogger.log('debug', 'GET_EXPIRY_ERROR', { userId, error: err.message });
    }

    // Get contact methods
    const contactMethods = await contactManager.getContactMethods(userId);
    const verifiedMethods = await contactManager.getVerifiedMethods(userId);

    // Get referral information
    const referralsEnabled = await DatabaseManager.getSetting('referrals_enabled');
    const referralInfo = { enabled: referralsEnabled === 'true', referralLink: null, referralCode: null, referralsUsed: 0 };

    if (referralInfo.enabled) {
      try {
        const inviteManager = InviteManager.getInstance();
        const maxUses = parseInt(await DatabaseManager.getSetting('max_referrals_per_user')) || 5;
        const baseUrl = getBaseUrl(req);

        // Find existing referral invite created by this user
        const existing = await inviteManager.listInvites({ createdBy: userId, status: 'pending' });
        const referralInvite = existing.find(inv => {
          try { return JSON.parse(inv.metadata || '{}').type === 'referral'; } catch { return false; }
        });

        if (referralInvite) {
          referralInfo.referralCode = referralInvite.code;
          referralInfo.referralLink = `${baseUrl}/signup?invite=${referralInvite.code}`;
          referralInfo.referralsUsed = referralInvite.usageCount || 0;
        } else {
          // Create a referral invite — find first active signup profile
          let profileId = null;
          await new Promise(resolve => {
            DatabaseManager.db.get('SELECT id FROM signup_profiles WHERE isActive = 1 ORDER BY createdAt ASC LIMIT 1', [], (err, row) => {
              profileId = row ? row.id : null;
              resolve();
            });
          });
          if (profileId) {
            const newInvite = await inviteManager.createInvite(
              profileId, userId, null, { type: 'referral', referredBy: userId }, maxUses, null
            );
            referralInfo.referralCode = newInvite.code;
            referralInfo.referralLink = `${baseUrl}/signup?invite=${newInvite.code}`;
            referralInfo.referralsUsed = 0;
          }
        }
      } catch (refErr) {
        console.warn('Referral info error:', refErr.message);
      }
    }

    // Compile full account status
    const accountStatus = {
      user: {
        id: userId,
        name: req.session.user?.Name,
        isAdmin: !!req.session.user?.Policy?.IsAdministrator
      },
      profile,
      expiry: expiryInfo,
      contactMethods: {
        email: {
          enabled: contactMethods.email_enabled,
          verified: true  // Email is verified by default
        },
        discord: {
          enabled: contactMethods.discord_enabled,
          verified: contactMethods.discord_verified,
          userId: contactMethods.discord_verified ? contactMethods.discord_user_id : null
        },
        telegram: {
          enabled: contactMethods.telegram_enabled,
          verified: contactMethods.telegram_verified,
          chatId: contactMethods.telegram_verified ? contactMethods.telegram_chat_id : null
        },
        matrix: {
          enabled: contactMethods.matrix_enabled,
          verified: contactMethods.matrix_verified,
          userId: contactMethods.matrix_verified ? contactMethods.matrix_user_id : null
        }
      },
      verifiedMethods,
      referral: referralInfo
    };

    res.json({
      success: true,
      accountStatus
    });
  } catch (error) {
    console.error('Error getting account status:', error);
    AuditLogger.log('error', 'GET_ACCOUNT_STATUS_ERROR', {
      userId: req.session.user?.Id,
      error: error.message
    });
    res.status(500).json({ success: false, error: 'Failed to load account status' });
  }
});

/**
 * GET /api/user/lifecycle
 * Get account lifecycle events (expiry reminders, status changes, etc.)
 */
router.get('/lifecycle', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.Id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const lifecycle = await expiryManager.getUserLifecycleHistory(userId);

    res.json({
      success: true,
      events: lifecycle || []
    });
  } catch (error) {
    console.error('Error getting lifecycle events:', error);
    res.status(500).json({ success: false, error: 'Failed to load lifecycle events' });
  }
});

/**
 * POST /api/user/renewal-request
 * User requests account renewal. Server notifies admin(s) via configured channels.
 * Rate-limited: one successful request per day per user (enforced by audit log check).
 */
router.post('/renewal-request', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.Id;
    const username = req.session.user?.Name;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Check renewal is enabled
    const renewalEnabled = await DatabaseManager.getSetting('renewal_enabled');
    if (renewalEnabled !== 'true') {
      return res.status(403).json({ success: false, error: 'Account renewal requests are not enabled on this server' });
    }

    // Get user expiry
    const expiry = await expiryManager.getUserExpiry(userId).catch(() => null);
    if (!expiry) {
      return res.status(400).json({ success: false, error: 'Your account does not have an expiry date set' });
    }

    const now = new Date();
    const expiryDate = new Date(expiry);
    const daysRemaining = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));

    // Check within renewal window (configured days before or after expiry)
    const renewalWindowDays = parseInt(await DatabaseManager.getSetting('renewal_window_days')) || 30;
    if (daysRemaining > renewalWindowDays) {
      return res.status(400).json({
        success: false,
        error: `Renewal requests can only be submitted within ${renewalWindowDays} days of your account expiry date`
      });
    }

    // Rate limit: allow max one request per 24 hours per user
    const recentLogs = await AuditLogger.getLogs({ userId, action: 'RENEWAL_REQUEST', limit: 1 }).catch(() => []);
    if (recentLogs.length > 0) {
      const lastRequest = new Date(recentLogs[0].timestamp || recentLogs[0].created_at);
      const hoursSince = (now - lastRequest) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        return res.status(429).json({ success: false, error: 'You have already submitted a renewal request today. Please wait 24 hours.' });
      }
    }

    // Send notification to admin(s) via email + configured channels
    const SetupManager = require('../models/SetupManager');
    const NotificationManager = require('../models/NotificationManager');
    const config = SetupManager.getConfig();
    const serverName = config.appName || 'JellySSO';
    const expiresAtStr = expiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const variables = { serverName, username, expiresAt: expiresAtStr, daysRemaining: String(daysRemaining) };

    // Email to admin if configured
    const adminEmail = config.adminEmail || config.smtpFrom;
    if (adminEmail) {
      NotificationManager.getInstance().sendEmailNotification(adminEmail, 'renewal_request', variables)
        .catch(e => console.warn('Renewal request email failed:', e.message));
    }

    // Log the request
    await AuditLogger.log({
      action: 'RENEWAL_REQUEST',
      userId,
      resource: username,
      details: { expiresAt: expiry, daysRemaining },
      status: 'success',
      ip: req.ip
    });

    res.json({ success: true, message: 'Your renewal request has been sent to the server administrator.' });
  } catch (error) {
    console.error('Renewal request error:', error);
    res.status(500).json({ success: false, error: 'Failed to submit renewal request' });
  }
});

module.exports = router;
