/**
 * Labels API Routes
 * Handles label creation, management, and bulk user operations
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const LabelManager = require('../models/LabelManager');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rate-limit');
const AuditLogger = require('../models/AuditLogger');
const logger = require('../utils/logger');

// Apply admin-only rate limiting
router.use(adminLimiter);

/**
 * GET /api/labels
 * Get all labels with optional statistics
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { includeStats } = req.query;
    const labels = await LabelManager.getAllLabels();

    if (includeStats === 'true') {
      const stats = await LabelManager.getLabelCounts();
      const labelsWithCounts = labels.map(label => ({
        ...label,
        userCount: stats.find(s => s.id === label.id)?.count || 0
      }));
      return res.json({
        success: true,
        labels: labelsWithCounts,
        total: labelsWithCounts.length
      });
    }

    res.json({
      success: true,
      labels,
      total: labels.length
    });
  } catch (err) {
    logger.error('Error fetching labels:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch labels',
      error: err.message
    });
  }
});

/**
 * POST /api/labels
 * Create a new label
 */
router.post('/', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { name, color, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Label name is required'
      });
    }

    const label = await LabelManager.createLabel(
      { name, color, description },
      req.session.user?.Id
    );

    res.status(201).json({
      success: true,
      message: 'Label created successfully',
      label
    });
  } catch (err) {
    if (err.message.includes('already exists')) {
      return res.status(409).json({
        success: false,
        message: err.message
      });
    }
    logger.error('Error creating label:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create label',
      error: err.message
    });
  }
});

/**
 * GET /api/labels/stats
 * Get label statistics (before specific ID route to avoid conflicts)
 */
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await LabelManager.getLabelStatistics();
    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    logger.error('Error fetching label stats:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: err.message
    });
  }
});

/**
 * GET /api/labels/search/:term
 * Search labels by name or description
 */
router.get('/search/:term', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { term } = req.params;
    if (!term || term.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search term must be at least 2 characters'
      });
    }

    const results = await LabelManager.searchLabels(term);
    res.json({
      success: true,
      results,
      count: results.length
    });
  } catch (err) {
    logger.error('Error searching labels:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to search labels',
      error: err.message
    });
  }
});

/**
 * GET /api/labels/:id
 * Get specific label details
 */
router.get('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const label = await LabelManager.getLabelById(id);

    if (!label) {
      return res.status(404).json({
        success: false,
        message: 'Label not found'
      });
    }

    res.json({
      success: true,
      label
    });
  } catch (err) {
    logger.error('Error fetching label:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch label',
      error: err.message
    });
  }
});

/**
 * PATCH /api/labels/:id
 * Update label
 */
router.patch('/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, description } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (description !== undefined) updates.description = description;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const updated = await LabelManager.updateLabel(id, updates, req.session.user?.Id);

    res.json({
      success: true,
      message: 'Label updated successfully',
      label: updated
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: err.message
      });
    }
    logger.error('Error updating label:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update label',
      error: err.message
    });
  }
});

/**
 * DELETE /api/labels/:id
 * Delete label (soft delete)
 */
router.delete('/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    await LabelManager.deleteLabel(id, req.session.user?.Id);

    res.json({
      success: true,
      message: 'Label deleted successfully'
    });
  } catch (err) {
    logger.error('Error deleting label:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete label',
      error: err.message
    });
  }
});

/**
 * GET /api/labels/:id/users
 * Get all users with a specific label
 */
router.get('/:id/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const users = await LabelManager.getUsersWithLabel(id);

    res.json({
      success: true,
      users,
      count: users.length
    });
  } catch (err) {
    logger.error('Error fetching label users:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch label users',
      error: err.message
    });
  }
});

/**
 * POST /api/labels/:id/users
 * Assign label to multiple users (bulk operation)
 */
router.post('/:id/users', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userIds must be a non-empty array'
      });
    }

    const count = await LabelManager.assignLabelToUsers(userIds, parseInt(id), req.session.user?.Id);

    res.json({
      success: true,
      message: `Label assigned to ${count} users`,
      assigned: count
    });
  } catch (err) {
    logger.error('Error assigning label to users:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to assign label',
      error: err.message
    });
  }
});

/**
 * DELETE /api/labels/:id/users
 * Remove label from multiple users (bulk operation)
 */
router.delete('/:id/users', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userIds must be a non-empty array'
      });
    }

    const count = await LabelManager.removeLabelFromUsers(userIds, parseInt(id), req.session.user?.Id);

    res.json({
      success: true,
      message: `Label removed from ${count} users`,
      removed: count
    });
  } catch (err) {
    logger.error('Error removing label from users:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove label',
      error: err.message
    });
  }
});

/**
 * GET /api/labels/user/:userId
 * Get all labels for a specific user
 */
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Users can only see their own labels unless admin
    if (req.session.user?.Id !== userId && !req.session.user?.Policy?.IsAdministrator) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Cannot view other users labels'
      });
    }

    const labels = await LabelManager.getLabelsForUser(userId);

    res.json({
      success: true,
      labels,
      count: labels.length
    });
  } catch (err) {
    logger.error('Error fetching user labels:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user labels',
      error: err.message
    });
  }
});

/**
 * POST /api/labels/user/:userId/assign
 * Assign multiple labels to a user
 */
router.post('/user/:userId/assign', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userId } = req.params;
    const { labelIds } = req.body;

    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'labelIds must be a non-empty array'
      });
    }

    const count = await LabelManager.assignLabelsToUser(userId, labelIds, req.session.user?.Id);

    res.json({
      success: true,
      message: `${count} labels assigned to user`,
      assigned: count
    });
  } catch (err) {
    logger.error('Error assigning labels to user:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to assign labels',
      error: err.message
    });
  }
});

/**
 * DELETE /api/labels/user/:userId/remove
 * Remove multiple labels from a user
 */
router.delete('/user/:userId/remove', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userId } = req.params;
    const { labelIds } = req.body;

    if (!Array.isArray(labelIds) || labelIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'labelIds must be a non-empty array'
      });
    }

    const count = await LabelManager.removeLabelsFromUser(userId, labelIds, req.session.user?.Id);

    res.json({
      success: true,
      message: `${count} labels removed from user`,
      removed: count
    });
  } catch (err) {
    logger.error('Error removing labels from user:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove labels',
      error: err.message
    });
  }
});

/**
 * POST /api/labels/:id/users/:userId
 * Assign single label to single user
 */
router.post('/:id/users/:userId', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id, userId } = req.params;

    await LabelManager.assignLabelToUser(userId, parseInt(id), req.session.user?.Id);

    res.json({
      success: true,
      message: 'Label assigned to user'
    });
  } catch (err) {
    logger.error('Error assigning label to user:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to assign label',
      error: err.message
    });
  }
});

/**
 * DELETE /api/labels/:id/users/:userId
 * Remove single label from single user
 */
router.delete('/:id/users/:userId', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { id, userId } = req.params;

    await LabelManager.removeLabelFromUser(userId, parseInt(id), req.session.user?.Id);

    res.json({
      success: true,
      message: 'Label removed from user'
    });
  } catch (err) {
    logger.error('Error removing label from user:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to remove label',
      error: err.message
    });
  }
});

module.exports = router;
