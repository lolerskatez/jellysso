const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');
const logger = require('../utils/logger');

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
          maxUses INTEGER DEFAULT 1,
          userExpiryDays INTEGER,
          metadata JSON,
          FOREIGN KEY (signupProfileId) REFERENCES signup_profiles(id),
          FOREIGN KEY (createdBy) REFERENCES users(id),
          FOREIGN KEY (acceptedBy) REFERENCES users(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          logger.error('Error creating invites table:', err);
        }
      });

      // Index for faster lookups
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            logger.error('Error creating invites index:', err);
          }
        }
      );

      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_invites_status_expires ON invites(status, expiresAt)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            logger.error('Error creating invites status index:', err);
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
          logger.error('Error creating invite_tracking table:', err);
        }
      });
    } catch (error) {
      logger.error('InviteManager initialization error:', error);
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
   * @param {number} maxUses - Maximum number of times the invite can be used (default 1)
   * @param {number|null} userExpiryDays - Days until the accepted user's account expires (null = never)
   * @returns {Promise<Object>} Invite object with code
   */
  async createInvite(signupProfileId, createdBy, expiresAt = null, metadata = {}, maxUses = 1, userExpiryDays = null) {
    return new Promise((resolve, reject) => {
      try {
        const inviteId = crypto.randomBytes(16).toString('hex');
        const code = this.generateInviteCode();
        const safeMaxUses = Math.max(1, parseInt(maxUses) || 1);

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
              `INSERT INTO invites (id, code, signupProfileId, createdBy, expiresAt, status, metadata, maxUses, userExpiryDays)
               VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
              [inviteId, code, signupProfileId, createdBy, expiresAt, JSON.stringify(metadata), safeMaxUses, userExpiryDays || null],
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
                  expiresAt,
                  maxUses: safeMaxUses,
                  userExpiryDays
                });

                resolve({
                  id: inviteId,
                  code,
                  signupProfileId,
                  createdBy,
                  createdAt: new Date(),
                  expiresAt,
                  status: 'pending',
                  usageCount: 0,
                  maxUses: safeMaxUses,
                  userExpiryDays: userExpiryDays || null
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

            // Check if fully used up (maxUses reached)
            const maxUses = invite.maxUses || 1;
            if (invite.usageCount >= maxUses || invite.status === 'accepted') {
              this.logger.log('warn', 'INVITE_ALREADY_USED', { code, usageCount: invite.usageCount, maxUses });
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
   * Increments usageCount; marks status='accepted' only when maxUses is reached.
   * @param {string} code - Invite code
   * @param {string} userId - User ID accepting the invite
   * @returns {Promise<Object>} Invite row after update (includes userExpiryDays)
   */
  async acceptInvite(code, userId) {
    return new Promise((resolve, reject) => {
      try {
        const now = new Date();

        // Fetch current invite state so we can compute new usageCount and maxUses
        this.db.get('SELECT * FROM invites WHERE code = ?', [code], (err, invite) => {
          if (err) {
            this.logger.log('error', 'INVITE_ACCEPT_FETCH_ERROR', { code, error: err.message });
            return reject(new Error('Failed to fetch invite'));
          }
          if (!invite) {
            return reject(new Error('Invite not found'));
          }

          const newUsageCount = (invite.usageCount || 0) + 1;
          const maxUses = invite.maxUses || 1;
          const fullyUsed = newUsageCount >= maxUses;

          // If fully used: mark accepted + record first acceptor; otherwise keep pending
          const newStatus = fullyUsed ? 'accepted' : 'pending';
          const acceptedBy = fullyUsed ? userId : (invite.acceptedBy || userId);
          const acceptedAt = fullyUsed ? now.toISOString() : (invite.acceptedAt || now.toISOString());

          this.db.run(
            `UPDATE invites 
             SET status = ?, acceptedBy = ?, acceptedAt = ?, usageCount = ?, lastUsedAt = ?
             WHERE code = ?`,
            [newStatus, acceptedBy, acceptedAt, newUsageCount, now.toISOString(), code],
            (updateErr) => {
              if (updateErr) {
                this.logger.log('error', 'INVITE_ACCEPT_ERROR', { code, userId, error: updateErr.message });
                return reject(new Error('Failed to accept invite'));
              }

              this.logger.log('info', 'INVITE_ACCEPTED', {
                code, userId, usageCount: newUsageCount, maxUses, fullyUsed
              });
              resolve({ ...invite, usageCount: newUsageCount, status: newStatus });
            }
          );
        });
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
  async bulkGenerateInvites(signupProfileId, createdBy, count = 10, expiresAt = null, maxUses = 1, userExpiryDays = null) {
    const invites = [];

    try {
      for (let i = 0; i < count; i++) {
        const invite = await this.createInvite(signupProfileId, createdBy, expiresAt, {}, maxUses, userExpiryDays);
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
              logger.error('Error tracking invite usage:', err);
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

  /**
   * Set or update invite label (for organization)
   * @param {string} code - Invite code
   * @param {string} label - Label for the invite (e.g., "Spring 2026", "Friends")
   * @returns {Promise<void>}
   */
  async setInviteLabel(code, label) {
    return new Promise((resolve, reject) => {
      try {
        // Get existing metadata
        this.db.get(
          'SELECT metadata FROM invites WHERE code = ?',
          [code],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Invite not found'));

            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            metadata.label = label;

            // Update metadata with new label
            this.db.run(
              'UPDATE invites SET metadata = ? WHERE code = ?',
              [JSON.stringify(metadata), code],
              (updateErr) => {
                if (updateErr) {
                  this.logger.log('error', 'SET_INVITE_LABEL_ERROR', { code, label, error: updateErr.message });
                  return reject(updateErr);
                }

                this.logger.log('info', 'INVITE_LABEL_SET', { code, label });
                resolve();
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
   * Get invite label
   * @param {string} code - Invite code
   * @returns {Promise<string|null>} Label or null if not set
   */
  async getInviteLabel(code) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          'SELECT metadata FROM invites WHERE code = ?',
          [code],
          (err, row) => {
            if (err) reject(err);
            else {
              const metadata = row?.metadata ? JSON.parse(row.metadata) : {};
              resolve(metadata.label || null);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Record that an invite was pre-sent (via email or Discord)
   * @param {string} code - Invite code
   * @param {string} method - Delivery method (email, discord, telegram)
   * @param {string} recipient - Who it was sent to (email or username)
   * @returns {Promise<void>}
   */
  async recordPreSend(code, method, recipient) {
    return new Promise((resolve, reject) => {
      try {
        // Get existing metadata
        this.db.get(
          'SELECT metadata FROM invites WHERE code = ?',
          [code],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Invite not found'));

            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            
            // Initialize sentTo array if not exists
            if (!metadata.sentTo) {
              metadata.sentTo = [];
            }

            // Add pre-send record
            metadata.sentTo.push({
              method,
              recipient,
              sentAt: new Date().toISOString()
            });

            // Update metadata
            this.db.run(
              'UPDATE invites SET metadata = ? WHERE code = ?',
              [JSON.stringify(metadata), code],
              (updateErr) => {
                if (updateErr) {
                  this.logger.log('error', 'RECORD_PRESEND_ERROR', { code, method, recipient, error: updateErr.message });
                  return reject(updateErr);
                }

                this.logger.log('info', 'INVITE_PRESENT', { code, method, recipient });
                resolve();
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
   * Get pre-send statistics for an invite
   * @param {string} code - Invite code
   * @returns {Promise<{sentViaEmail: number, sentViaDiscord: number, sentViaTelegram: number, sentTo: Array}>}
   */
  async getPresendStats(code) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          'SELECT metadata FROM invites WHERE code = ?',
          [code],
          (err, row) => {
            if (err) return reject(err);
            if (!row) return reject(new Error('Invite not found'));

            const metadata = row.metadata ? JSON.parse(row.metadata) : {};
            const sentTo = metadata.sentTo || [];

            const stats = {
              sentViaEmail: sentTo.filter(s => s.method === 'email').length,
              sentViaDiscord: sentTo.filter(s => s.method === 'discord').length,
              sentViaTelegram: sentTo.filter(s => s.method === 'telegram').length,
              sentVia: sentTo.filter(s => s.method === 'matrix').length,
              totalSent: sentTo.length,
              sentTo: sentTo
            };

            resolve(stats);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * List invites by label
   * @param {string} label - Label to filter by
   * @returns {Promise<Array>} Array of invites with matching label
   */
  async listInvitesByLabel(label) {
    return new Promise((resolve, reject) => {
      try {
        // Note: This requires JSON parsing in Node, simpler than SQL JSON for compatibility
        this.db.all(
          'SELECT * FROM invites ORDER BY createdAt DESC',
          [],
          (err, rows) => {
            if (err) return reject(err);

            const filtered = (rows || []).filter(row => {
              const metadata = row.metadata ? JSON.parse(row.metadata) : {};
              return metadata.label === label;
            });

            resolve(filtered);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = InviteManager;
