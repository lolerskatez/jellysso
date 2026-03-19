const express = require('express');
const router = express.Router();
const AnnouncementsManager = require('../models/AnnouncementsManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/announcements
 * Get all active announcements (public endpoint)
 */
router.get('/', async (req, res) => {
  try {
    const announcementsManager = AnnouncementsManager.getInstance();
    const announcements = await announcementsManager.getActiveAnnouncements();

    res.json({
      success: true,
      announcements: announcements || []
    });
  } catch (err) {
    logger.error('Failed to fetch announcements:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements'
    });
  }
});

/**
 * GET /api/announcements/admin
 * Get all announcements (admin only)
 */
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const announcementsManager = AnnouncementsManager.getInstance();
    const announcements = await announcementsManager.getAllAnnouncements();

    res.json({
      success: true,
      announcements: announcements || []
    });
  } catch (err) {
    logger.error('Failed to fetch announcements:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements'
    });
  }
});

/**
 * POST /api/announcements
 * Create new announcement (admin only)
 */
router.post('/', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { title, message, displayPriority } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const announcementsManager = AnnouncementsManager.getInstance();
    const announcement = await announcementsManager.createAnnouncement({
      title: title.trim(),
      message: message.trim(),
      createdBy: req.session.user.Id,
      displayPriority: parseInt(displayPriority) || 0
    });

    await AuditLogger.log('ANNOUNCEMENT_CREATED', req.session.user.Id, 'admin:announcements',
      { announcementId: announcement.id, title }, 'success', req.ip);

    res.json({
      success: true,
      announcement
    });
  } catch (err) {
    logger.error('Failed to create announcement:', err.message);
    await AuditLogger.log('ANNOUNCEMENT_CREATE_ERROR', req.session.user?.Id, 'admin:announcements',
      { error: err.message }, 'failure', req.ip);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement'
    });
  }
});

/**
 * PUT /api/announcements/:id
 * Update announcement (admin only)
 */
router.put('/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, isActive, displayPriority, expiresAt } = req.body;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID'
      });
    }

    const announcementsManager = AnnouncementsManager.getInstance();
    await announcementsManager.updateAnnouncement(parseInt(id), {
      title,
      message,
      isActive,
      expiresAt,
      displayPriority
    });

    await AuditLogger.log('ANNOUNCEMENT_UPDATED', req.session.user.Id, 'admin:announcements',
      { announcementId: id }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Announcement updated'
    });
  } catch (err) {
    logger.error('Failed to update announcement:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to update announcement'
    });
  }
});

/**
 * DELETE /api/announcements/:id
 * Delete announcement (admin only)
 */
router.delete('/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID'
      });
    }

    const announcementsManager = AnnouncementsManager.getInstance();
    await announcementsManager.deleteAnnouncement(parseInt(id));

    await AuditLogger.log('ANNOUNCEMENT_DELETED', req.session.user.Id, 'admin:announcements',
      { announcementId: id }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Announcement deleted'
    });
  } catch (err) {
    logger.error('Failed to delete announcement:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to delete announcement'
    });
  }
});

/**
 * POST /api/announcements/:id/toggle
 * Toggle announcement active status (admin only)
 */
router.post('/:id/toggle', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid announcement ID'
      });
    }

    const announcementsManager = AnnouncementsManager.getInstance();
    await announcementsManager.toggleAnnouncementStatus(parseInt(id));

    await AuditLogger.log('ANNOUNCEMENT_TOGGLED', req.session.user.Id, 'admin:announcements',
      { announcementId: id }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Announcement status toggled'
    });
  } catch (err) {
    logger.error('Failed to toggle announcement:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle announcement'
    });
  }
});

module.exports = router;
