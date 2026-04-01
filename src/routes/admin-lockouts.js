'use strict';

/**
 * Admin API routes for Account Lockout management
 * Exposes AccountLockoutManager and raw DB queries to the admin UI
 */

const express = require('express');
const router = express.Router();
const DatabaseManager = require('../models/DatabaseManager');
const AccountLockoutManager = require('../models/AccountLockoutManager');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');

const lockoutManager = new AccountLockoutManager();

// GET /admin/api/lockouts — all currently locked accounts
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const db = DatabaseManager.getInstance().db;
  db.all(
    `SELECT id, username, locked_at, unlock_at, reason, attempts_count
     FROM account_lockouts
     WHERE unlock_at > datetime('now')
     ORDER BY locked_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, lockouts: rows });
    }
  );
});

// GET /admin/api/lockouts/history — login attempt history with optional filters
router.get('/history', requireAuth, requireAdmin, (req, res) => {
  const db = DatabaseManager.getInstance().db;
  const { username, limit = 100, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 100, 500);
  const off = parseInt(offset, 10) || 0;

  if (username) {
    db.all(
      `SELECT id, username, ip_address, success, timestamp, reason
       FROM login_attempts WHERE username = ?
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [username, lim, off],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, attempts: rows });
      }
    );
  } else {
    db.all(
      `SELECT id, username, ip_address, success, timestamp, reason
       FROM login_attempts
       ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [lim, off],
      (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error' });
        res.json({ success: true, attempts: rows });
      }
    );
  }
});

// DELETE /admin/api/lockouts/:username — unlock an account
router.delete('/:username', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    await lockoutManager.unlockAccount(req.params.username);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /admin/api/lockouts/cleanup — delete login attempts older than 30 days
router.post('/cleanup', csrfProtection, requireAuth, requireAdmin, async (req, res) => {
  try {
    const deleted = await lockoutManager.cleanupOldAttempts();
    res.json({ success: true, deleted: deleted || 0 });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
