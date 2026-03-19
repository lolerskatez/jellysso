/**
 * Announcements Manager
 * Manages global system announcements displayed to users
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class AnnouncementsManager {
  static instance = null;

  static getInstance() {
    if (!AnnouncementsManager.instance) {
      AnnouncementsManager.instance = new AnnouncementsManager();
      AnnouncementsManager.instance.initializeSchema();
    }
    return AnnouncementsManager.instance;
  }

  /**
   * Initialize announcements table
   */
  async initializeSchema() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(`
        CREATE TABLE IF NOT EXISTS announcements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          is_active INTEGER DEFAULT 1,
          created_by TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME,
          display_priority INTEGER DEFAULT 0
        )
      `, (err) => {
        if (err) {
          logger.error('Failed to create announcements table:', err.message);
          reject(err);
        } else {
          DatabaseManager.db.run(`
            CREATE INDEX IF NOT EXISTS idx_announcements_active_expiry 
            ON announcements(is_active, expires_at DESC)
          `, (indexErr) => {
            if (indexErr) logger.warn('Index creation warning:', indexErr.message);
            logger.info('Announcements schema initialized');
            resolve();
          });
        }
      });
    });
  }

  /**
   * Get all active announcements
   * @returns {Promise<Array>} Array of active announcements
   */
  async getActiveAnnouncements() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(
        `SELECT * FROM announcements 
         WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY display_priority DESC, created_at DESC`,
        [],
        (err, rows) => {
          if (err) {
            logger.error('Failed to fetch announcements:', err.message);
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get all announcements (admin view)
   * @returns {Promise<Array>} Array of all announcements
   */
  async getAllAnnouncements() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(
        `SELECT * FROM announcements ORDER BY created_at DESC`,
        [],
        (err, rows) => {
          if (err) {
            logger.error('Failed to fetch announcements:', err.message);
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Create announcement
   * @param {Object} data - Announcement data
   * @returns {Promise<Object>} Created announcement
   */
  async createAnnouncement(data) {
    const { title, message, createdBy, expiresAt, displayPriority = 0 } = data;

    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `INSERT INTO announcements (title, message, created_by, expires_at, display_priority, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [title, message, createdBy, expiresAt || null, displayPriority],
        function(err) {
          if (err) {
            logger.error('Failed to create announcement:', err.message);
            reject(err);
          } else {
            logger.info(`Announcement created (ID: ${this.lastID})`);
            resolve({
              id: this.lastID,
              title,
              message,
              is_active: 1,
              created_by: createdBy,
              display_priority: displayPriority
            });
          }
        }
      );
    });
  }

  /**
   * Update announcement
   * @param {number} id - Announcement ID
   * @param {Object} data - Updated data
   */
  async updateAnnouncement(id, data) {
    const { title, message, isActive, expiresAt, displayPriority } = data;
    const updates = [];
    const values = [];

    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (message !== undefined) {
      updates.push('message = ?');
      values.push(message);
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      values.push(isActive ? 1 : 0);
    }
    if (expiresAt !== undefined) {
      updates.push('expires_at = ?');
      values.push(expiresAt);
    }
    if (displayPriority !== undefined) {
      updates.push('display_priority = ?');
      values.push(displayPriority);
    }

    if (updates.length === 0) {
      return Promise.resolve({ message: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`;

    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(query, values, (err) => {
        if (err) {
          logger.error('Failed to update announcement:', err.message);
          reject(err);
        } else {
          logger.info(`Announcement ${id} updated`);
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * Delete announcement
   * @param {number} id - Announcement ID
   */
  async deleteAnnouncement(id) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `DELETE FROM announcements WHERE id = ?`,
        [id],
        (err) => {
          if (err) {
            logger.error('Failed to delete announcement:', err.message);
            reject(err);
          } else {
            logger.info(`Announcement ${id} deleted`);
            resolve({ success: true });
          }
        }
      );
    });
  }

  /**
   * Toggle announcement status
   * @param {number} id - Announcement ID
   */
  async toggleAnnouncementStatus(id) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        `UPDATE announcements SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id],
        (err) => {
          if (err) {
            logger.error('Failed to toggle announcement:', err.message);
            reject(err);
          } else {
            logger.info(`Announcement ${id} toggled`);
            resolve({ success: true });
          }
        }
      );
    });
  }
}

module.exports = AnnouncementsManager;
