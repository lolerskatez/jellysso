const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const PasswordResetManager = require('../models/PasswordResetManager');
const UserProfileManager = require('../models/UserProfileManager');
const AuditLogger = require('../models/AuditLogger');
const SetupManager = require('../models/SetupManager');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/rate-limit');
const logger = require('../utils/logger');

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 * Public endpoint - rate limited
 */
router.post('/forgot-password', publicLimiter, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    // Find Jellyfin user
    let jellyfin;
    try {
      jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
    } catch (err) {
      logger.error('Failed to initialize Jellyfin API:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Service temporarily unavailable'
      });
    }

    let users;
    try {
      users = await jellyfin.getUsers();
    } catch (err) {
      logger.error('Failed to fetch users from Jellyfin:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Service temporarily unavailable'
      });
    }

    const user = users.find(u => u.Name.toLowerCase() === username.toLowerCase());

    if (!user) {
      // Don't reveal whether user exists
      await AuditLogger.log('FORGOT_PASSWORD_NOT_FOUND', 'unknown', 'auth:forgot-password',
        { username }, 'failure', req.ip);
      return res.json({
        success: true,
        message: 'If that account exists, you will receive a password reset email.'
      });
    }

    // Get user profile with email
    const profile = await UserProfileManager.getProfile(user.Id).catch(() => null);

    if (!profile || !profile.email) {
      await AuditLogger.log('FORGOT_PASSWORD_NO_EMAIL', user.Id, 'auth:forgot-password',
        { username: user.Name }, 'failure', req.ip);
      return res.json({
        success: true,
        message: 'If that account exists, you will receive a password reset email.'
      });
    }

    // Generate reset token
    const resetManager = PasswordResetManager.getInstance();
    const token = await resetManager.generateResetToken(user.Id, profile.email);

    // Build reset link
    const baseUrl = SetupManager.getConfig().appUrl || `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/auth/reset-password?token=${token}`;

    // Send email
    try {
      await resetManager.sendResetEmail(user.Id, profile.email, resetLink);
    } catch (err) {
      logger.error('Failed to send reset email:', err.message);
      // Don't fail the request - user won't know if email was sent
    }

    await AuditLogger.log('FORGOT_PASSWORD_REQUESTED', user.Id, 'auth:forgot-password',
      { email: profile.email }, 'success', req.ip);

    res.json({
      success: true,
      message: 'If that account exists, you will receive a password reset email.'
    });
  } catch (err) {
    logger.error('Forgot password error:', err.message);
    await AuditLogger.log('FORGOT_PASSWORD_ERROR', 'unknown', 'auth:forgot-password',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred'
    });
  }
});

/**
 * GET /api/auth/reset-password/validate
 * Validate a password reset token
 */
router.get('/reset-password/validate', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ valid: false, message: 'Token is required' });
    }

    const resetManager = PasswordResetManager.getInstance();
    const tokenData = await resetManager.validateToken(token);

    if (!tokenData) {
      return res.json({ valid: false, message: 'Token is invalid or has expired' });
    }

    // Get user info (don't expose email)
    res.json({
      valid: true,
      message: 'Token is valid',
      userId: tokenData.user_id
    });
  } catch (err) {
    logger.error('Token validation error:', err.message);
    res.status(500).json({ valid: false, message: 'Validation error' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', publicLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    // Validate password strength
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Validate token
    const resetManager = PasswordResetManager.getInstance();
    const tokenData = await resetManager.validateToken(token);

    if (!tokenData) {
      await AuditLogger.log('PASSWORD_RESET_INVALID_TOKEN', 'unknown', 'auth:reset-password',
        {}, 'failure', req.ip);
      return res.status(400).json({
        success: false,
        message: 'Token is invalid or has expired'
      });
    }

    // Update password in Jellyfin
    try {
      const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
      await jellyfin.resetUserPassword(tokenData.user_id, newPassword);
    } catch (err) {
      logger.error('Failed to update password in Jellyfin:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to update password. Please try again later.'
      });
    }

    // Mark token as used
    await resetManager.markTokenAsUsed(token);

    await AuditLogger.log('PASSWORD_RESET_SUCCESS', tokenData.user_id, 'auth:reset-password',
      {}, 'success', req.ip);

    res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (err) {
    logger.error('Password reset error:', err.message);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred'
    });
  }
});

/**
 * POST /api/auth/pin-reset
 * Apply a Jellyfin-generated PIN to set a new password.
 * The PIN payload is a base64url-encoded JSON object placed by JellyfinPinWatcher
 * into the link: { pin, username, userId }
 */
router.post('/pin-reset', publicLimiter, async (req, res) => {
  try {
    const { data, newPassword } = req.body;

    if (!data || !newPassword) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    // Decode the PIN payload
    let payload;
    try {
      payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid reset data' });
    }

    const { pin, username, userId } = payload;
    if (!pin || !username) {
      return res.status(400).json({ success: false, message: 'Invalid reset data' });
    }

    // Use the Jellyfin PIN to authenticate the reset (verify PIN is accepted by Jellyfin)
    let jellyfin;
    try {
      jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
    } catch (err) {
      logger.error('PIN reset: failed to init Jellyfin API:', err.message);
      return res.status(500).json({ success: false, message: 'Service temporarily unavailable' });
    }

    // Apply the PIN (this validates it against Jellyfin and sets the password to PIN first)
    try {
      await jellyfin.resetPasswordWithPin(username, pin);
    } catch (err) {
      logger.warn(`PIN reset: Jellyfin PIN application failed for ${username}: ${err.message}`);
      await AuditLogger.log('PIN_RESET_INVALID', userId || 'unknown', 'auth:pin-reset',
        { username }, 'failure', req.ip);
      return res.status(400).json({ success: false, message: 'PIN is invalid or has expired' });
    }

    // Now set the user's desired new password
    try {
      await jellyfin.updateUserPassword(userId || username, pin, newPassword);
    } catch (err) {
      logger.error(`PIN reset: failed to set new password for ${username}: ${err.message}`);
      return res.status(500).json({ success: false, message: 'Failed to set new password' });
    }

    await AuditLogger.log('PIN_RESET_SUCCESS', userId || username, 'auth:pin-reset',
      { username }, 'success', req.ip);

    res.json({ success: true, message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    logger.error('PIN reset error:', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred' });
  }
});

/**
 * GET /api/auth/pin-reset/config
 * Returns whether PIN-file password reset is enabled (for UI feature detection).
 * Admin-only.
 */
router.get('/pin-reset/config', requireAuth, async (req, res) => {
  try {
    const DatabaseManager = require('../models/DatabaseManager');
    const configDir = await DatabaseManager.getSetting('jellyfin_config_dir');
    const mode = (await DatabaseManager.getSetting('pin_reset_mode')) || 'link';
    res.json({
      enabled: !!configDir,
      configDir: configDir || null,
      mode
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
