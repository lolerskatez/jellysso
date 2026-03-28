const express = require('express');
const router = express.Router();
const MessageTemplateManager = require('../models/MessageTemplateManager');
const AuditLogger = require('../models/AuditLogger');
const logger = require('../utils/logger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const templateMgr = MessageTemplateManager.getInstance();

/**
 * GET /api/admin/templates - List all message templates
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const templates = await templateMgr.getAllTemplates();
    res.json({ success: true, templates });
  } catch (error) {
    logger.error('Templates list error:', error);
    res.status(500).json({ success: false, error: 'Failed to load templates' });
  }
});

/**
 * GET /api/admin/templates/:key - Get a single template by key
 */
router.get('/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const template = await templateMgr.getTemplate(req.params.key);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, template });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load template' });
  }
});

/**
 * PUT /api/admin/templates/:key - Create or update a template
 * Body: { title, subject, body, format, variables? }
 */
router.put('/:key', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { title, subject, body, format = 'markdown', variables } = req.body;

    if (!title || !subject || !body) {
      return res.status(400).json({ success: false, error: 'title, subject, and body are required' });
    }

    // Sanitise key: only alphanumeric + underscores
    if (!/^[a-z0-9_]+$/.test(key)) {
      return res.status(400).json({ success: false, error: 'Invalid template key format' });
    }

    const userId = req.session.user?.Id || 'admin';
    await templateMgr.upsertTemplate(key, { title, subject, body, format, variables }, userId);

    AuditLogger.log('info', 'TEMPLATE_UPDATED', { userId, key });

    res.json({ success: true, message: 'Template saved' });
  } catch (error) {
    logger.error('Template update error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to save template' });
  }
});

/**
 * PATCH /api/admin/templates/:key/toggle - Enable or disable a template
 * Body: { isActive: boolean }
 */
router.patch('/:key/toggle', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive (boolean) is required' });
    }

    await templateMgr.toggleTemplateActive(key, isActive);

    AuditLogger.log('info', 'TEMPLATE_TOGGLED', { userId: req.session.user?.Id, key, isActive });
    res.json({ success: true, message: `Template ${isActive ? 'enabled' : 'disabled'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to toggle template' });
  }
});

/**
 * POST /api/admin/templates/:key/preview - Render a template with sample variables
 * Body: { body, variables: { key: value } }
 */
router.post('/:key/preview', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { body, variables = {} } = req.body;

    if (!body) {
      return res.status(400).json({ success: false, error: 'body is required for preview' });
    }

    // Use the renderTemplate helper directly (no DB lookup needed for preview)
    const rendered = templateMgr.renderTemplate({ body }, variables);
    res.json({ success: true, rendered });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to render preview' });
  }
});

/**
 * DELETE /api/admin/templates/:key - Delete a custom template (cannot delete defaults)
 */
router.delete('/:key', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;

    const template = await templateMgr.getTemplate(key);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    if (template.is_default) {
      return res.status(400).json({ success: false, error: 'Cannot delete a default template. Disable it instead.' });
    }

    await templateMgr.deleteTemplate(key);
    AuditLogger.log('info', 'TEMPLATE_DELETED', { userId: req.session.user?.Id, key });
    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete template' });
  }
});

module.exports = router;
