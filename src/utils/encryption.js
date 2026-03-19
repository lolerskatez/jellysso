/**
 * Database encryption utilities
 * Provides encryption/decryption for sensitive fields at rest
 */

const crypto = require('crypto');
const logger = require('./logger');

// Get encryption key from environment or generate one
const getEncryptionKey = () => {
  const keyEnv = process.env.ENCRYPTION_KEY;
  if (!keyEnv) {
    logger.warn('ENCRYPTION_KEY not set in environment. Using default key (INSECURE - set ENCRYPTION_KEY in production)');
    // Default key for development - MUST be overridden in production
    return crypto.scryptSync('default-encryption-key', 'salt', 32);
  }
  // Key should be 32 bytes (256 bits) for AES-256
  if (keyEnv.length < 32) {
    logger.warn('ENCRYPTION_KEY is too short. Padding with zeros (INSECURE)');
    return crypto.scryptSync(keyEnv, 'salt', 32);
  }
  return Buffer.from(keyEnv.substring(0, 64), 'hex');
};

const encryptionKey = getEncryptionKey();

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @returns {string} Encrypted data in format: iv:encrypted:authTag (hex encoded)
 */
function encrypt(plaintext) {
  try {
    if (!plaintext) return plaintext;

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:encrypted:authTag (all hex encoded)
    return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  } catch (error) {
    logger.error('Encryption failed', { error: error.message });
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt sensitive data using AES-256-GCM
 * @param {string} encrypted - Encrypted data in format: iv:encrypted:authTag
 * @returns {string} Decrypted plaintext
 */
function decrypt(encrypted) {
  try {
    if (!encrypted) return encrypted;

    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', { error: error.message });
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value (one-way, for comparison)
 * @param {string} value - Value to hash
 * @returns {string} SHA-256 hash (hex encoded)
 */
function hash(value) {
  if (!value) return value;
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Verify a value against a hash
 * @param {string} value - Value to verify
 * @param {string} hashValue - Hash to compare against
 * @returns {boolean} True if value matches hash
 */
function verifyHash(value, hashValue) {
  if (!value || !hashValue) return false;
  return hash(value) === hashValue;
}

/**
 * Generate a random token (for API keys, reset tokens, etc.)
 * @param {number} length - Length in bytes (default 32)
 * @returns {string} Random token (hex encoded)
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Create a wrapper for database fields that should be encrypted
 * Usage: In database operations, wrap sensitive fields with this
 */
const EncryptedField = {
  /**
   * Prepare field for storage (encrypt if needed)
   */
  prepare: (value) => {
    if (!value) return value;
    return encrypt(value);
  },

  /**
   * Retrieve field from storage (decrypt if needed)
   */
  retrieve: (value) => {
    if (!value) return value;
    try {
      return decrypt(value);
    } catch (error) {
      logger.error('Failed to decrypt field', { error: error.message });
      return null;
    }
  }
};

module.exports = {
  encrypt,
  decrypt,
  hash,
  verifyHash,
  generateToken,
  EncryptedField,
  getEncryptionKey
};
