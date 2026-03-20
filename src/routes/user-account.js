const express = require('express');
const router = express.Router();
const UserExpiryManager = require('../models/UserExpiryManager');
const ContactMethodManager = require('../models/ContactMethodManager');
const UserProfileManager = require('../models/UserProfileManager');
const AuditLogger = require('../models/AuditLogger');
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

    // Get referral information (if applicable)
    const referralInfo = {
      enabled: process.env.ENABLE_REFERRALS === 'true' || false,
      referralLink: null,
      referralCode: null,
      referralsUsed: 0
    };

    if (referralInfo.enabled) {
      // Generate referral link for this user
      const referralCode = Buffer.from(userId).toString('base64').substring(0, 12);
      const baseUrl = getBaseUrl(req);
      referralInfo.referralCode = referralCode;
      referralInfo.referralLink = `${baseUrl}/invite?ref=${referralCode}`;
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

module.exports = router;
