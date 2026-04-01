/**
 * Admin Webhook Management Routes
 * CRUD for webhooks + event delivery history
 */

const express = require('express');
const router = express.Router();
const WebhookManager = require('../models/WebhookManager');
const DatabaseManager = require('../models/DatabaseManager');
const AuditLogger = require('../models/AuditLogger');
const logger = require('../utils/logger');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

const wm = WebhookManager.getInstance();

/**
 * GET /admin/api/webhooks
 * List all webhooks across all users
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await DatabaseManager.query(`
      SELECT w.*, COUNT(we.id) as event_count,
             SUM(CASE WHEN we.status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM webhooks w
      LEFT JOIN webhook_events we ON we.webhook_id = w.id
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `);

    const webhooks = (rows || []).map(row => ({
      ...row,
      events: (() => { try { return JSON.parse(row.events); } catch { return []; } })()
    }));

    res.json({ success: true, webhooks });
  } catch (error) {
    logger.error('Failed to list webhooks', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to list webhooks' });
  }
});

/**
 * POST /admin/api/webhooks
 * Create a webhook (admin creates on behalf of a user)
 * Body: { userId, url, events[], secret?, retryCount?, timeoutSeconds? }
 */
router.post('/', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, url, events, secret, retryCount, timeoutSeconds } = req.body;

    if (!userId || !url || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: 'userId, url, and at least one event are required' });
    }

    // Validate URL
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ success: false, error: 'Invalid URL' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ success: false, error: 'URL must use http or https' });
    }

    const webhookId = await wm.createWebhook(userId, url, events, secret || null);

    // Apply optional fields if provided
    const extras = {};
    if (retryCount !== undefined) extras.retry_count = Math.max(0, Math.min(10, parseInt(retryCount) || 3));
    if (timeoutSeconds !== undefined) extras.timeout_seconds = Math.max(5, Math.min(120, parseInt(timeoutSeconds) || 30));
    if (Object.keys(extras).length > 0) {
      await DatabaseManager.run(
        `UPDATE webhooks SET retry_count = COALESCE(?, retry_count), timeout_seconds = COALESCE(?, timeout_seconds) WHERE id = ?`,
        [extras.retry_count ?? null, extras.timeout_seconds ?? null, webhookId]
      );
    }

    AuditLogger.log('info', 'WEBHOOK_CREATED', { adminId: req.session.user?.Id, webhookId, userId, url });
    res.json({ success: true, webhookId });
  } catch (error) {
    logger.error('Failed to create webhook', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create webhook' });
  }
});

/**
 * PATCH /admin/api/webhooks/:id
 * Update a webhook
 * Body: { url?, events?, secret?, active?, retryCount?, timeoutSeconds? }
 */
router.patch('/:id', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const webhookId = parseInt(req.params.id);
    if (!webhookId) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });

    const existing = await wm.getWebhook(webhookId);
    if (!existing) return res.status(404).json({ success: false, error: 'Webhook not found' });

    const { url, events, secret, active } = req.body;
    const updates = {};
    if (url !== undefined) {
      try { const p = new URL(url); if (!['http:', 'https:'].includes(p.protocol)) throw new Error(); } catch { return res.status(400).json({ success: false, error: 'Invalid URL' }); }
      updates.url = url;
    }
    if (events !== undefined) updates.events = events;
    if (secret !== undefined) updates.secret = secret;
    if (active !== undefined) updates.active = active;

    await wm.updateWebhook(webhookId, updates);

    // Handle retryCount / timeoutSeconds separately (not in updateWebhook)
    const { retryCount, timeoutSeconds } = req.body;
    if (retryCount !== undefined || timeoutSeconds !== undefined) {
      const rc = retryCount !== undefined ? Math.max(0, Math.min(10, parseInt(retryCount) || 3)) : null;
      const ts = timeoutSeconds !== undefined ? Math.max(5, Math.min(120, parseInt(timeoutSeconds) || 30)) : null;
      if (rc !== null) await DatabaseManager.run(`UPDATE webhooks SET retry_count = ? WHERE id = ?`, [rc, webhookId]);
      if (ts !== null) await DatabaseManager.run(`UPDATE webhooks SET timeout_seconds = ? WHERE id = ?`, [ts, webhookId]);
    }

    AuditLogger.log('info', 'WEBHOOK_UPDATED', { adminId: req.session.user?.Id, webhookId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update webhook', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update webhook' });
  }
});

/**
 * DELETE /admin/api/webhooks/:id
 * Delete a webhook and all its events
 */
router.delete('/:id', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const webhookId = parseInt(req.params.id);
    if (!webhookId) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });

    const existing = await wm.getWebhook(webhookId);
    if (!existing) return res.status(404).json({ success: false, error: 'Webhook not found' });

    await wm.deleteWebhook(webhookId);
    AuditLogger.log('info', 'WEBHOOK_DELETED', { adminId: req.session.user?.Id, webhookId });
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete webhook', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to delete webhook' });
  }
});

/**
 * GET /admin/api/webhooks/:id/events
 * Get delivery history for a webhook
 */
router.get('/:id/events', requireAuth, requireAdmin, async (req, res) => {
  try {
    const webhookId = parseInt(req.params.id);
    if (!webhookId) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });

    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const events = await DatabaseManager.query(
      `SELECT id, event_type, status, response_code, attempts, last_attempt, created_at
       FROM webhook_events WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`,
      [webhookId, limit]
    );

    res.json({ success: true, events: events || [] });
  } catch (error) {
    logger.error('Failed to get webhook events', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get webhook events' });
  }
});

/**
 * POST /admin/api/webhooks/:id/test
 * Send a test ping event to the webhook URL
 */
router.post('/:id/test', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const webhookId = parseInt(req.params.id);
    if (!webhookId) return res.status(400).json({ success: false, error: 'Invalid webhook ID' });

    const webhook = await wm.getWebhook(webhookId);
    if (!webhook) return res.status(404).json({ success: false, error: 'Webhook not found' });

    await wm.triggerEvent('test.ping', { message: 'Test event from JellySSO admin', timestamp: new Date().toISOString() }, webhook.user_id);
    res.json({ success: true, message: 'Test event queued for delivery' });
  } catch (error) {
    logger.error('Failed to send test webhook', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to send test event' });
  }
});

module.exports = router;
