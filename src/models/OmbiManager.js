/**
 * OmbiManager — synchronises JellySSO users with an Ombi instance.
 *
 * When sync is enabled and a user is created or deleted in JellySSO, we call
 * the Ombi API to mirror the change.
 *
 * Settings (stored in the `settings` DB table):
 *   ombi_url         — base URL, e.g. http://localhost:5000
 *   ombi_api_key     — Ombi API key (Settings → Configuration → API Key)
 *   ombi_sync_enabled — 'true' | 'false'
 *
 * Ombi user import is done via its Jellyfin sync endpoint so no passwords need
 * to be transmitted.  Ombi must already be configured with the same Jellyfin
 * server for this to work.
 */

const axios = require('axios');
const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class OmbiManager {
  static instance = null;

  static getInstance() {
    if (!OmbiManager.instance) {
      OmbiManager.instance = new OmbiManager();
    }
    return OmbiManager.instance;
  }

  async _getSettings() {
    const [url, apiKey, syncEnabled] = await Promise.all([
      DatabaseManager.getSetting('ombi_url'),
      DatabaseManager.getSetting('ombi_api_key'),
      DatabaseManager.getSetting('ombi_sync_enabled')
    ]);
    return {
      url: (url || '').replace(/\/$/, ''),
      apiKey: apiKey || '',
      syncEnabled: syncEnabled === 'true'
    };
  }

  _client(url, apiKey) {
    return axios.create({
      baseURL: url,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'ApiKey': apiKey
      }
    });
  }

  /**
   * Verify the Ombi connection by calling the status endpoint.
   * @returns {{ success: boolean, message: string, version?: string }}
   */
  async testConnection() {
    const { url, apiKey } = await this._getSettings();
    if (!url || !apiKey) {
      return { success: false, message: 'Ombi URL and API key are required' };
    }
    try {
      const resp = await this._client(url, apiKey).get('/api/v1/Status');
      const version = resp.data?.version;
      return { success: true, message: 'Connected successfully', version };
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return { success: false, message: 'Invalid API key' };
      }
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  /**
   * Import a user from Jellyfin into Ombi using their Jellyfin user ID.
   * Ombi must be configured with the same Jellyfin server.
   *
   * @param {string} jellyfinUserId — Jellyfin user UUID
   * @returns {Promise<{ success: boolean }>}
   */
  async syncUser(jellyfinUserId) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };

    try {
      // Ombi v4 endpoint to import a Jellyfin user by their ID
      await this._client(url, apiKey).post('/api/v1/Identity/ImportFromJellyfin', {
        jellyfinUserIds: [jellyfinUserId]
      });
      logger.info(`Ombi: imported user ${jellyfinUserId}`);
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data || err.message || '';
      const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
      // Idempotent — user already synced
      if (err.response?.status < 500 && /already|exist/i.test(msgStr)) {
        return { success: true };
      }
      logger.warn(`Ombi: failed to sync user ${jellyfinUserId}: ${msgStr}`);
      return { success: false, reason: msgStr };
    }
  }

  /**
   * Find an Ombi user by their Jellyfin user ID.
   * Returns the Ombi user object or null if not found.
   */
  async _findOmbiUser(client, jellyfinUserId) {
    const resp = await client.get('/api/v1/Identity/Users');
    const users = Array.isArray(resp.data) ? resp.data : (resp.data?.result || []);
    return users.find(u => u.jellyfinUserId === jellyfinUserId) || null;
  }

  /**
   * Sync a user's email and display name from JellySSO's user_profiles table into Ombi.
   * Call this after syncUser() to ensure profile data is kept in sync.
   *
   * @param {string} jellyfinUserId — Jellyfin user UUID
   * @returns {Promise<{ success: boolean }>}
   */
  async syncUserProfile(jellyfinUserId) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };

    try {
      // Pull the user's email from JellySSO's local profile
      const profile = await DatabaseManager.queryOne(
        'SELECT email, display_name, first_name, last_name FROM user_profiles WHERE jellyfin_user_id = ?',
        [jellyfinUserId]
      );
      if (!profile || !profile.email) {
        return { success: false, reason: 'no_local_profile' };
      }

      const client = this._client(url, apiKey);
      const ombiUser = await this._findOmbiUser(client, jellyfinUserId);
      if (!ombiUser) {
        return { success: false, reason: 'user_not_found_in_ombi' };
      }

      // Update the Ombi user's email (and display name when available)
      const updates = {
        ...ombiUser,
        emailAddress: profile.email,
        alias: profile.display_name ||
               [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
               ombiUser.alias
      };

      await client.put(`/api/v1/Identity/${ombiUser.id}`, updates);
      logger.info(`Ombi: updated profile for user ${jellyfinUserId} (email: ${profile.email})`);
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data || err.message || '';
      const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
      logger.warn(`Ombi: failed to update profile for ${jellyfinUserId}: ${msgStr}`);
      return { success: false, reason: msgStr };
    }
  }

  /**
   * Remove a user from Ombi by finding them by their Jellyfin user ID.
   *
   * @param {string} jellyfinUserId — Jellyfin user UUID
   * @returns {Promise<{ success: boolean }>}
   */
  async removeUser(jellyfinUserId) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };

    try {
      const client = this._client(url, apiKey);
      const match = await this._findOmbiUser(client, jellyfinUserId);
      if (!match) {
        logger.info(`Ombi: user ${jellyfinUserId} not found (may not have been synced)`);
        return { success: true }; // no-op is fine
      }

      await client.delete(`/api/v1/Identity/${match.id}`);
      logger.info(`Ombi: deleted user ${jellyfinUserId} (Ombi id ${match.id})`);
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data || err.message || '';
      const msgStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
      logger.warn(`Ombi: failed to remove user ${jellyfinUserId}: ${msgStr}`);
      return { success: false, reason: msgStr };
    }
  }
}

module.exports = OmbiManager;
