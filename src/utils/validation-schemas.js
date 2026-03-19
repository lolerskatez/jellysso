/**
 * Centralized validation schemas for all API endpoints
 * Uses simple validation functions (no external dependencies)
 */

const schemas = {
  // Authentication
  login: {
    username: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    password: { required: true, type: 'string', minLength: 1, maxLength: 1024 }
  },

  // User management
  createUser: {
    Name: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    Password: { required: false, type: 'string', minLength: 0, maxLength: 1024 }
  },

  updateUser: {
    Name: { required: false, type: 'string', minLength: 1, maxLength: 255 },
    Password: { required: false, type: 'string', minLength: 0, maxLength: 1024 }
  },

  // Policy management
  setPolicyTier: {
    userId: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    tier: { required: true, type: 'string', enum: ['Free', 'Standard', 'Premium', 'Family'] }
  },

  addWhitelistedDevice: {
    deviceId: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    deviceName: { required: false, type: 'string', minLength: 0, maxLength: 255 },
    deviceType: { required: false, type: 'string', minLength: 0, maxLength: 100 }
  },

  // Settings
  updateSettings: {
    theme: { required: false, type: 'string', enum: ['light', 'dark', 'auto'] },
    language: { required: false, type: 'string', minLength: 2, maxLength: 10 },
    notifications: { required: false, type: 'boolean' }
  },

  // QuickConnect
  quickConnectAuthorize: {
    secret: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    code: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    userId: { required: false, type: 'string', minLength: 0, maxLength: 255 }
  },

  // Setup
  setupStep1: {
    jellyfinUrl: { required: true, type: 'string', isUrl: true },
    jellyfinPublicUrl: { required: false, type: 'string', isUrl: true },
    webAppPublicUrl: { required: false, type: 'string', isUrl: true }
  },

  setupStep2: {
    adminUsername: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    adminPassword: { required: true, type: 'string', minLength: 4, maxLength: 1024 }
  }
};

/**
 * Validate data against a schema
 * @param {Object} data - Data to validate
 * @param {Object} schema - Schema definition
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validate(data, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    // Skip validation if not required and not provided
    if (!rules.required && (value === undefined || value === null || value === '')) {
      continue;
    }

    // Check type
    if (rules.type && typeof value !== rules.type) {
      errors.push(`${field} must be of type ${rules.type}`);
      continue;
    }

    // Check string length
    if (rules.type === 'string') {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push(`${field} must be at least ${rules.minLength} characters`);
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`${field} must be at most ${rules.maxLength} characters`);
      }
    }

    // Check enum
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`${field} must be one of: ${rules.enum.join(', ')}`);
    }

    // Check URL format
    if (rules.isUrl) {
      try {
        new URL(value);
      } catch (_) {
        errors.push(`${field} must be a valid URL`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create a validation middleware for a specific schema
 * @param {Object} schema - Schema to validate against
 * @returns {Function} Express middleware
 */
function createValidator(schema) {
  return (req, res, next) => {
    const result = validate(req.body, schema);
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: result.errors,
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    }
    next();
  };
}

module.exports = {
  schemas,
  validate,
  createValidator
};
