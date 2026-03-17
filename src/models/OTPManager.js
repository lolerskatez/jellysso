const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');

// Character pools — each pool guarantees at least one character in generated passwords.
// Visually ambiguous characters excluded: 0, 1, I, L, O, l
const GEN_UPPER   = 'BCDEFGHJKMNPQRSTVWXYZ';
const GEN_LOWER   = 'bcdefghjkmnpqrstvwxyz';
const GEN_DIGITS  = '23456789';
const GEN_SPECIAL = '!@#$%^&*';
const GEN_ALL     = GEN_UPPER + GEN_LOWER + GEN_DIGITS + GEN_SPECIAL;
const GEN_LENGTH  = 16;

/**
 * OTPManager - manages generated Jellyfin passwords for SSO users.
 *
 * The generated password is permanent (no TTL). It remains the user's
 * Jellyfin password until a new one is generated, which atomically replaces it.
 * The plaintext is shown exactly once at generation time and is never stored.
 */
class OTPManager {
  static async initializeSchema() {
    // Drop old schema that had expiresAt NOT NULL (safe — passwords can be regenerated)
    const tableInfo = await DatabaseManager.query(`PRAGMA table_info(otp_tokens)`);
    const hasExpiry = tableInfo.some(col => col.name === 'expiresAt');
    if (hasExpiry) {
      await DatabaseManager.query(`DROP TABLE otp_tokens`);
    }

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
    // Guarantee at least one character from each required pool
    const required = [
      GEN_UPPER  [crypto.randomInt(0, GEN_UPPER.length)],
      GEN_LOWER  [crypto.randomInt(0, GEN_LOWER.length)],
      GEN_DIGITS [crypto.randomInt(0, GEN_DIGITS.length)],
      GEN_SPECIAL[crypto.randomInt(0, GEN_SPECIAL.length)],
    ];

    // Fill remaining positions from the full combined pool
    const rest = [];
    for (let i = 0; i < GEN_LENGTH - required.length; i++) {
      rest.push(GEN_ALL[crypto.randomInt(0, GEN_ALL.length)]);
    }

    // Fisher-Yates shuffle so required characters aren't always at the front
    const chars = [...required, ...rest];
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
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