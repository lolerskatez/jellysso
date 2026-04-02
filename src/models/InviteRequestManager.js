const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');
const logger = require('../utils/logger');

/**
 * InviteRequestManager - Manages invite requests submitted by prospective users
 */
class InviteRequestManager {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.getInstance().db;
    this.auditLogger = AuditLogger;
    this.initializeTables();
  }

  static getInstance() {
    if (!InviteRequestManager.instance) {
      InviteRequestManager.instance = new InviteRequestManager();
    }
    return InviteRequestManager.instance;
  }

  initializeTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS invite_requests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewedAt DATETIME,
        reviewedBy TEXT,
        reviewNote TEXT,
        inviteId TEXT
      )
    `, (err) => {
      if (err && !err.message.includes('already exists')) {
        logger.error('Error creating invite_requests table:', err);
      }
    });

    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_invite_requests_status ON invite_requests(status)',
      (err) => {
        if (err && !err.message.includes('already exists')) {
          logger.error('Error creating invite_requests index:', err);
        }
      }
    );
  }

  createRequest({ name, email, reason }) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.db.run(
        `INSERT INTO invite_requests (id, name, email, reason) VALUES (?, ?, ?, ?)`,
        [id, name, email || null, reason || null],
        (err) => {
          if (err) return reject(err);
          resolve({ id, name, email, reason, status: 'pending' });
        }
      );
    });
  }

  listRequests(filters = {}) {
    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM invite_requests';
      const params = [];
      if (filters.status) {
        sql += ' WHERE status = ?';
        params.push(filters.status);
      }
      sql += ' ORDER BY createdAt DESC';
      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  getRequest(id) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM invite_requests WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  updateStatus(id, status, { reviewedBy, reviewNote, inviteId } = {}) {
    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      this.db.run(
        `UPDATE invite_requests
         SET status = ?, reviewedAt = ?, reviewedBy = ?, reviewNote = ?, inviteId = ?
         WHERE id = ?`,
        [status, now, reviewedBy || null, reviewNote || null, inviteId || null, id],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  }

  deleteRequest(id) {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM invite_requests WHERE id = ?', [id], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

module.exports = InviteRequestManager;
