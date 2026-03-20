/**
 * Label Manager
 * Manages user labels for organization, categorization, and bulk operations
 * Labels enable admins to group users for permissions, invites, analytics, and notifications
 */

const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');

class LabelManager {
  constructor() {
    this.db = DatabaseManager.db;
    this.initialized = false;
    this.initializeSchema();
  }

  /**
   * Initialize database schema for labels
   */
  initializeSchema() {
    if (!this.db) return;

    this.db.serialize(() => {
      // Labels table - stores label definitions
      this.db.run(`
        CREATE TABLE IF NOT EXISTS labels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          color TEXT DEFAULT '#0066CC',
          description TEXT,
          createdBy TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          isActive INTEGER DEFAULT 1
        )
      `, (err) => {
        if (err) console.error('Error creating labels table:', err.message);
      });

      // User labels junction table - maps users to labels (many-to-many)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_labels (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId TEXT NOT NULL,
          labelId INTEGER NOT NULL,
          assignedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          assignedBy TEXT NOT NULL,
          UNIQUE(userId, labelId),
          FOREIGN KEY(labelId) REFERENCES labels(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) console.error('Error creating user_labels table:', err.message);
      });

      // Create indexes for performance
      this.db.run('CREATE INDEX IF NOT EXISTS idx_labels_name ON labels(name)', (err) => {
        if (err) console.error('Error creating idx_labels_name:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_labels_userId ON user_labels(userId)', (err) => {
        if (err) console.error('Error creating idx_user_labels_userId:', err.message);
      });

      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_labels_labelId ON user_labels(labelId)', (err) => {
        if (err) console.error('Error creating idx_user_labels_labelId:', err.message);
      });

      this.initialized = true;
    });
  }

  /**
   * Create a new label
   * @param {Object} labelData - Label data { name, color, description }
   * @param {string} createdBy - Admin user ID creating the label
   * @returns {Promise<Object>} Created label with ID
   */
  async createLabel(labelData, createdBy) {
    return new Promise((resolve, reject) => {
      const { name, color = '#0066CC', description = '' } = labelData;

      if (!name || !name.trim()) {
        return reject(new Error('Label name is required'));
      }

      const stmt = this.db.prepare(`
        INSERT INTO labels (name, color, description, createdBy)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run([name.trim(), color, description, createdBy], function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            reject(new Error(`Label "${name}" already exists`));
          } else {
            reject(err);
          }
        } else {
          AuditLogger.log({
            action: 'label_created',
            userId: createdBy,
            resource: `label:${this.lastID}`,
            details: { name, color }
          });

          resolve({
            id: this.lastID,
            name,
            color,
            description,
            createdBy,
            createdAt: new Date().toISOString()
          });
        }
      });
    });
  }

  /**
   * Get all labels
   * @returns {Promise<Array>} Array of all labels
   */
  async getAllLabels() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT id, name, color, description, createdBy, createdAt, updatedAt
        FROM labels
        WHERE isActive = 1
        ORDER BY name ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Get label by ID
   * @param {number} labelId - Label ID
   * @returns {Promise<Object>} Label data
   */
  async getLabelById(labelId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT id, name, color, description, createdBy, createdAt, updatedAt
        FROM labels
        WHERE id = ? AND isActive = 1
      `, [labelId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Update label
   * @param {number} labelId - Label ID
   * @param {Object} updates - Fields to update { name, color, description }
   * @param {string} updatedBy - Admin user ID
   * @returns {Promise<Object>} Updated label
   */
  async updateLabel(labelId, updates, updatedBy) {
    return new Promise((resolve, reject) => {
      const label = this.getLabelById(labelId);
      if (!label) {
        return reject(new Error('Label not found'));
      }

      const { name, color, description } = updates;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push('name = ?');
        values.push(name.trim());
      }
      if (color !== undefined) {
        fields.push('color = ?');
        values.push(color);
      }
      if (description !== undefined) {
        fields.push('description = ?');
        values.push(description);
      }

      if (fields.length === 0) {
        return resolve(label);
      }

      fields.push('updatedAt = CURRENT_TIMESTAMP');
      values.push(labelId);

      const stmt = this.db.prepare(`
        UPDATE labels
        SET ${fields.join(', ')}
        WHERE id = ?
      `);

      stmt.run(values, (err) => {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'label_updated',
            userId: updatedBy,
            resource: `label:${labelId}`,
            details: updates
          });
          resolve({ id: labelId, ...updates });
        }
      });
    });
  }

  /**
   * Delete label (soft delete by marking inactive)
   * @param {number} labelId - Label ID
   * @param {string} deletedBy - Admin user ID
   * @returns {Promise<boolean>} Success
   */
  async deleteLabel(labelId, deletedBy) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE labels
        SET isActive = 0, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [labelId], function(err) {
        if (err) reject(err);
        else {
          // Also remove all user associations with this label
          this.db.run(`
            DELETE FROM user_labels WHERE labelId = ?
          `, [labelId], (delErr) => {
            if (delErr) console.error('Error removing user label associations:', delErr);

            AuditLogger.log({
              action: 'label_deleted',
              userId: deletedBy,
              resource: `label:${labelId}`
            });

            resolve(true);
          });
        }
      });
    });
  }

  /**
   * Assign label to user
   * @param {string} userId - User ID
   * @param {number} labelId - Label ID
   * @param {string} assignedBy - Admin user ID
   * @returns {Promise<boolean>} Success
   */
  async assignLabelToUser(userId, labelId, assignedBy) {
    return new Promise((resolve, reject) => {
      if (!userId || !labelId) {
        return reject(new Error('userId and labelId are required'));
      }

      this.db.run(`
        INSERT OR IGNORE INTO user_labels (userId, labelId, assignedBy)
        VALUES (?, ?, ?)
      `, [userId, labelId, assignedBy], (err) => {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'label_assigned',
            userId: assignedBy,
            resource: `user:${userId}`,
            details: { labelId }
          });
          resolve(true);
        }
      });
    });
  }

  /**
   * Assign multiple labels to a user
   * @param {string} userId - User ID
   * @param {Array<number>} labelIds - Array of label IDs
   * @param {string} assignedBy - Admin user ID
   * @returns {Promise<number>} Number of labels assigned
   */
  async assignLabelsToUser(userId, labelIds, assignedBy) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(labelIds) || labelIds.length === 0) {
        return reject(new Error('labelIds must be a non-empty array'));
      }

      const placeholders = labelIds.map(() => '(?, ?, ?)').join(',');
      const values = [];

      labelIds.forEach(labelId => {
        values.push(userId, labelId, assignedBy);
      });

      this.db.run(`
        INSERT OR IGNORE INTO user_labels (userId, labelId, assignedBy)
        VALUES ${placeholders}
      `, values, function(err) {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'labels_assigned_bulk',
            userId: assignedBy,
            resource: `user:${userId}`,
            details: { labelCount: labelIds.length, labelIds }
          });
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Remove label from user
   * @param {string} userId - User ID
   * @param {number} labelId - Label ID
   * @param {string} removedBy - Admin user ID
   * @returns {Promise<boolean>} Success
   */
  async removeLabelFromUser(userId, labelId, removedBy) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM user_labels
        WHERE userId = ? AND labelId = ?
      `, [userId, labelId], (err) => {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'label_removed',
            userId: removedBy,
            resource: `user:${userId}`,
            details: { labelId }
          });
          resolve(true);
        }
      });
    });
  }

  /**
   * Remove multiple labels from user
   * @param {string} userId - User ID
   * @param {Array<number>} labelIds - Array of label IDs
   * @param {string} removedBy - Admin user ID
   * @returns {Promise<number>} Number of labels removed
   */
  async removeLabelsFromUser(userId, labelIds, removedBy) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(labelIds) || labelIds.length === 0) {
        return reject(new Error('labelIds must be a non-empty array'));
      }

      const placeholders = labelIds.map(() => '?').join(',');

      this.db.run(`
        DELETE FROM user_labels
        WHERE userId = ? AND labelId IN (${placeholders})
      `, [userId, ...labelIds], function(err) {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'labels_removed_bulk',
            userId: removedBy,
            resource: `user:${userId}`,
            details: { labelCount: labelIds.length, labelIds }
          });
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Get all labels for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of labels for user
   */
  async getLabelsForUser(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT l.id, l.name, l.color, l.description, ul.assignedAt, ul.assignedBy
        FROM labels l
        JOIN user_labels ul ON l.id = ul.labelId
        WHERE ul.userId = ? AND l.isActive = 1
        ORDER BY l.name ASC
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Get all users with a specific label
   * @param {number} labelId - Label ID
   * @returns {Promise<Array>} Array of user IDs
   */
  async getUsersWithLabel(labelId) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT DISTINCT userId, assignedAt, assignedBy
        FROM user_labels
        WHERE labelId = ?
        ORDER BY assignedAt DESC
      `, [labelId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Get label statistics
   * @returns {Promise<Object>} Statistics about labels
   */
  async getLabelStatistics() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          l.id,
          l.name,
          l.color,
          COUNT(ul.userId) as userCount
        FROM labels l
        LEFT JOIN user_labels ul ON l.id = ul.labelId
        WHERE l.isActive = 1
        GROUP BY l.id
        ORDER BY userCount DESC
      `, (err, rows) => {
        if (err) reject(err);
        else {
          const stats = {
            totalLabels: rows.length,
            labels: rows
          };
          resolve(stats);
        }
      });
    });
  }

  /**
   * Assign label to multiple users (bulk operation)
   * @param {Array<string>} userIds - Array of user IDs
   * @param {number} labelId - Label ID
   * @param {string} assignedBy - Admin user ID
   * @returns {Promise<number>} Number of users labeled
   */
  async assignLabelToUsers(userIds, labelId, assignedBy) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return reject(new Error('userIds must be a non-empty array'));
      }

      const placeholders = userIds.map(() => '(?, ?, ?)').join(',');
      const values = [];

      userIds.forEach(userId => {
        values.push(userId, labelId, assignedBy);
      });

      this.db.run(`
        INSERT OR IGNORE INTO user_labels (userId, labelId, assignedBy)
        VALUES ${placeholders}
      `, values, function(err) {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'label_assigned_bulk',
            userId: assignedBy,
            resource: `label:${labelId}`,
            details: { userCount: userIds.length, userIds }
          });
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Remove label from multiple users (bulk operation)
   * @param {Array<string>} userIds - Array of user IDs
   * @param {number} labelId - Label ID
   * @param {string} removedBy - Admin user ID
   * @returns {Promise<number>} Number of users unlabeled
   */
  async removeLabelFromUsers(userIds, labelId, removedBy) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return reject(new Error('userIds must be a non-empty array'));
      }

      const placeholders = userIds.map(() => '?').join(',');

      this.db.run(`
        DELETE FROM user_labels
        WHERE labelId = ? AND userId IN (${placeholders})
      `, [labelId, ...userIds], function(err) {
        if (err) reject(err);
        else {
          AuditLogger.log({
            action: 'label_removed_bulk',
            userId: removedBy,
            resource: `label:${labelId}`,
            details: { userCount: userIds.length, userIds }
          });
          resolve(this.changes);
        }
      });
    });
  }

  /**
   * Search for labels by name (partial match)
   * @param {string} searchTerm - Search term
   * @returns {Promise<Array>} Matching labels
   */
  async searchLabels(searchTerm) {
    return new Promise((resolve, reject) => {
      const term = `%${searchTerm}%`;
      this.db.all(`
        SELECT id, name, color, description, createdBy, createdAt
        FROM labels
        WHERE isActive = 1 AND (name LIKE ? OR description LIKE ?)
        ORDER BY name ASC
      `, [term, term], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Check if user has label
   * @param {string} userId - User ID
   * @param {number} labelId - Label ID
   * @returns {Promise<boolean>} Whether user has label
   */
  async userHasLabel(userId, labelId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 1 FROM user_labels
        WHERE userId = ? AND labelId = ?
      `, [userId, labelId], (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      });
    });
  }

  /**
   * Get count of users with each label (for analytics)
   * @returns {Promise<Array>} Labels with user counts
   */
  async getLabelCounts() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          l.id,
          l.name,
          l.color,
          COUNT(ul.id) as count
        FROM labels l
        LEFT JOIN user_labels ul ON l.id = ul.labelId
        WHERE l.isActive = 1
        GROUP BY l.id
        ORDER BY count DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

module.exports = new LabelManager();
