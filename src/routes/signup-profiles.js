const express = require('express');
const router = express.Router();
const SignupProfileManager = require('../models/SignupProfileManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Initialize managers
const profileManager = SignupProfileManager.getInstance();
const auditLogger = AuditLogger;

// Rate limiting for public endpoints
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * GET /api/signup-profiles - List profiles
 * Admin sees all, public sees only active
 */
router.get('/', publicLimiter, async (req, res) => {
  try {
    const isAdmin = req.user && req.user.isAdmin;
    const profiles = await profileManager.listProfiles(activeOnly = !isAdmin);

    res.json({
      success: true,
      profiles,
      total: profiles.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list profiles' });
  }
});

/**
 * GET /api/signup-profiles/:id - Get profile details
 * Public endpoint for signup form
 */
router.get('/:id', publicLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    const profile = await profileManager.getProfile(id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    // Hide isActive from public if not admin
    if (!req.user || !req.user.isAdmin) {
      if (!profile.isActive) {
        return res.status(404).json({ success: false, error: 'Profile not found' });
      }
    }

    res.json({
      success: true,
      profile
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get profile' });
  }
});

/**
 * POST /api/signup-profiles - Create profile (admin only)
 */
router.post('/', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, ...config } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Profile name is required' });
    }

    const profile = await profileManager.createProfile(name, {
      ...config,
      createdBy: req.user.id
    });

    auditLogger.log('info', 'PROFILE_CREATED', {
      userId: req.user.id,
      profileId: profile.id,
      profileName: name
    });

    res.status(201).json({
      success: true,
      profile
    });
  } catch (error) {
    auditLogger.log('error', 'PROFILE_CREATE_ERROR', {
      userId: req.user?.id,
      error: error.message
    });
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/signup-profiles/:id - Update profile (admin only)
 */
router.put('/:id', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const updated = await profileManager.updateProfile(id, req.body);

    auditLogger.log('info', 'PROFILE_UPDATED', {
      userId: req.user.id,
      profileId: id
    });

    res.json({
      success: true,
      profile: updated
    });
  } catch (error) {
    auditLogger.log('error', 'PROFILE_UPDATE_ERROR', {
      userId: req.user?.id,
      profileId: req.params.id,
      error: error.message
    });
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/signup-profiles/:id - Delete profile (admin only)
 */
router.delete('/:id', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await profileManager.deleteProfile(id);

    auditLogger.log('info', 'PROFILE_DELETED', {
      userId: req.user.id,
      profileId: id
    });

    res.json({ success: true, message: 'Profile deleted' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/signup-profiles/:id/duplicate - Duplicate profile (admin only)
 */
router.post('/:id/duplicate', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newName } = req.body;

    if (!newName) {
      return res.status(400).json({ success: false, error: 'New profile name is required' });
    }

    const profile = await profileManager.duplicateProfile(id, newName);

    auditLogger.log('info', 'PROFILE_DUPLICATED', {
      userId: req.user.id,
      originalProfileId: id,
      newProfileId: profile.id
    });

    res.status(201).json({
      success: true,
      profile
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/signup-profiles/:id/usage-stats - Get profile usage stats (admin only)
 */
router.get('/:id/usage-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const stats = await profileManager.getProfileUsageStats(id);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get profile stats' });
  }
});

/**
 * GET /api/signup-profiles/with-stats - List all profiles with stats (admin only)
 */
router.get('/admin/with-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const profiles = await profileManager.listProfilesWithStats();

    res.json({
      success: true,
      profiles,
      total: profiles.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list profiles' });
  }
});

module.exports = router;
