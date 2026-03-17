const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');

// Alphabet excludes visually ambiguous characters: 0, 1, I, L, O
const OTP_CHARS = 'BCDEFGHJKMNPQRSTVWXYZ23456789';
const OTP_LENGTH = 8;
const OTP_EXPIRY_MINUTES = 15;

class OTPManager {
  /**
   * Create the otp_tokens table if it doesn't already exist.
   * Called once at server startup alongside other schema initializers.
   */
  static async initializeSchema() {
    await DatabaseManager.run(`
      CREATE TABLE IF NOT EXISTS otp_tokens (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        userId    TEXT    UNIQUE NOT NULL,
        tokenHash TEXT    NOT NULL,
        expiresAt TEXT    NOT NULL,
        createdAt TEXT    DEFAULT (datetime('now'))
      )
    `);
  }

  /**
   * Generate a cryptographically random OTP from an unambiguous character set.
   * Returns the plaintext string — store only the hash, never the plaintext.
   */
  static _generate() {
    let otp = '';
    for (let i = 0; i < OTP_LENGTH; i++) {
      otp += OTP_CHARS[crypto.randomInt(0, OTP_CHARS.length)];
    }
    return otp;
  }

  static _hash(otp) {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  /**
   * Create (or replace) an OTP for a user.
   * @returns {{ otp: string, expiresAt: string }}  plaintext OTP + ISO expiry
   */
  static async create(userId) {
    const otp = this._generate();
    const hash = this._hash(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    await DatabaseManager.run(
      `INSERT OR REPLACE INTO otp_tokens (userId, tokenHash, expiresAt)
       VALUES (?, ?, ?)`,
      [userId, hash, expiresAt]
    );

    return { otp, expiresAt };
  }

  /**
   * Get the stored token record for a user (without plaintext).
   * Returns null if no record exists.
   */
  static async getRecord(userId) {
    return DatabaseManager.get(
      'SELECT userId, expiresAt, createdAt FROM otp_tokens WHERE userId = ?',
      [userId]
    );
  }

  /**
   * Returns true if a non-expired OTP exists for the user.
   */
  static async hasActive(userId) {
    const record = await this.getRecord(userId);
    if (!record) return false;
    return new Date(record.expiresAt) > new Date();
  }

  /**
   * Delete the OTP record for a user (revoke).
   */
  static async revoke(userId) {
    await DatabaseManager.run(
      'DELETE FROM otp_tokens WHERE userId = ?',
      [userId]
    );
  }

  /**
   * Purge all expired OTP records (for maintenance).
   */
  static async purgeExpired() {
    await DatabaseManager.run(
      `DELETE FROM otp_tokens WHERE expiresAt <= datetime('now')`
    );
  }
}

module.exports = OTPManager;
