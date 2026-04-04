/**
 * Comprehensive password validation utility
 * Enforces complexity requirements and checks against common passwords
 */

const CONSTANTS = require('./constants');
const logger = require('../utils/logger');

// Common passwords to reject
const COMMON_PASSWORDS = new Set([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', '1234567',
  'letmein', 'trustno1', 'dragon', 'baseball', '111111', 'iloveyou', 'master',
  'sunshine', 'ashley', 'bailey', 'passw0rd', 'shadow', '123123', '654321',
  'superman', 'qazwsx', 'michael', 'football', 'welcome', 'jesus', 'ninja',
  'mustang', 'password123', 'admin', 'root', 'toor', 'pass', 'test'
]);

/**
 * Validate password against complexity requirements
 * @param {string} password - Password to validate
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validatePassword(password) {
  const errors = [];
  const pwd = password || '';

  // Check minimum length
  if (pwd.length < CONSTANTS.PASSWORD.MIN_LENGTH) {
    errors.push(`Password must be at least ${CONSTANTS.PASSWORD.MIN_LENGTH} characters long`);
  }

  // Check for uppercase
  if (CONSTANTS.PASSWORD.REQUIRE_UPPERCASE && !/[A-Z]/.test(pwd)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Check for lowercase
  if (CONSTANTS.PASSWORD.REQUIRE_LOWERCASE && !/[a-z]/.test(pwd)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Check for numbers
  if (CONSTANTS.PASSWORD.REQUIRE_NUMBERS && !/[0-9]/.test(pwd)) {
    errors.push('Password must contain at least one number');
  }

  // Check for special characters
  if (CONSTANTS.PASSWORD.REQUIRE_SPECIAL_CHARS && !CONSTANTS.PASSWORD.SPECIAL_CHARS_PATTERN.test(pwd)) {
    errors.push('Password must contain at least one special character (!@#$%^&*...)');
  }

  // Check against common passwords
  if (COMMON_PASSWORDS.has(pwd.toLowerCase())) {
    errors.push('Password is too common. Please choose a stronger password');
  }

  // Check for sequential characters (e.g., "abc", "123", "qwerty")
  if (hasSequentialChars(pwd)) {
    errors.push('Password contains sequential characters. Please choose a different password');
  }

  // Check for repeated characters (e.g., "aaa", "111")
  if (hasRepeatedChars(pwd)) {
    errors.push('Password contains too many repeated characters');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if password contains sequential characters
 * @param {string} password
 * @returns {boolean}
 */
function hasSequentialChars(password) {
  const sequences = ['abc', 'bcd', 'cde', 'def', 'efg', 'fgh', 'ghi', 'hij', 'ijk', 'jkl', 'klm', 'lmn', 'mno', 'nop', 'opq', 'pqr', 'qrs', 'rst', 'stu', 'tuv', 'uvw', 'vwx', 'wxy', 'xyz',
    '012', '123', '234', '345', '456', '567', '678', '789',
    'qwerty', 'asdfgh', 'zxcvbn'];
  
  const lower = password.toLowerCase();
  return sequences.some(seq => lower.includes(seq));
}

/**
 * Check if password has too many repeated characters
 * @param {string} password
 * @returns {boolean}
 */
function hasRepeatedChars(password) {
  // Check for 3 or more consecutive identical characters
  return /(.)\1{2,}/.test(password);
}

/**
 * Check if new password is different from old password
 * @param {string} newPassword
 * @param {string} oldPassword
 * @returns {boolean}
 */
function isDifferentFromOld(newPassword, oldPassword) {
  return newPassword !== oldPassword;
}

/**
 * Check if password was recently used (password history)
 * @param {string} newPassword
 * @param {array} passwordHistory - Array of hashed old passwords
 * @param {function} compareHash - Function to compare password with hash
 * @returns {boolean} - true if password is in history
 */
async function isInHistory(newPassword, passwordHistory, compareHash) {
  if (!passwordHistory || passwordHistory.length === 0) {
    return false;
  }

  for (const hashedPassword of passwordHistory) {
    try {
      const matches = await compareHash(newPassword, hashedPassword);
      if (matches) {
        return true;
      }
    } catch (error) {
      logger.error('Error comparing password history:', error);
    }
  }

  return false;
}

module.exports = {
  validatePassword,
  isDifferentFromOld,
  isInHistory,
  COMMON_PASSWORDS
};
