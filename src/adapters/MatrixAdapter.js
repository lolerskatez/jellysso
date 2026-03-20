/**
 * MatrixAdapter - Handle Matrix DM notifications
 *
 * Sends direct messages to Matrix users via the Matrix Client-Server API.
 * No bot framework needed — uses plain HTTP requests to the homeserver.
 *
 * Requires:
 *   - homeserverUrl  e.g. "https://matrix.example.com"
 *   - accessToken    A Matrix access token for the bot account
 *   - botUserId      e.g. "@jellysso-bot:example.com"
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

class MatrixAdapter {
  static instance = null;

  constructor() {
    this.homeserverUrl = null;
    this.accessToken = null;
    this.botUserId = null;
    this.isConnected = false;
    // roomId cache keyed by Matrix userId
    this.dmRooms = {};
  }

  static getInstance() {
    if (!MatrixAdapter.instance) {
      MatrixAdapter.instance = new MatrixAdapter();
    }
    return MatrixAdapter.instance;
  }

  /**
   * Initialize the adapter with homeserver credentials.
   */
  async initialize(homeserverUrl, accessToken, botUserId) {
    if (!homeserverUrl || !accessToken) {
      logger.warn('MatrixAdapter: homeserverUrl and accessToken are required');
      return false;
    }

    this.homeserverUrl = homeserverUrl.replace(/\/$/, '');
    this.accessToken = accessToken;
    this.botUserId = botUserId || null;

    try {
      await this.testConnection();
      this.isConnected = true;
      logger.info('Matrix adapter initialized successfully');
      return true;
    } catch (err) {
      logger.error('Matrix adapter initialization error:', err.message);
      return false;
    }
  }

  /**
   * Build the Matrix API base URL.
   */
  get apiBase() {
    return `${this.homeserverUrl}/_matrix/client/v3`;
  }

  /**
   * Make an authenticated request to the Matrix homeserver.
   */
  async request(method, path, body = null) {
    const url = `${this.apiBase}${path}`;
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    // Use dynamic import for node-fetch compatibility or rely on native fetch (Node 18+)
    const fetchFn = globalThis.fetch ||
      (() => { throw new Error('fetch is not available — Node 18+ required or install node-fetch'); })();

    const response = await fetchFn(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Matrix API error ${response.status}: ${data.error || JSON.stringify(data)}`);
    }

    return data;
  }

  /**
   * Get or create a DM room with the target Matrix user.
   * Caches room IDs to avoid repeated API calls.
   */
  async getDmRoom(matrixUserId) {
    if (this.dmRooms[matrixUserId]) {
      return this.dmRooms[matrixUserId];
    }

    // Create a DM room
    const result = await this.request('POST', '/createRoom', {
      is_direct: true,
      invite: [matrixUserId],
      preset: 'trusted_private_chat'
    });

    this.dmRooms[matrixUserId] = result.room_id;
    return result.room_id;
  }

  /**
   * Send a notification to a Matrix user via DM.
   *
   * @param {string} matrixUserId  e.g. "@alice:example.com"
   * @param {string} title         Notification title
   * @param {string} body          Notification body (plain text)
   */
  async send(matrixUserId, title, body) {
    if (!this.isConnected) {
      throw new Error('Matrix adapter not connected');
    }

    const roomId = await this.getDmRoom(matrixUserId);

    // Use a unique transaction ID to prevent duplicate sends
    const txnId = crypto.randomBytes(8).toString('hex');
    const fullText = `**${title}**\n\n${body}`;
    const htmlText = `<strong>${this._escapeHtml(title)}</strong><br><br>${this._escapeHtml(body).replace(/\n/g, '<br>')}`;

    const result = await this.request(
      'PUT',
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        msgtype: 'm.text',
        body: fullText,
        format: 'org.matrix.custom.html',
        formatted_body: htmlText
      }
    );

    logger.info(`Matrix DM sent to ${matrixUserId} (event: ${result.event_id})`);
    return { success: true, eventId: result.event_id, matrixUserId };
  }

  /**
   * Test connection by fetching the bot account's profile.
   */
  async testConnection() {
    if (!this.accessToken || !this.homeserverUrl) {
      return { success: false, message: 'Not configured' };
    }

    try {
      const data = await this.request('GET', '/account/whoami');
      this.isConnected = true;
      return { success: true, userId: data.user_id };
    } catch (err) {
      this.isConnected = false;
      return { success: false, message: err.message };
    }
  }

  /**
   * Get adapter status.
   */
  getStatus() {
    return {
      connected: this.isConnected,
      homeserverUrl: this.homeserverUrl,
      botUserId: this.botUserId,
      cachedRooms: Object.keys(this.dmRooms).length
    };
  }

  /**
   * Escape HTML special characters for formatted_body.
   */
  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

module.exports = MatrixAdapter;
