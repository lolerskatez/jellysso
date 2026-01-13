/**
 * Validation utility functions for API request data
 */

const validateSettings = (data) => {
  const errors = [];

  if (data.theme && !['light', 'dark', 'auto'].includes(data.theme)) {
    errors.push('Theme must be one of: light, dark, auto');
  }

  if (data.language && typeof data.language !== 'string') {
    errors.push('Language must be a string');
  }

  if (data.notifications !== undefined && typeof data.notifications !== 'boolean') {
    errors.push('Notifications must be a boolean');
  }

  return errors;
};

const validateSystemConfig = (data) => {
  const errors = [];

  if (data.ServerName && (typeof data.ServerName !== 'string' || data.ServerName.trim().length === 0)) {
    errors.push('ServerName must be a non-empty string');
  }

  if (data.EnableUPnP !== undefined && typeof data.EnableUPnP !== 'boolean') {
    errors.push('EnableUPnP must be a boolean');
  }

  return errors;
};

const validateQuickConnectParams = (data) => {
  const errors = [];

  if (data.secret && (typeof data.secret !== 'string' || data.secret.trim().length === 0)) {
    errors.push('Secret must be a non-empty string');
  }

  if (data.code && (typeof data.code !== 'string' || data.code.trim().length === 0)) {
    errors.push('Code must be a non-empty string');
  }

  if (data.userId && (typeof data.userId !== 'string' || data.userId.trim().length === 0)) {
    errors.push('UserId must be a non-empty string');
  }

  return errors;
};

const validateActivityLogParams = (query) => {
  const errors = [];

  if (query.startIndex !== undefined) {
    const idx = parseInt(query.startIndex);
    if (isNaN(idx) || idx < 0) {
      errors.push('startIndex must be a non-negative integer');
    }
  }

  if (query.limit !== undefined) {
    const lim = parseInt(query.limit);
    if (isNaN(lim) || lim < 1 || lim > 1000) {
      errors.push('limit must be an integer between 1 and 1000');
    }
  }

  return errors;
};

const validateSetupData = (data, step) => {
  const errors = [];

  if (step === 1) {
    // Server configuration
    if (!data.jellyfinUrl || typeof data.jellyfinUrl !== 'string' || !isValidUrl(data.jellyfinUrl)) {
      errors.push('Jellyfin URL must be a valid URL');
    }

    if (!data.jellyfinPublicUrl || typeof data.jellyfinPublicUrl !== 'string' || !isValidUrl(data.jellyfinPublicUrl)) {
      errors.push('Jellyfin Public URL must be a valid URL');
    }

    if (!data.webAppPublicUrl || typeof data.webAppPublicUrl !== 'string' || !isValidUrl(data.webAppPublicUrl)) {
      errors.push('Web App Public URL must be a valid URL');
    }
  } else if (step === 2) {
    // Admin setup
    if (!data.adminUsername || typeof data.adminUsername !== 'string' || data.adminUsername.trim().length === 0) {
      errors.push('Admin username must be a non-empty string');
    }

    if (!data.adminPassword || typeof data.adminPassword !== 'string' || data.adminPassword.length < 4) {
      errors.push('Admin password must be at least 4 characters');
    }
  }

  return errors;
};

const isValidUrl = (urlString) => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

module.exports = {
  validateSettings,
  validateSystemConfig,
  validateQuickConnectParams,
  validateActivityLogParams,
  validateSetupData
};
