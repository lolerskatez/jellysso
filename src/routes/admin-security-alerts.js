'use strict';

/**
 * Admin API routes for Security Alert management
 */

const express = require('express');
const router = express.Router();
const DatabaseManager = require('../models/DatabaseManager');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

function db() {
  return DatabaseManager.getInstance().db;
}

// GET /admin/api/security-alerts — list all alerts with optional filters
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const { severity, type, unread, limit = 100, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);
  const off = parseInt(offset, 10) || 0;

  const conditions = [];
  const params = [];

  if (severity) { conditions.push('severity = ?'); params.push(severity); }
  if (type)     { conditions.push('alert_type = ?'); params.push(type); }
  if (unread === '1') { conditions.push('read = 0'); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  db().all(
    `SELECT id, user_id, alert_type, severity, title, message, metadata, ip_address, read, created_at
     FROM security_alerts
     ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, lim, off],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      const alerts = (rows || []).map(r => ({
        ...r,
        metadata: (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })()
      }));
      res.json({ success: true, alerts });
    }
  );
});

// GET /admin/api/security-alerts/stats — severity counts
router.get('/stats', requireAuth, requireAdmin, (req, res) => {
  db().all(
    `SELECT severity, COUNT(*) as count, SUM(CASE WHEN read=0 THEN 1 ELSE 0 END) as unread
     FROM security_alerts
     GROUP BY severity`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, stats: rows || [] });
    }
  );
});

// PATCH /admin/api/security-alerts/:id/read — mark single alert read
router.patch('/:id/read', csrfProtection, requireAuth, requireAdmin, (req, res) => {
  db().run(
    `UPDATE security_alerts SET read = 1 WHERE id = ?`,
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true });
    }
  );
});

// PATCH /admin/api/security-alerts/read-all — mark all alerts read
router.patch('/read-all', csrfProtection, requireAuth, requireAdmin, (req, res) => {
  db().run(
    `UPDATE security_alerts SET read = 1 WHERE read = 0`,
    [],
    function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, updated: this.changes });
    }
  );
});

// DELETE /admin/api/security-alerts/:id — delete single alert
router.delete('/:id', csrfProtection, requireAuth, requireAdmin, (req, res) => {
  db().run(
    `DELETE FROM security_alerts WHERE id = ?`,
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true });
    }
  );
});

// DELETE /admin/api/security-alerts — clear all alerts (or by severity)
router.delete('/', csrfProtection, requireAuth, requireAdmin, (req, res) => {
  const { severity } = req.query;
  if (severity) {
    db().run(`DELETE FROM security_alerts WHERE severity = ?`, [severity], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, deleted: this.changes });
    });
  } else {
    db().run(`DELETE FROM security_alerts`, [], function(err) {
      if (err) return res.status(500).json({ success: false, message: 'Database error' });
      res.json({ success: true, deleted: this.changes });
    });
  }
});

module.exports = router;
