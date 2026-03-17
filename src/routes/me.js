const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const UserProfileManager = require('../models/UserProfileManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');

const requireAuth = (req, res, next) => {
  if (req.session.accessToken) return next();
  res.status(401).json({ success: false, message: 'Unauthorized' });
};

/**
 * GET /api/me
 * Return the current user's Jellyfin profile merged with local profile data.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const profile = await UserProfileManager.getProfile(req.session.user.Id).catch(() => null);
    res.json({
      success: true,
      user: {
        id: req.session.user.Id,
        name: req.session.user.Name,
        isAdmin: !!(req.session.user.Policy?.IsAdministrator)
      },
      profile,
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
    console.error('Profile update error:', err.message);
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
    console.error('Password change error:', err.message);
    await AuditLogger.log('PASSWORD_CHANGE_ERROR', req.session.user?.Id, 'user:password',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({ success: false, message: err.message || 'Failed to update password.' });
  }
});

module.exports = router;
