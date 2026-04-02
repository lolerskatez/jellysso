const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const UserProfileManager = require('../models/UserProfileManager');
const ContactMethodManager = require('../models/ContactMethodManager');
const InviteManager = require('../models/InviteManager');
const OTPManager = require('../models/OTPManager');
const AuditLogger = require('../models/AuditLogger');
const NotificationManager = require('../models/NotificationManager');
const SessionActivityManager = require('../models/SessionActivityManager');
const DatabaseManager = require('../models/DatabaseManager');
const logger = require('../utils/logger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/me
 * Return the current user's Jellyfin profile merged with local profile data and contact methods.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const profile = await UserProfileManager.getProfile(req.session.user.Id).catch(() => null);
    const contactMethods = await ContactMethodManager.getInstance()
      .getContactMethods(req.session.user.Id)
      .catch(() => ({
        email_enabled: true,
        discord_enabled: false,
        telegram_enabled: false,
        matrix_enabled: false
      }));

    res.json({
      success: true,
      user: {
        id: req.session.user.Id,
        name: req.session.user.Name,
        isAdmin: !!(req.session.user.Policy?.IsAdministrator)
      },
      profile,
      contactMethods,
      authMethod: req.session.authMethod || 'local'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/me/profile
 * Update the current user's local profile (name, email) and optionally their
 * Jellyfin username (local accounts only).
 */
router.put('/profile', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { firstName, lastName, displayName, email, jellyfinUsername } = req.body;

    // Input validation
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }
    if (displayName && typeof displayName !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid display name.' });
    }

    const userId = req.session.user.Id;

    // Update local profile
    await UserProfileManager.upsertProfile(userId, {
      firstName: firstName || null,
      lastName:  lastName  || null,
      displayName: displayName || null,
      email:     email     || null
    });

    // Update Jellyfin username only for non-SSO users
    let usernameChanged = false;
    if (jellyfinUsername && jellyfinUsername.trim() && req.session.authMethod !== 'oidc') {
      const newName = jellyfinUsername.trim();
      if (newName !== req.session.user.Name) {
        if (newName.length < 2 || newName.length > 50) {
          return res.status(400).json({ success: false, message: 'Username must be 2–50 characters.' });
        }
        if (!/^[a-zA-Z0-9_\-.]+$/.test(newName)) {
          return res.status(400).json({ success: false, message: 'Username may only contain letters, numbers, underscores, hyphens and dots.' });
        }

        const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
        await jellyfin.updateUser(userId, { ...req.session.user, Name: newName });

        // Refresh session with new name
        req.session.user = { ...req.session.user, Name: newName };
        usernameChanged = true;
      }
    }

    await AuditLogger.log('PROFILE_UPDATE', userId, 'user:profile',
      { fieldsUpdated: Object.keys(req.body).filter(k => req.body[k]), usernameChanged },
      'success', req.ip);

    res.json({ success: true, usernameChanged });
  } catch (err) {
    logger.error('Profile update error:', err.message);
    await AuditLogger.log('PROFILE_UPDATE_ERROR', req.session.user?.Id, 'user:profile',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: err.message || 'Failed to update profile.' });
  }
});

/**
 * POST /api/me/password
 * Change the current user's Jellyfin password.
 * Requires the current password for verification (re-authentication).
 * Not available for OIDC/SSO accounts.
 */
router.post('/password', requireAuth, csrfProtection, async (req, res) => {
  if (req.session.authMethod === 'oidc') {
    return res.status(403).json({ success: false, message: 'Password changes are managed by your SSO provider.' });
  }

  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ success: false, message: 'New password must differ from your current password.' });
  }

  try {
    const config = SetupManager.getConfig();

    // Verify current password by re-authenticating against Jellyfin
    const verifyApi = new JellyfinAPI(config.jellyfinUrl);
    try {
      await verifyApi.authenticateByName(req.session.user.Name, currentPassword);
    } catch {
      await AuditLogger.log('PASSWORD_CHANGE_WRONG_CURRENT', req.session.user.Id, 'user:password',
        {}, 'failure', req.ip);
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    // Set new password via admin API key so we don't need to re-auth
    const adminApi = new JellyfinAPI(config.jellyfinUrl, config.apiKey);
    await adminApi.resetUserPassword(req.session.user.Id, newPassword);

    await AuditLogger.log('PASSWORD_CHANGE', req.session.user.Id, 'user:password',
      {}, 'success', req.ip);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    logger.error('Password change error:', err.message);
    await AuditLogger.log('PASSWORD_CHANGE_ERROR', req.session.user?.Id, 'user:password',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: err.message || 'Failed to update password.' });
  }
});

/**
 * GET /api/me/otp
 * Returns whether a generated password exists for this SSO user.
 */
router.get('/otp', requireAuth, async (req, res) => {
  if (req.session.authMethod !== 'oidc') {
    return res.status(403).json({ success: false, message: 'Only available for SSO accounts.' });
  }
  try {
    const record = await OTPManager.getRecord(req.session.user.Id);
    if (!record) return res.json({ hasPassword: false });
    res.json({ hasPassword: true, createdAt: record.createdAt });
  } catch (err) {
    logger.error('Generated password status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/me/otp
 * Generate (or regenerate) a Jellyfin password for an SSO user.
 * Plaintext returned exactly once — never stored.
 */
router.post('/otp', requireAuth, csrfProtection, async (req, res) => {
  if (req.session.authMethod !== 'oidc') {
    return res.status(403).json({ success: false, message: 'Only available for SSO accounts.' });
  }
  try {
    const userId = req.session.user.Id;
    const config = SetupManager.getConfig();
    const adminApi = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    const { password, createdAt } = await OTPManager.create(userId);
    await adminApi.resetUserPassword(userId, password);

    await AuditLogger.log('GENERATED_PASSWORD_CREATED', userId, 'user:password',
      { createdAt }, 'success', req.ip);

    res.json({ success: true, password, createdAt });
  } catch (err) {
    logger.error('Generated password error:', err.message);
    await AuditLogger.log('GENERATED_PASSWORD_ERROR', req.session.user?.Id, 'user:password',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: err.message || 'Failed to generate password.' });
  }
});

/**
 * PUT /api/me/email
 * Update user's email address
 * Sends verification email for non-SSO accounts
 */
router.put('/email', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { newEmail, currentPassword } = req.body;
    const userId = req.session.user.Id;

    // Validate email format
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    // Check if email is already in use
    const existingProfile = await UserProfileManager.getProfileByEmail(newEmail).catch(() => null);
    if (existingProfile && existingProfile.user_id !== userId) {
      return res.status(409).json({ success: false, message: 'Email address is already in use.' });
    }

    // For non-SSO users, verify current password
    if (req.session.authMethod !== 'oidc' && !currentPassword) {
      return res.status(400).json({ success: false, message: 'Current password required for email change.' });
    }

    if (req.session.authMethod !== 'oidc') {
      try {
        const config = SetupManager.getConfig();
        const verifyApi = new JellyfinAPI(config.jellyfinUrl);
        await verifyApi.authenticateByName(req.session.user.Name, currentPassword);
      } catch {
        await AuditLogger.log('EMAIL_CHANGE_WRONG_PASSWORD', userId, 'user:email',
          {}, 'failure', req.ip);
        return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      }
    }

    // Update email in profile
    const profile = await UserProfileManager.getProfile(userId).catch(() => ({}));
    await UserProfileManager.upsertProfile(userId, {
      ...profile,
      email: newEmail
    });

    await AuditLogger.log('EMAIL_CHANGED', userId, 'user:email',
      { newEmail }, 'success', req.ip);

    res.json({ success: true, message: 'Email updated successfully.' });
  } catch (err) {
    logger.error('Email change error:', err.message);
    await AuditLogger.log('EMAIL_CHANGE_ERROR', req.session.user?.Id, 'user:email',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: err.message || 'Failed to update email.' });
  }
});

/**
 * GET /api/me/notifications/preferences
 * Get user's notification channel preferences
 */
router.get('/notifications/preferences', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const notificationManager = NotificationManager.getInstance();
    
    const preferences = await notificationManager.getUserPreferences(userId);
    const availableChannels = notificationManager.getAvailableChannels();

    res.json({
      success: true,
      preferences,
      availableChannels
    });
  } catch (err) {
    logger.error('Error fetching notification preferences:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch notification preferences.' });
  }
});

/**
 * PUT /api/me/notifications/preferences
 * Update user's notification channel preferences
 */
router.put('/notifications/preferences', requireAuth, csrfProtection, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid preferences object.' });
    }

    // Validate preference fields
    const validPrefs = {
      email_enabled: !!preferences.email_enabled,
      discord_enabled: !!preferences.discord_enabled,
      discord_user_id: preferences.discord_user_id || null,
      telegram_enabled: !!preferences.telegram_enabled,
      telegram_chat_id: preferences.telegram_chat_id || null,
      matrix_enabled: !!preferences.matrix_enabled,
      matrix_user_id: preferences.matrix_user_id || null,
      notification_digest: !!preferences.notification_digest
    };

    const notificationManager = NotificationManager.getInstance();
    await notificationManager.saveUserPreferences(userId, validPrefs);

    await AuditLogger.log('NOTIFICATION_PREFERENCES_UPDATED', userId, 'user:notifications',
      { channels: Object.keys(validPrefs).filter(k => validPrefs[k]) }, 'success', req.ip);

    res.json({ success: true, message: 'Notification preferences updated.' });
  } catch (err) {
    logger.error('Error updating notification preferences:', err.message);
    await AuditLogger.log('NOTIFICATION_PREFERENCES_ERROR', req.session.user?.Id, 'user:notifications',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: 'Failed to update preferences.' });
  }
});

/**
 * GET /api/me/sessions
 * Get list of user's active and recent sessions
 */
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const { history = false, limit = 50, offset = 0 } = req.query;

    const sessionManager = SessionActivityManager.getInstance();
    
    let sessions;
    if (history === 'true') {
      // Get full history with pagination
      sessions = await sessionManager.getSessionHistory(userId, parseInt(limit), parseInt(offset));
    } else {
      // Get active sessions only
      sessions = await sessionManager.getActiveSessions(userId);
    }

    // Add browser/device info from user agent parsing
    const enhancedSessions = sessions.map(session => ({
      ...session,
      current: session.session_id === req.sessionID
    }));

    res.json({
      success: true,
      sessions: enhancedSessions,
      total: sessions.length
    });
  } catch (err) {
    logger.error('Error fetching sessions:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions.' });
  }
});

/**
 * POST /api/me/sessions/:sessionId/terminate
 * Terminate a specific user session (logout other devices)
 */
router.post('/sessions/:sessionId/terminate', requireAuth, csrfProtection, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const { sessionId } = req.params;

    // Prevent user from terminating their current session via this endpoint
    if (sessionId === req.sessionID) {
      return res.status(400).json({ success: false, message: 'Use logout to end your current session.' });
    }

    const sessionManager = SessionActivityManager.getInstance();
    await sessionManager.terminateSession(sessionId, userId);

    await AuditLogger.log('SESSION_TERMINATED', userId, 'user:sessions',
      { terminatedSessionId: sessionId }, 'success', req.ip);

    res.json({ success: true, message: 'Session terminated.' });
  } catch (err) {
    logger.error('Error terminating session:', err.message);
    await AuditLogger.log('SESSION_TERMINATION_ERROR', req.session.user?.Id, 'user:sessions',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: 'Failed to terminate session.' });
  }
});

/**
 * GET /api/me/login-history
 * Get user's login history with pagination
 */
router.get('/login-history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const { limit = 25, offset = 0 } = req.query;

    const sessionManager = SessionActivityManager.getInstance();
    const loginHistory = await sessionManager.getSessionHistory(userId, parseInt(limit), parseInt(offset));

    // Format for display
    const formattedHistory = loginHistory.map(entry => ({
      id: entry.id,
      loginTime: entry.login_time,
      logoutTime: entry.logout_time,
      ipAddress: entry.ip_address,
      userAgent: entry.user_agent,
      durationMinutes: entry.duration_minutes,
      status: entry.status
    }));

    res.json({
      success: true,
      loginHistory: formattedHistory
    });
  } catch (err) {
    logger.error('Error fetching login history:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch login history.' });
  }
});

/**
 * POST /api/me/export
 * Export user data for GDPR compliance (data portability)
 * Returns JSON with user profile, settings, and history
 */
router.post('/export', requireAuth, csrfProtection, async (req, res) => {
  try {
    const userId = req.session.user.Id;
    const userName = req.session.user.Name;

    // Collect user data
    const profile = await UserProfileManager.getProfile(userId).catch(() => ({}));
    
    const sessionManager = SessionActivityManager.getInstance();
    const loginHistory = await sessionManager.getSessionHistory(userId, 1000);

    const notificationManager = NotificationManager.getInstance();
    const notificationPrefs = await notificationManager.getUserPreferences(userId);

    // Get audit logs for this user
    const auditLogs = await new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const query = `
        SELECT action, resource, details, result, timestamp, ip_address 
        FROM audit_log 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 1000
      `;
      db.all(query, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Compile GDPR export
    const exportData = {
      exportDate: new Date().toISOString(),
      jellyfin: {
        userId: userId,
        userName: userName,
        isAdmin: !!(req.session.user.Policy?.IsAdministrator)
      },
      profile,
      notificationPreferences: notificationPrefs,
      loginHistory: loginHistory.map(l => ({
        loginTime: l.login_time,
        logoutTime: l.logout_time,
        ipAddress: l.ip_address,
        userAgent: l.user_agent,
        status: l.status
      })),
      auditLog: auditLogs,
      authMethod: req.session.authMethod || 'local'
    };

    // Log the export
    await AuditLogger.log('GDPR_DATA_EXPORT', userId, 'user:export',
      { exportSize: JSON.stringify(exportData).length }, 'success', req.ip);

    // Send as downloadable JSON file
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="jellysso-data-export-${userId}-${Date.now()}.json"`);
    res.json(exportData);
  } catch (err) {
    logger.error('Error exporting user data:', err.message);
    await AuditLogger.log('GDPR_EXPORT_ERROR', req.session.user?.Id, 'user:export',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: 'Failed to export user data.' });
  }
});

/**
 * GET /api/me/referral
 * Get or create the user's referral invite link.
 * Only available when referrals_enabled setting is true.
 */
router.get('/referral', requireAuth, async (req, res) => {
  try {
    const referralsEnabled = await DatabaseManager.getSetting('referrals_enabled').catch(() => null);
    if (referralsEnabled !== 'true') {
      return res.status(403).json({ success: false, message: 'Referrals are not enabled on this server.' });
    }

    const userId = req.session.user.Id;
    const inviteManager = InviteManager.getInstance();
    const invite = await inviteManager.getOrCreateReferralInvite(userId);
    const usageCount = await inviteManager.getReferralCount(userId);

    const config = SetupManager.getConfig();
    const baseUrl = config.webAppPublicUrl || '';
    const referralUrl = `${baseUrl}/signup?invite=${encodeURIComponent(invite.code)}`;

    res.json({
      success: true,
      referralCode: invite.code,
      referralUrl,
      usageCount,
      expiresAt: invite.expiresAt
    });
  } catch (err) {
    logger.error('Referral link error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to get referral link.' });
  }
});

module.exports = router;
