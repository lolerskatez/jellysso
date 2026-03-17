const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');

// Alphabet excludes visually ambiguous characters: 0, 1, I, L, O
const GEN_CHARS = 'BCDEFGHJKMNPQRSTVWXYZ23456789';
const GEN_LENGTH = 8;

/**
 * OTPManager - manages generated Jellyfin passwords for SSO users.
 *
 * The generated password is permanent (no TTL). It remains the user's
 * Jellyfin password until a new one is generated, which atomically replaces it.
 * The plaintext is shown exactly once at generation time and is never stored.
 */
class OTPManager {
  static async initializeSchema() {
    await DatabaseManager.query(`
      CREATE TABLE IF NOT EXISTS otp_tokens (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        userId    TEXT    UNIQUE NOT NULL,
        tokenHash TEXT    NOT NULL,
        createdAt TEXT    DEFAULT (datetime('now'))
      )
    `);
  }

  static _generate() {
    let pw = '';
    for (let i = 0; i < GEN_LENGTH; i++) {
      pw += GEN_CHARS[crypto.randomInt(0, GEN_CHARS.length)];
    }
    return pw;
  }

  static _hash(pw) {
    return crypto.createHash('sha256').update(pw).digest('hex');
  }

  /**
   * Generate a new password for a user, replacing any existing record.
   * @returns {{ password: string, createdAt: string }}
   */
  static async create(userId) {
    const password = this._generate();
    const hash = this._hash(password);
    const createdAt = new Date().toISOString();

    await DatabaseManager.query(
      `INSERT OR REPLACE INTO otp_tokens (userId, tokenHash, createdAt)
       VALUES (?, ?, ?)`,
      [userId, hash, createdAt]
    );

    return { password, createdAt };
  }

  /**
   * Get the stored record for a user (hash never exposed).
   * Returns null if no record exists.
   */
  static async getRecord(userId) {
    return DatabaseManager.queryOne(
      'SELECT userId, createdAt FROM otp_tokens WHERE userId = ?',
      [userId]
    );
  }

  /** Delete the record (e.g. when an admin removes the user). */
  static async remove(userId) {
    await DatabaseManager.query(
      'DELETE FROM otp_tokens WHERE userId = ?',
      [userId]
    );
  }
}

module.exports = OTPManager;