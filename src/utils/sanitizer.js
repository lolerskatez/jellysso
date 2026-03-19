const xss = require('xss');

/**
 * Sanitization utility for preventing XSS vulnerabilities
 * Provides functions to sanitize user input and output
 */

const defaultOptions = {
  whiteList: {},
  stripIgnoreTag: true,
  stripLeadingAndTrailingWhitespace: true,
  onIgnoreTag: null,
  onIgnoreTagAttr: null,
  onTagAttr: null,
  onTag: null,
  css: false
};

/**
 * Sanitize a string to prevent XSS attacks
 * @param {string} input - The input string to sanitize
 * @param {object} options - Optional XSS options
 * @returns {string} - Sanitized string
 */
function sanitizeInput(input, options = {}) {
  if (typeof input !== 'string') {
    return input;
  }
  return xss(input, { ...defaultOptions, ...options });
}

/**
 * Sanitize an object's string properties
 * @param {object} obj - The object to sanitize
 * @param {array} keysToSanitize - Optional array of keys to sanitize (if not provided, sanitizes all string values)
 * @returns {object} - New object with sanitized values
 */
function sanitizeObject(obj, keysToSanitize = null) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key in sanitized) {
    if (sanitized.hasOwnProperty(key)) {
      // Skip sanitization if specific keys are provided and this key is not in the list
      if (keysToSanitize && !keysToSanitize.includes(key)) {
        continue;
      }

      if (typeof sanitized[key] === 'string') {
        sanitized[key] = sanitizeInput(sanitized[key]);
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = sanitizeObject(sanitized[key], keysToSanitize);
      }
    }
  }

  return sanitized;
}

/**
 * Sanitize request body and query parameters
 * @param {object} req - Express request object
 * @returns {object} - Object with sanitized body and query
 */
function sanitizeRequest(req) {
  return {
    body: req.body ? sanitizeObject(req.body) : {},
    query: req.query ? sanitizeObject(req.query) : {},
    params: req.params ? sanitizeObject(req.params) : {}
  };
}

/**
 * Middleware to automatically sanitize request data
 * @returns {function} - Express middleware
 */
function sanitizationMiddleware() {
  return (req, res, next) => {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    next();
  };
}

/**
 * Escape HTML entities in a string
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') {
    return str;
  }
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, (char) => map[char]);
}

module.exports = {
  sanitizeInput,
  sanitizeObject,
  sanitizeRequest,
  sanitizationMiddleware,
  escapeHtml
};
