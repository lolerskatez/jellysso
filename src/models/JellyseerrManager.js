/**
 * JellyseerrManager — synchronises JellySSO users with a Jellyseerr instance.
 *
 * Jellyseerr already knows about Jellyfin users via its own Jellyfin connection.
 * When sync is enabled and a user is created here or deleted here, we call
 * the Jellyseerr API to mirror the change.
 *
 * Settings (stored in the `settings` DB table):
 *   jellyseerr_url         — base URL, e.g. http://localhost:5055
 *   jellyseerr_api_key     — Jellyseerr API key (Settings → General → API Key)
 *   jellyseerr_sync_enabled — 'true' | 'false'
 */

const axios = require('axios');
const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class JellyseerrManager {
  static instance = null;

  static getInstance() {
    if (!JellyseerrManager.instance) {
      JellyseerrManager.instance = new JellyseerrManager();
    }
    return JellyseerrManager.instance;
  }

  async _getSettings() {
    const [url, apiKey, syncEnabled] = await Promise.all([
      DatabaseManager.getSetting('jellyseerr_url'),
      DatabaseManager.getSetting('jellyseerr_api_key'),
      DatabaseManager.getSetting('jellyseerr_sync_enabled')
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
        'X-Api-Key': apiKey
      }
    });
  }

  /**
   * Verify the Jellyseerr connection.
   * @returns {{ success: boolean, message: string, version?: string }}
   */
  async testConnection() {
    const { url, apiKey } = await this._getSettings();
    if (!url || !apiKey) {
      return { success: false, message: 'Jellyseerr URL and API key are required' };
    }
    try {
      const resp = await this._client(url, apiKey).get('/api/v1/auth/me');
      const ver = resp.data?.requestCount !== undefined ? resp.data?.id : undefined;
      return { success: true, message: 'Connected successfully', userId: ver };
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return { success: false, message: 'Invalid API key' };
      }
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  /**
   * Import a user from Jellyfin into Jellyseerr using their Jellyfin user ID.
   * This is the recommended way; Jellyseerr links the account to Jellyfin automatically.
   *
   * @param {string} jellyfinUserId — Jellyfin user UUID
   * @returns {Promise<{ success: boolean }>}
   */
  async syncUser(jellyfinUserId) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };

    try {
      await this._client(url, apiKey).post('/api/v1/user/import-from-jellyfin', {
        jellyfinUserIds: [jellyfinUserId]
      });
      logger.info(`Jellyseerr: imported user ${jellyfinUserId}`);
      return { success: true };
    } catch (err) {
      // 2xx = success; 4xx with "already exists" message is also fine
      const msg = err.response?.data?.message || err.message || '';
      if (err.response?.status < 500 && /already|exist/i.test(msg)) {
        return { success: true }; // idempotent — user already synced
      }
      logger.warn(`Jellyseerr: failed to sync user ${jellyfinUserId}: ${msg}`);
      return { success: false, reason: msg };
    }
  }

  /**
   * Remove a user from Jellyseerr by their Jellyfin user ID.
   * Finds the Jellyseerr user whose `jellyfinUserId` matches, then deletes them.
   *
   * @param {string} jellyfinUserId — Jellyfin user UUID
   * @returns {Promise<{ success: boolean }>}
   */
  async removeUser(jellyfinUserId) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };

    try {
      const client = this._client(url, apiKey);

      // Paginate through Jellyseerr users to find a match (typically small lists)
      let skip = 0;
      const take = 100;
      let jellyseerrUserId = null;

      while (true) {
        const resp = await client.get('/api/v1/user', { params: { take, skip } });
        const results = resp.data?.results || [];
        if (!results.length) break;

        const match = results.find(u => u.jellyfinUserId === jellyfinUserId);
        if (match) {
          jellyseerrUserId = match.id;
          break;
        }

        const total = resp.data?.pageInfo?.results || results.length;
        skip += take;
        if (skip >= total) break;
      }

      if (!jellyseerrUserId) {
        logger.info(`Jellyseerr: user ${jellyfinUserId} not found (may not have been synced)`);
        return { success: true }; // no-op is fine
      }

      await client.delete(`/api/v1/user/${jellyseerrUserId}`);
      logger.info(`Jellyseerr: deleted user ${jellyfinUserId} (Jellyseerr id ${jellyseerrUserId})`);
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      logger.warn(`Jellyseerr: failed to remove user ${jellyfinUserId}: ${msg}`);
      return { success: false, reason: msg };
    }
  }

  /**
   * Sync contact notification settings (Discord / Telegram) for a Jellyseerr user.
   * Finds the Jellyseerr user by Jellyfin user ID, then PATCHes their notification settings.
   *
   * @param {string} jellyfinUserId
   * @param {{ discordId?: string, telegramChatId?: number|string }} contactData
   */
  async syncContactMethods(jellyfinUserId, { discordId, telegramChatId } = {}) {
    const { url, apiKey, syncEnabled } = await this._getSettings();
    if (!syncEnabled || !url || !apiKey) return { success: false, reason: 'disabled' };
    if (!discordId && !telegramChatId) return { success: false, reason: 'no contact data' };

    try {
      const client = this._client(url, apiKey);

      // Locate Jellyseerr user who maps to this Jellyfin user
      let jellyseerrUserId = null;
      let skip = 0;
      const take = 100;
      while (true) {
        const resp = await client.get('/api/v1/user', { params: { take, skip } });
        const results = resp.data?.results || [];
        if (!results.length) break;
        const match = results.find(u => u.jellyfinUserId === jellyfinUserId);
        if (match) { jellyseerrUserId = match.id; break; }
        const total = resp.data?.pageInfo?.results || results.length;
        skip += take;
        if (skip >= total) break;
      }

      if (!jellyseerrUserId) {
        logger.info(`Jellyseerr: user ${jellyfinUserId} not found, skipping contact sync`);
        return { success: false, reason: 'user not in jellyseerr' };
      }

      // Build the notification settings payload
      // Jellyseerr notification types: see https://docs.overseerr.dev/api-reference/user#user-notification-settings
      const notifSettings = { notificationTypes: {} };
      if (discordId) {
        notifSettings.discordId = String(discordId);
        // Enable Discord channel notifications (type 4 = Discord in Jellyseerr/Overseerr)
        notifSettings.notificationTypes.discord = 4095; // all notification types
      }
      if (telegramChatId) {
        notifSettings.telegramChatId = String(telegramChatId);
        notifSettings.notificationTypes.telegram = 4095;
      }

      await client.post(`/api/v1/user/${jellyseerrUserId}/settings/notifications`, notifSettings);
      logger.info(`Jellyseerr: synced contact methods for user ${jellyfinUserId}`);
      return { success: true };
    } catch (err) {
      const msg = err.response?.data?.message || err.message || '';
      logger.warn(`Jellyseerr: failed to sync contact methods for ${jellyfinUserId}: ${msg}`);
      return { success: false, reason: msg };
    }
  }

module.exports = JellyseerrManager;
