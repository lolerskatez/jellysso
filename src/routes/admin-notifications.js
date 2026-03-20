/**
 * Admin Notification Routes
 * Provides admin-only endpoints for managing the notification system.
 *
 * Mounted at: /api/admin/notifications (see server.js)
 */

const express = require('express');
const router = express.Router();
const DatabaseManager = require('../models/DatabaseManager');
const NotificationManager = require('../models/NotificationManager');
const NotificationQueue = require('../utils/NotificationQueue');
const SetupManager = require('../models/SetupManager');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────
// GET /api/admin/notifications/stats
// Queue summary counts
// ─────────────────────────────────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const nm = NotificationManager.getInstance();
    const stats = await nm.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    logger.error('Notification stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/notifications/queue
// List queue entries with optional status filter
// ─────────────────────────────────────────────
router.get('/queue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { status, limit = 50, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM notification_queue';
    const params = [];

    const allowedStatuses = ['pending', 'sent', 'failed', 'skipped'];
    if (status && allowedStatuses.includes(status)) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const db = DatabaseManager.getInstance().db;
    const rows = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

    // Count total for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM notification_queue';
    const countParams = [];
    if (status && allowedStatuses.includes(status)) {
      countQuery += ' WHERE status = ?';
      countParams.push(status);
    }
    const countRow = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });

    // Parse JSON fields
    const entries = rows.map(r => ({
      ...r,
      channels: (() => { try { return JSON.parse(r.channels); } catch { return []; } })(),
      variables: (() => { try { return JSON.parse(r.variables); } catch { return {}; } })()
    }));

    res.json({ success: true, entries, total: countRow?.total || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('Notification queue list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/notifications/queue/:id
// Cancel a pending queue entry
// ─────────────────────────────────────────────
router.delete('/queue/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const db = DatabaseManager.getInstance().db;

    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, status FROM notification_queue WHERE id = ?', [id], (err, r) => {
        if (err) return reject(err);
        resolve(r);
      });
    });

    if (!row) {
      return res.status(404).json({ success: false, message: 'Queue entry not found' });
    }

    if (row.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Cannot cancel entry with status "${row.status}"` });
    }

    await new Promise((resolve, reject) => {
      db.run('UPDATE notification_queue SET status = ?, error_message = ? WHERE id = ?',
        ['failed', 'Cancelled by admin', id],
        (err) => { if (err) return reject(err); resolve(); });
    });

    res.json({ success: true, message: 'Queue entry cancelled' });
  } catch (err) {
    logger.error('Cancel queue entry error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/notifications/queue
// Clear all non-pending entries (sent/failed/skipped)
// ─────────────────────────────────────────────
router.delete('/queue', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = DatabaseManager.getInstance().db;
    const result = await new Promise((resolve, reject) => {
      db.run(
        "DELETE FROM notification_queue WHERE status IN ('sent', 'failed', 'skipped')",
        [],
        function (err) { if (err) return reject(err); resolve(this.changes); }
      );
    });
    res.json({ success: true, deleted: result, message: `${result} entries cleared` });
  } catch (err) {
    logger.error('Clear queue error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/notifications/logs
// Notification delivery logs
// ─────────────────────────────────────────────
router.get('/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { channel, status, limit = 50, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = 'SELECT * FROM notification_logs WHERE 1=1';
    const params = [];

    const allowedChannels = ['email', 'discord', 'telegram', 'matrix'];
    if (channel && allowedChannels.includes(channel)) {
      query += ' AND channel = ?';
      params.push(channel);
    }

    if (status === 'sent' || status === 'failed') {
      query += ' AND status = ?';
      params.push(status);
    }

    // Count
    const countRow = await new Promise((resolve, reject) => {
      DatabaseManager.getInstance().db.get(
        'SELECT COUNT(*) as total FROM notification_logs WHERE 1=1' +
          (channel && allowedChannels.includes(channel) ? ' AND channel = ?' : '') +
          (status === 'sent' || status === 'failed' ? ' AND status = ?' : ''),
        params.slice(),
        (err, r) => { if (err) return reject(err); resolve(r); }
      );
    });

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const rows = await new Promise((resolve, reject) => {
      DatabaseManager.getInstance().db.all(query, params, (err, r) => {
        if (err) return reject(err);
        resolve(r || []);
      });
    });

    res.json({ success: true, logs: rows, total: countRow?.total || 0, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('Notification logs error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/admin/notifications/logs
// Clear all delivery logs
// ─────────────────────────────────────────────
router.delete('/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await new Promise((resolve, reject) => {
      DatabaseManager.getInstance().db.run(
        'DELETE FROM notification_logs',
        [],
        function (err) { if (err) return reject(err); resolve(this.changes); }
      );
    });
    res.json({ success: true, deleted: result });
  } catch (err) {
    logger.error('Clear logs error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/notifications/channels/status
// Connection status of all adapters
// ─────────────────────────────────────────────
router.get('/channels/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    const status = {};

    // Email
    const nm = NotificationManager.getInstance();
    status.email = {
      enabled: !!(config.email?.enabled),
      connected: !!(NotificationManager.emailTransporter),
      provider: config.email?.provider || 'smtp'
    };

    // Discord
    if (config.discord?.enabled) {
      try {
        const discord = NotificationManager.adapters.discord;
        status.discord = {
          enabled: true,
          ...(discord ? discord.getStatus() : { connected: false })
        };
      } catch {
        status.discord = { enabled: true, connected: false };
      }
    } else {
      status.discord = { enabled: false };
    }

    // Telegram
    if (config.telegram?.enabled) {
      try {
        const telegram = NotificationManager.adapters.telegram;
        const telegramStatus = telegram ? await telegram.testConnection() : { success: false };
        status.telegram = {
          enabled: true,
          ...(telegram ? telegram.getStatus() : { connected: false }),
          ...telegramStatus
        };
      } catch {
        status.telegram = { enabled: true, connected: false };
      }
    } else {
      status.telegram = { enabled: false };
    }

    // Matrix
    if (config.matrix?.enabled) {
      try {
        const matrix = NotificationManager.adapters.matrix;
        const matrixStatus = matrix ? await matrix.testConnection() : { success: false };
        status.matrix = {
          enabled: true,
          ...(matrix ? matrix.getStatus() : { connected: false }),
          ...matrixStatus
        };
      } catch {
        status.matrix = { enabled: true, connected: false };
      }
    } else {
      status.matrix = { enabled: false };
    }

    res.json({ success: true, status });
  } catch (err) {
    logger.error('Channel status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/admin/notifications/send
// Send a manual notification to a user
// ─────────────────────────────────────────────
router.post('/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, templateKey, channels, variables } = req.body;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    if (!templateKey || typeof templateKey !== 'string') {
      return res.status(400).json({ success: false, message: 'templateKey is required' });
    }

    const allowedChannels = ['email', 'discord', 'telegram', 'matrix'];
    const selectedChannels = Array.isArray(channels) && channels.length > 0
      ? channels.filter(c => allowedChannels.includes(c))
      : ['email'];

    if (selectedChannels.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid channels specified' });
    }

    const nm = NotificationManager.getInstance();
    const entry = await nm.send(userId, templateKey, variables || {}, {
      channels: selectedChannels,
      priority: 'high'
    });

    logger.info(`Admin manual notification queued: ${templateKey} → ${userId} by ${req.session.user?.Id}`);
    res.json({ success: true, entry, message: 'Notification queued' });
  } catch (err) {
    logger.error('Manual send error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/admin/notifications/templates
// List available notification templates
// ─────────────────────────────────────────────
router.get('/templates', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      DatabaseManager.getInstance().db.all(
        'SELECT key, name, subject, channels, description, created_at, updated_at FROM message_templates ORDER BY name ASC',
        [],
        (err, r) => { if (err) return reject(err); resolve(r || []); }
      );
    });
    res.json({ success: true, templates: rows });
  } catch (err) {
    logger.error('Templates list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
