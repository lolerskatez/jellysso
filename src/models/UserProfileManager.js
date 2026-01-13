const DatabaseManager = require('./DatabaseManager');

class UserProfileManager {
  /**
   * Get extended profile for a Jellyfin user
   * @param {string} jellyfinUserId - The Jellyfin user ID
   * @returns {Promise<Object|null>} The user profile or null if not found
   */
  static async getProfile(jellyfinUserId) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.get(
        'SELECT * FROM user_profiles WHERE jellyfin_user_id = ?',
        [jellyfinUserId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get extended profile by email
   * @param {string} email - The email address
   * @returns {Promise<Object|null>} The user profile or null if not found
   */
  static async getProfileByEmail(email) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.get(
        'SELECT * FROM user_profiles WHERE email = ?',
        [email.toLowerCase()],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get all extended profiles
   * @returns {Promise<Array>} Array of all user profiles
   */
  static async getAllProfiles() {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(
        'SELECT * FROM user_profiles ORDER BY created_at DESC',
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * Create or update an extended profile
   * @param {string} jellyfinUserId - The Jellyfin user ID
   * @param {Object} profileData - The profile data
   * @returns {Promise<Object>} The created/updated profile
   */
  static async upsertProfile(jellyfinUserId, profileData) {
    const { firstName, lastName, email, displayName } = profileData;
    
    return new Promise((resolve, reject) => {
      // Check if profile exists
      DatabaseManager.db.get(
        'SELECT id FROM user_profiles WHERE jellyfin_user_id = ?',
        [jellyfinUserId],
        (err, existing) => {
          if (err) return reject(err);

          if (existing) {
            // Update existing profile
            const updates = [];
            const values = [];

            if (firstName !== undefined) {
              updates.push('first_name = ?');
              values.push(firstName);
            }
            if (lastName !== undefined) {
              updates.push('last_name = ?');
              values.push(lastName);
            }
            if (email !== undefined) {
              updates.push('email = ?');
              values.push(email ? email.toLowerCase() : null);
            }
            if (displayName !== undefined) {
              updates.push('display_name = ?');
              values.push(displayName);
            }

            if (updates.length === 0) {
              return resolve({ updated: false, message: 'No fields to update' });
            }

            updates.push('updated_at = CURRENT_TIMESTAMP');
            values.push(jellyfinUserId);

            DatabaseManager.db.run(
              `UPDATE user_profiles SET ${updates.join(', ')} WHERE jellyfin_user_id = ?`,
              values,
              function(err) {
                if (err) reject(err);
                else resolve({ updated: true, id: existing.id });
              }
            );
          } else {
            // Insert new profile
            DatabaseManager.db.run(
              `INSERT INTO user_profiles (jellyfin_user_id, first_name, last_name, email, display_name)
               VALUES (?, ?, ?, ?, ?)`,
              [
                jellyfinUserId,
                firstName || null,
                lastName || null,
                email ? email.toLowerCase() : null,
                displayName || null
              ],
              function(err) {
                if (err) reject(err);
                else resolve({ created: true, id: this.lastID });
              }
            );
          }
        }
      );
    });
  }

  /**
   * Delete an extended profile
   * @param {string} jellyfinUserId - The Jellyfin user ID
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  static async deleteProfile(jellyfinUserId) {
    return new Promise((resolve, reject) => {
      DatabaseManager.db.run(
        'DELETE FROM user_profiles WHERE jellyfin_user_id = ?',
        [jellyfinUserId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  /**
   * Get profiles for multiple Jellyfin user IDs
   * @param {Array<string>} userIds - Array of Jellyfin user IDs
   * @returns {Promise<Object>} Map of userId to profile
   */
  static async getProfilesForUsers(userIds) {
    if (!userIds || userIds.length === 0) {
      return {};
    }

    const placeholders = userIds.map(() => '?').join(',');
    
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(
        `SELECT * FROM user_profiles WHERE jellyfin_user_id IN (${placeholders})`,
        userIds,
        (err, rows) => {
          if (err) reject(err);
          else {
            const profileMap = {};
            (rows || []).forEach(row => {
              profileMap[row.jellyfin_user_id] = row;
            });
            resolve(profileMap);
          }
        }
      );
    });
  }

  /**
   * Search profiles by name or email
   * @param {string} query - Search query
   * @returns {Promise<Array>} Matching profiles
   */
  static async searchProfiles(query) {
    const searchTerm = `%${query}%`;
    
    return new Promise((resolve, reject) => {
      DatabaseManager.db.all(
        `SELECT * FROM user_profiles 
         WHERE first_name LIKE ? 
         OR last_name LIKE ? 
         OR email LIKE ? 
         OR display_name LIKE ?
         ORDER BY created_at DESC`,
        [searchTerm, searchTerm, searchTerm, searchTerm],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }
}

module.exports = UserProfileManager;
