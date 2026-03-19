const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');

/**
 * InviteManager - Manages user invite creation, validation, and acceptance
 * Supports token generation, tracking, and lifecycle management
 */
class InviteManager {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.getInstance().db;
    this.logger = AuditLogger;
    this.initializeTables();
  }

  static getInstance() {
    if (!InviteManager.instance) {
      InviteManager.instance = new InviteManager();
    }
    return InviteManager.instance;
  }

  /**
   * Initialize invites and related tables on startup
   */
  initializeTables() {
    try {
      // Create invites table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS invites (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          signupProfileId TEXT NOT NULL,
          createdBy TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          expiresAt DATETIME,
          acceptedBy TEXT,
          acceptedAt DATETIME,
          status TEXT DEFAULT 'pending',
          usageCount INTEGER DEFAULT 0,
          lastUsedAt DATETIME,
          metadata JSON,
          FOREIGN KEY (signupProfileId) REFERENCES signup_profiles(id),
          FOREIGN KEY (createdBy) REFERENCES users(id),
          FOREIGN KEY (acceptedBy) REFERENCES users(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error('Error creating invites table:', err);
        }
      });

      // Index for faster lookups
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            console.error('Error creating invites index:', err);
          }
        }
      );

      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_invites_status_expires ON invites(status, expiresAt)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            console.error('Error creating invites status index:', err);
          }
        }
      );

      // Create invite_tracking table (for analytics)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS invite_tracking (
          id TEXT PRIMARY KEY,
          inviteCode TEXT NOT NULL,
          eventType TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          ipAddress TEXT,
          userAgent TEXT,
          metadata JSON,
          FOREIGN KEY (inviteCode) REFERENCES invites(code)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          console.error('Error creating invite_tracking table:', err);
        }
      });
    } catch (error) {
      console.error('InviteManager initialization error:', error);
    }
  }

  /**
   * Generate a human-readable invite code
   * Format: JELLY-XXXX-XXXX (12 chars, easy to type/share)
   */
  generateInviteCode() {
    const chars = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // Excluded confusing chars (I, L, O, 1, 0)
    let code = 'JELLY';

    for (let i = 0; i < 8; i++) {
      if (i > 0 && i % 4 === 0) code += '-';
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return code;
  }

  /**
   * Create a new invite
   * @param {string} signupProfileId - Profile to apply when user signs up
   * @param {string} createdBy - Admin user ID who created the invite
   * @param {Date} expiresAt - Optional expiry date (null = never expires)
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Invite object with code
   */
  async createInvite(signupProfileId, createdBy, expiresAt = null, metadata = {}) {
    return new Promise((resolve, reject) => {
      try {
        const inviteId = crypto.randomBytes(16).toString('hex');
        const code = this.generateInviteCode();

        // Verify profile exists
        this.db.get(
          'SELECT id FROM signup_profiles WHERE id = ?',
          [signupProfileId],
          (err, profile) => {
            if (err) {
              this.logger.log('error', 'INVITE_CREATE_ERROR', { error: err.message });
              return reject(new Error('Database error: ' + err.message));
            }

            if (!profile) {
              this.logger.log('warn', 'INVITE_INVALID_PROFILE', { profileId: signupProfileId });
              return reject(new Error('Signup profile not found'));
            }

            // Insert invite
            this.db.run(
              `INSERT INTO invites (id, code, signupProfileId, createdBy, expiresAt, status, metadata)
               VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
              [inviteId, code, signupProfileId, createdBy, expiresAt, JSON.stringify(metadata)],
              function (err) {
                if (err) {
                  this.logger.log('error', 'INVITE_INSERT_ERROR', { error: err.message });
                  return reject(new Error('Failed to create invite'));
                }

                this.logger.log('info', 'INVITE_CREATED', {
                  inviteId,
                  code,
                  profileId: signupProfileId,
                  createdBy,
                  expiresAt
                });

                resolve({
                  id: inviteId,
                  code,
                  signupProfileId,
                  createdBy,
                  createdAt: new Date(),
                  expiresAt,
                  status: 'pending',
                  usageCount: 0
                });
              }
            );
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Validate an invite code
   * @param {string} code - Invite code to validate
   * @returns {Promise<Object>} Invite object if valid
   */
  async validateInvite(code) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          `SELECT * FROM invites WHERE code = ?`,
          [code],
          (err, invite) => {
            if (err) {
              this.logger.log('error', 'INVITE_VALIDATE_ERROR', { code, error: err.message });
              return reject(new Error('Database error'));
            }

            if (!invite) {
              this.logger.log('warn', 'INVITE_NOT_FOUND', { code });
              return reject(new Error('Invalid invite code'));
            }

            // Check if revoked
            if (invite.status === 'revoked') {
              this.logger.log('warn', 'INVITE_REVOKED', { code });
              return reject(new Error('This invite has been revoked'));
            }

            // Check if already accepted
            if (invite.status === 'accepted') {
              this.logger.log('warn', 'INVITE_ALREADY_USED', { code });
              return reject(new Error('This invite has already been used'));
            }

            // Check expiration
            if (invite.expiresAt) {
              const expiryDate = new Date(invite.expiresAt);
              if (expiryDate < new Date()) {
                // Auto-expire
                this.db.run(
                  'UPDATE invites SET status = ? WHERE code = ?',
                  ['expired', code]
                );
                this.logger.log('warn', 'INVITE_EXPIRED', { code });
                return reject(new Error('This invite has expired'));
              }
            }

            resolve(invite);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Accept an invite (create user from invite)
   * @param {string} code - Invite code
   * @param {string} userId - User ID accepting the invite
   * @returns {Promise<boolean>} Success
   */
  async acceptInvite(code, userId) {
    return new Promise((resolve, reject) => {
      try {
        const now = new Date();

        this.db.run(
          `UPDATE invites 
           SET status = 'accepted', acceptedBy = ?, acceptedAt = ?
           WHERE code = ?`,
          [userId, now.toISOString(), code],
          (err) => {
            if (err) {
              this.logger.log('error', 'INVITE_ACCEPT_ERROR', { code, userId, error: err.message });
              return reject(new Error('Failed to accept invite'));
            }

            this.logger.log('info', 'INVITE_ACCEPTED', { code, userId, timestamp: now });
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Revoke an invite (admin action)
   * @param {string} code - Invite code to revoke
   * @param {string} revokedBy - Admin user ID
   * @returns {Promise<boolean>} Success
   */
  async revokeInvite(code, revokedBy) {
    return new Promise((resolve, reject) => {
      try {
        this.db.run(
          `UPDATE invites SET status = 'revoked' WHERE code = ?`,
          [code],
          (err) => {
            if (err) {
              this.logger.log('error', 'INVITE_REVOKE_ERROR', { code, error: err.message });
              return reject(new Error('Failed to revoke invite'));
            }

            this.logger.log('info', 'INVITE_REVOKED', { code, revokedBy });
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get invite details
   * @param {string} code - Invite code
   * @returns {Promise<Object>} Invite object
   */
  async getInviteByCode(code) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM invites WHERE code = ?',
        [code],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  /**
   * List all invites (admin)
   * @param {Object} filters - Optional filters {status, createdBy, limit}
   * @returns {Promise<Array>} Array of invites
   */
  async listInvites(filters = {}) {
    return new Promise((resolve, reject) => {
      try {
        let query = 'SELECT * FROM invites WHERE 1=1';
        const params = [];

        if (filters.status) {
          query += ' AND status = ?';
          params.push(filters.status);
        }

        if (filters.createdBy) {
          query += ' AND createdBy = ?';
          params.push(filters.createdBy);
        }

        query += ' ORDER BY createdAt DESC';

        if (filters.limit) {
          query += ' LIMIT ?';
          params.push(filters.limit);
        }

        this.db.all(query, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get invite statistics
   * @returns {Promise<Object>} Stats object
   */
  async getInviteStats() {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          `SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
             SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
             SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
             SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) as revoked
           FROM invites`,
          [],
          (err, stats) => {
            if (err) reject(err);
            else resolve(stats || { total: 0, pending: 0, accepted: 0, expired: 0, revoked: 0 });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Bulk generate invites
   * @param {string} signupProfileId - Profile for all invites
   * @param {string} createdBy - Admin creating invites
   * @param {number} count - How many to generate
   * @param {Date} expiresAt - Optional expiry for all
   * @returns {Promise<Array>} Array of created invites
   */
  async bulkGenerateInvites(signupProfileId, createdBy, count = 10, expiresAt = null) {
    const invites = [];

    try {
      for (let i = 0; i < count; i++) {
        const invite = await this.createInvite(signupProfileId, createdBy, expiresAt);
        invites.push(invite);
      }

      this.logger.log('info', 'INVITES_BULK_GENERATED', { count, profileId: signupProfileId, createdBy });
      return invites;
    } catch (error) {
      this.logger.log('error', 'INVITES_BULK_ERROR', { count, error: error.message });
      throw error;
    }
  }

  /**
   * Clean up expired invites (mark as expired)
   * @returns {Promise<number>} Number of invites expired
   */
  async cleanupExpiredInvites() {
    return new Promise((resolve, reject) => {
      try {
        this.db.run(
          `UPDATE invites 
           SET status = 'expired' 
           WHERE status = 'pending' AND expiresAt IS NOT NULL AND expiresAt < datetime('now')`,
          function (err) {
            if (err) {
              this.logger.log('error', 'INVITE_CLEANUP_ERROR', { error: err.message });
              return reject(err);
            }

            const expiredCount = this.changes;
            if (expiredCount > 0) {
              this.logger.log('info', 'INVITES_CLEANUP', { expiredCount });
            }
            resolve(expiredCount);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Track invite usage (for analytics)
   * @param {string} code - Invite code
   * @param {string} eventType - Type of event (viewed, clicked, etc)
   * @param {Object} metadata - Additional metadata
   */
  async trackInviteUsage(code, eventType = 'viewed', metadata = {}) {
    return new Promise((resolve, reject) => {
      try {
        const trackingId = crypto.randomBytes(16).toString('hex');

        this.db.run(
          `INSERT INTO invite_tracking (id, inviteCode, eventType, metadata)
           VALUES (?, ?, ?, ?)`,
          [trackingId, code, eventType, JSON.stringify(metadata)],
          (err) => {
            if (err) {
              console.error('Error tracking invite usage:', err);
              return reject(err);
            }
            resolve(true);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get usage stats for an invite
   * @param {string} code - Invite code
   * @returns {Promise<Object>} Usage statistics
   */
  async getInviteUsageStats(code) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          `SELECT
             COUNT(*) as totalEvents,
             SUM(CASE WHEN eventType = 'viewed' THEN 1 ELSE 0 END) as views,
             SUM(CASE WHEN eventType = 'clicked' THEN 1 ELSE 0 END) as clicks,
             MAX(timestamp) as lastUsed
           FROM invite_tracking
           WHERE inviteCode = ?`,
          [code],
          (err, stats) => {
            if (err) reject(err);
            else resolve(stats || { totalEvents: 0, views: 0, clicks: 0, lastUsed: null });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = InviteManager;
