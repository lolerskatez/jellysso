/**
 * Admin API Key management routes
 * GET  /admin/api/api-keys          — list all keys
 * POST /admin/api/api-keys          — create key for a user
 * DELETE /admin/api/api-keys/:id    — delete key
 * PATCH /admin/api/api-keys/:id/revoke — revoke (disable) key
 */

const express = require('express');
const router = express.Router();
const DatabaseManager = require('../models/DatabaseManager');
const APIKeyManager = require('../models/APIKeyManager');
const AuditLogger = require('../models/AuditLogger');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const logger = require('../utils/logger');

// ── helpers ──────────────────────────────────────────────────────────────────

async function getAllKeys(db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, user_id, name, permissions, last_used, last_ip, request_count,
              active, created_at, expires_at
       FROM api_keys
       ORDER BY created_at DESC`,
      [],
      (err, rows) => {
        if (err) return reject(err);
        resolve((rows || []).map(r => ({
          ...r,
          permissions: (() => { try { return JSON.parse(r.permissions || '[]'); } catch { return []; } })()
        })));
      }
    );
  });
}

// ── routes ────────────────────────────────────────────────────────────────────

// GET all API keys (admin view)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = DatabaseManager.getInstance().db;
    const keys = await getAllKeys(db);
    res.json({ success: true, keys, total: keys.length });
  } catch (err) {
    logger.error('Failed to list API keys:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve API keys' });
  }
});

// POST create a new API key for a given userId
router.post('/', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { userId, name, permissions, expiresAt } = req.body;
    if (!userId || !name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'userId and name are required' });
    }

    const allowedPerms = ['read', 'write', 'admin'];
    const perms = Array.isArray(permissions)
      ? permissions.filter(p => allowedPerms.includes(p))
      : [];

    const manager = APIKeyManager.getInstance();
    const result = await manager.createAPIKey(userId, name.trim(), perms, expiresAt || null);

    await AuditLogger.log('API_KEY_CREATED', req.session.user.Id, 'admin:api-keys',
      { keyId: result.id, name: name.trim(), userId }, 'success', req.ip);

    res.status(201).json({ success: true, key: result });
  } catch (err) {
    logger.error('Failed to create API key:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create API key' });
  }
});

// PATCH revoke (disable) a key without deleting it
router.patch('/:id/revoke', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid key ID' });

    const manager = APIKeyManager.getInstance();
    await manager.revokeAPIKey(id);

    await AuditLogger.log('API_KEY_REVOKED', req.session.user.Id, 'admin:api-keys',
      { keyId: id }, 'success', req.ip);

    res.json({ success: true, message: 'API key revoked' });
  } catch (err) {
    logger.error('Failed to revoke API key:', err.message);
    res.status(500).json({ success: false, message: 'Failed to revoke API key' });
  }
});

// DELETE permanently delete a key
router.delete('/:id', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid key ID' });

    const manager = APIKeyManager.getInstance();
    await manager.deleteAPIKey(id);

    await AuditLogger.log('API_KEY_DELETED', req.session.user.Id, 'admin:api-keys',
      { keyId: id }, 'success', req.ip);

    res.json({ success: true, message: 'API key deleted' });
  } catch (err) {
    logger.error('Failed to delete API key:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete API key' });
  }
});

module.exports = router;
