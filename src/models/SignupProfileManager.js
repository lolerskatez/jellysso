const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');
const AuditLogger = require('./AuditLogger');
const logger = require('../utils/logger');

/**
 * SignupProfileManager - Manages reusable signup profiles for invites
 * Profiles pre-configure Jellyfin tier, library access, and playback limits
 */
class SignupProfileManager {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.getInstance().db;
    this.logger = AuditLogger;
    this.initializeTables();
    this.createDefaultProfiles();
  }

  static getInstance() {
    if (!SignupProfileManager.instance) {
      SignupProfileManager.instance = new SignupProfileManager();
    }
    return SignupProfileManager.instance;
  }

  /**
   * Initialize signup_profiles table
   */
  initializeTables() {
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS signup_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          jellyfinTier TEXT,
          jellyfinLibraryAccess JSON,
          jellyfinPlaybackLimits JSON,
          customFields JSON,
          isActive BOOLEAN DEFAULT 1,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          createdBy TEXT,
          FOREIGN KEY (createdBy) REFERENCES users(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          logger.error('Error creating signup_profiles table:', err);
        }
      });

      // Index for faster lookups
      this.db.run(
        'CREATE INDEX IF NOT EXISTS idx_signup_profiles_active ON signup_profiles(isActive)',
        (err) => {
          if (err && !err.message.includes('already exists')) {
            logger.error('Error creating index:', err);
          }
        }
      );

      // Table to track profile usage
      this.db.run(`
        CREATE TABLE IF NOT EXISTS profile_usage (
          id TEXT PRIMARY KEY,
          profileId TEXT NOT NULL,
          userId TEXT NOT NULL,
          appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (profileId) REFERENCES signup_profiles(id),
          FOREIGN KEY (userId) REFERENCES users(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) {
          logger.error('Error creating profile_usage table:', err);
        }
      });
    } catch (error) {
      logger.error('SignupProfileManager initialization error:', error);
    }
  }

  /**
   * Create default signup profiles on first run
   */
  createDefaultProfiles() {
    try {
      // Check if default profiles exist
      this.db.get(
        'SELECT id FROM signup_profiles WHERE name = ?',
        ['Free Trial'],
        (err, row) => {
          if (!row && !err) {
            // Create defaults
            this.createProfile('Free Trial', {
              description: '1-month free trial with limited access',
              jellyfinTier: 'basic',
              jellyfinLibraryAccess: ['movies', 'tv'],
              jellyfinPlaybackLimits: {
                maxConcurrentStreams: 1,
                maxBitrate: '1080p',
                maxDownloadSize: '100MB'
              },
              isActive: true
            }).catch(() => {});

            this.createProfile('Premium', {
              description: 'Full access with premium features',
              jellyfinTier: 'premium',
              jellyfinLibraryAccess: ['movies', 'tv', 'music', 'photos'],
              jellyfinPlaybackLimits: {
                maxConcurrentStreams: 4,
                maxBitrate: '4K',
                maxDownloadSize: 'unlimited'
              },
              isActive: true
            }).catch(() => {});

            this.createProfile('Family', {
              description: 'Family plan for multiple users',
              jellyfinTier: 'family',
              jellyfinLibraryAccess: ['all'],
              jellyfinPlaybackLimits: null,
              isActive: true
            }).catch(() => {});

            this.logger.log('info', 'DEFAULT_PROFILES_CREATED', {});
          }
        }
      );
    } catch (error) {
      logger.error('Error creating default profiles:', error);
    }
  }

  /**
   * Create a new signup profile
   * @param {string} name - Profile name (unique)
   * @param {Object} config - Profile configuration
   * @returns {Promise<Object>} Created profile
   */
  async createProfile(name, config = {}) {
    return new Promise((resolve, reject) => {
      try {
        const id = crypto.randomBytes(16).toString('hex');
        const now = new Date();

        // Validate required fields
        if (!name || typeof name !== 'string') {
          return reject(new Error('Profile name is required'));
        }

        // Extract config fields
        const {
          description = '',
          jellyfinTier = 'basic',
          jellyfinLibraryAccess = null,
          jellyfinPlaybackLimits = null,
          customFields = null,
          isActive = true,
          createdBy = 'system'
        } = config;

        // Check if name already exists
        this.db.get(
          'SELECT id FROM signup_profiles WHERE name = ?',
          [name],
          (err, existing) => {
            if (err) {
              this.logger.log('error', 'PROFILE_CREATE_ERROR', { name, error: err.message });
              return reject(new Error('Database error'));
            }

            if (existing) {
              return reject(new Error('Profile name already exists'));
            }

            // Insert profile
            this.db.run(
              `INSERT INTO signup_profiles 
               (id, name, description, jellyfinTier, jellyfinLibraryAccess, jellyfinPlaybackLimits, customFields, isActive, createdAt, updatedAt, createdBy)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                id,
                name,
                description,
                jellyfinTier,
                JSON.stringify(jellyfinLibraryAccess),
                JSON.stringify(jellyfinPlaybackLimits),
                JSON.stringify(customFields),
                isActive ? 1 : 0,
                now.toISOString(),
                now.toISOString(),
                createdBy
              ],
              (err) => {
                if (err) {
                  this.logger.log('error', 'PROFILE_INSERT_ERROR', { name, error: err.message });
                  return reject(new Error('Failed to create profile'));
                }

                this.logger.log('info', 'PROFILE_CREATED', { profileId: id, name });

                resolve({
                  id,
                  name,
                  description,
                  jellyfinTier,
                  jellyfinLibraryAccess,
                  jellyfinPlaybackLimits,
                  customFields,
                  isActive,
                  createdAt: now,
                  updatedAt: now
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
   * Get profile by ID
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Profile object
   */
  async getProfile(profileId) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          'SELECT * FROM signup_profiles WHERE id = ?',
          [profileId],
          (err, row) => {
            if (err) {
              reject(err);
            } else if (row) {
              // Parse JSON fields
              row.jellyfinLibraryAccess = JSON.parse(row.jellyfinLibraryAccess || 'null');
              row.jellyfinPlaybackLimits = JSON.parse(row.jellyfinPlaybackLimits || 'null');
              row.customFields = JSON.parse(row.customFields || 'null');
              resolve(row);
            } else {
              resolve(null);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get profile by name
   * @param {string} name - Profile name
   * @returns {Promise<Object>} Profile object
   */
  async getProfileByName(name) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          'SELECT * FROM signup_profiles WHERE name = ?',
          [name],
          (err, row) => {
            if (err) {
              reject(err);
            } else if (row) {
              row.jellyfinLibraryAccess = JSON.parse(row.jellyfinLibraryAccess || 'null');
              row.jellyfinPlaybackLimits = JSON.parse(row.jellyfinPlaybackLimits || 'null');
              row.customFields = JSON.parse(row.customFields || 'null');
              resolve(row);
            } else {
              resolve(null);
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * List all profiles (optionally active only)
   * @param {boolean} activeOnly - Only return active profiles
   * @returns {Promise<Array>} Array of profiles
   */
  async listProfiles(activeOnly = false) {
    return new Promise((resolve, reject) => {
      try {
        let query = 'SELECT * FROM signup_profiles';
        const params = [];

        if (activeOnly) {
          query += ' WHERE isActive = 1';
        }

        query += ' ORDER BY name ASC';

        this.db.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            // Parse JSON fields for each row
            const profiles = (rows || []).map(row => ({
              ...row,
              jellyfinLibraryAccess: JSON.parse(row.jellyfinLibraryAccess || 'null'),
              jellyfinPlaybackLimits: JSON.parse(row.jellyfinPlaybackLimits || 'null'),
              customFields: JSON.parse(row.customFields || 'null')
            }));
            resolve(profiles);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Update a profile
   * @param {string} profileId - Profile ID to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated profile
   */
  async updateProfile(profileId, updates = {}) {
    return new Promise((resolve, reject) => {
      try {
        // Get current profile to merge
        this.db.get(
          'SELECT * FROM signup_profiles WHERE id = ?',
          [profileId],
          (err, current) => {
            if (err) {
              this.logger.log('error', 'PROFILE_UPDATE_ERROR', { profileId, error: err.message });
              return reject(new Error('Database error'));
            }

            if (!current) {
              return reject(new Error('Profile not found'));
            }

            const now = new Date();
            const {
              name = current.name,
              description = current.description,
              jellyfinTier = current.jellyfinTier,
              jellyfinLibraryAccess = JSON.parse(current.jellyfinLibraryAccess || 'null'),
              jellyfinPlaybackLimits = JSON.parse(current.jellyfinPlaybackLimits || 'null'),
              customFields = JSON.parse(current.customFields || 'null'),
              isActive = current.isActive
            } = updates;

            // Validate name uniqueness if changed
            if (name !== current.name) {
              this.db.get(
                'SELECT id FROM signup_profiles WHERE name = ? AND id != ?',
                [name, profileId],
                (err, existing) => {
                  if (existing) {
                    return reject(new Error('Profile name already exists'));
                  }

                  this.performUpdate();
                }
              );
            } else {
              this.performUpdate();
            }

            const performUpdate = () => {
              this.db.run(
                `UPDATE signup_profiles 
                 SET name = ?, description = ?, jellyfinTier = ?, jellyfinLibraryAccess = ?, 
                     jellyfinPlaybackLimits = ?, customFields = ?, isActive = ?, updatedAt = ?
                 WHERE id = ?`,
                [
                  name,
                  description,
                  jellyfinTier,
                  JSON.stringify(jellyfinLibraryAccess),
                  JSON.stringify(jellyfinPlaybackLimits),
                  JSON.stringify(customFields),
                  isActive ? 1 : 0,
                  now.toISOString(),
                  profileId
                ],
                (err) => {
                  if (err) {
                    this.logger.log('error', 'PROFILE_UPDATE_FAIL', { profileId, error: err.message });
                    return reject(new Error('Failed to update profile'));
                  }

                  this.logger.log('info', 'PROFILE_UPDATED', { profileId });

                  resolve({
                    id: profileId,
                    name,
                    description,
                    jellyfinTier,
                    jellyfinLibraryAccess,
                    jellyfinPlaybackLimits,
                    customFields,
                    isActive,
                    updatedAt: now
                  });
                }
              );
            };
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Delete a profile
   * @param {string} profileId - Profile ID to delete
   * @returns {Promise<boolean>} Success
   */
  async deleteProfile(profileId) {
    return new Promise((resolve, reject) => {
      try {
        // Check if profile is in use
        this.db.get(
          'SELECT COUNT(*) as count FROM invites WHERE signupProfileId = ? AND status != ?',
          [profileId, 'revoked'],
          (err, result) => {
            if (err) {
              this.logger.log('error', 'PROFILE_DELETE_ERROR', { profileId, error: err.message });
              return reject(new Error('Database error'));
            }

            if (result && result.count > 0) {
              return reject(new Error(`Cannot delete profile: ${result.count} active invites still using it`));
            }

            // Safe to delete
            this.db.run(
              'DELETE FROM signup_profiles WHERE id = ?',
              [profileId],
              (err) => {
                if (err) {
                  this.logger.log('error', 'PROFILE_DELETE_FAIL', { profileId, error: err.message });
                  return reject(new Error('Failed to delete profile'));
                }

                this.logger.log('info', 'PROFILE_DELETED', { profileId });
                resolve(true);
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
   * Duplicate a profile
   * @param {string} profileId - Profile to duplicate
   * @param {string} newName - Name for duplicated profile
   * @returns {Promise<Object>} New profile
   */
  async duplicateProfile(profileId, newName) {
    try {
      const profile = await this.getProfile(profileId);
      if (!profile) {
        throw new Error('Profile not found');
      }

      return await this.createProfile(newName, {
        description: `Copy of ${profile.name}`,
        jellyfinTier: profile.jellyfinTier,
        jellyfinLibraryAccess: profile.jellyfinLibraryAccess,
        jellyfinPlaybackLimits: profile.jellyfinPlaybackLimits,
        customFields: profile.customFields
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Track profile usage (when applied to a user)
   * @param {string} profileId - Profile ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success
   */
  async trackProfileUsage(profileId, userId) {
    return new Promise((resolve, reject) => {
      try {
        const id = crypto.randomBytes(16).toString('hex');

        this.db.run(
          'INSERT INTO profile_usage (id, profileId, userId) VALUES (?, ?, ?)',
          [id, profileId, userId],
          (err) => {
            if (err) {
              logger.error('Error tracking profile usage:', err);
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
   * Get usage statistics for a profile
   * @param {string} profileId - Profile ID
   * @returns {Promise<Object>} Usage statistics
   */
  async getProfileUsageStats(profileId) {
    return new Promise((resolve, reject) => {
      try {
        this.db.get(
          `SELECT
             COUNT(DISTINCT userId) as totalUsersCreated,
             MAX(appliedAt) as lastUsed
           FROM profile_usage
           WHERE profileId = ?`,
          [profileId],
          (err, stats) => {
            if (err) reject(err);
            else resolve(stats || { totalUsersCreated: 0, lastUsed: null });
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get all profiles with their usage stats
   * @returns {Promise<Array>} Profiles with stats
   */
  async listProfilesWithStats() {
    try {
      const profiles = await this.listProfiles();
      const withStats = await Promise.all(
        profiles.map(async (profile) => ({
          ...profile,
          stats: await this.getProfileUsageStats(profile.id)
        }))
      );
      return withStats;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = SignupProfileManager;
