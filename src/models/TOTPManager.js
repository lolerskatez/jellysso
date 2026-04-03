/**
 * TOTPManager — Time-based One-Time Password (2FA) support
 *
 * Stores TOTP secrets per user in the `user_totp` table.
 * Uses the `otplib` package for TOTP generation and verification.
 * QR codes are generated via the `qrcode` package for setup.
 *
 * DB table (created via migration 12):
 *   user_totp(user_id TEXT PK, secret TEXT, enabled INTEGER DEFAULT 0, created_at DATETIME)
 */

'use strict';

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class TOTPManager {
  static instance = null;

  static getInstance() {
    if (!TOTPManager.instance) {
      TOTPManager.instance = new TOTPManager();
    }
    return TOTPManager.instance;
  }

  _getLib() {
    const { authenticator } = require('otplib');
    return authenticator;
  }

  /**
   * Check whether a user has TOTP enabled.
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async isEnabled(userId) {
    const row = await DatabaseManager.queryOne(
      `SELECT enabled FROM user_totp WHERE user_id = ?`,
      [userId]
    );
    return row?.enabled === 1;
  }

  /**
   * Begin TOTP setup: generate a new secret but do NOT enable yet.
   * Returns the plaintext secret and a QR code data URL for display.
   * The user must confirm a valid code before TOTP is activated.
   *
   * @param {string} userId
   * @param {string} username  — label shown in authenticator app
   * @param {string} issuer    — app name shown in authenticator app
   * @returns {Promise<{ secret: string, qrDataUrl: string }>}
   */
  async beginSetup(userId, username, issuer = 'JellySSO') {
    const authenticator = this._getLib();
    const secret = authenticator.generateSecret();

    // Store as pending (enabled = 0) — overwrite any previous pending setup
    await DatabaseManager.run(
      `INSERT OR REPLACE INTO user_totp (user_id, secret, enabled, created_at)
       VALUES (?, ?, 0, CURRENT_TIMESTAMP)`,
      [userId, secret]
    );

    const otpauthUrl = authenticator.keyuri(username, issuer, secret);

    let qrDataUrl;
    try {
      const QRCode = require('qrcode');
      qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    } catch {
      qrDataUrl = null; // caller can fall back to displaying the raw secret
    }

    return { secret, qrDataUrl, otpauthUrl };
  }

  /**
   * Confirm setup: verify the first code and mark TOTP as enabled.
   * @param {string} userId
   * @param {string} token  — 6-digit code from authenticator
   * @returns {Promise<boolean>} true if activated, false if wrong code
   */
  async confirmSetup(userId, token) {
    const row = await DatabaseManager.queryOne(
      `SELECT secret FROM user_totp WHERE user_id = ? AND enabled = 0`,
      [userId]
    );
    if (!row) {
      throw new Error('No pending TOTP setup found');
    }

    const authenticator = this._getLib();
    if (!authenticator.verify({ token: String(token), secret: row.secret })) {
      return false;
    }

    await DatabaseManager.run(
      `UPDATE user_totp SET enabled = 1 WHERE user_id = ?`,
      [userId]
    );
    return true;
  }

  /**
   * Verify a TOTP code during login.
   * @param {string} userId
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async verify(userId, token) {
    const row = await DatabaseManager.queryOne(
      `SELECT secret FROM user_totp WHERE user_id = ? AND enabled = 1`,
      [userId]
    );
    if (!row) return false;

    const authenticator = this._getLib();
    return authenticator.verify({ token: String(token), secret: row.secret });
  }

  /**
   * Disable TOTP for a user (admin reset or user opt-out).
   * @param {string} userId
   */
  async disable(userId) {
    await DatabaseManager.run(
      `DELETE FROM user_totp WHERE user_id = ?`,
      [userId]
    );
    logger.info(`TOTP disabled for user ${userId}`);
  }

  /**
   * Get TOTP status for a user (for account page display).
   * @param {string} userId
   * @returns {Promise<{ enabled: boolean, createdAt?: string }>}
   */
  async getStatus(userId) {
    const row = await DatabaseManager.queryOne(
      `SELECT enabled, created_at FROM user_totp WHERE user_id = ?`,
      [userId]
    );
    if (!row) return { enabled: false };
    return { enabled: row.enabled === 1, createdAt: row.created_at };
  }
}

module.exports = TOTPManager;
