const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const SettingsManager = require('../models/SettingsManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { validateSettings, validateSystemConfig } = require('../middleware/validation');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Middleware to check admin access
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.Policy && req.session.user.Policy.IsAdministrator) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

// Get system configuration
router.get('/system', requireAuth, requireAdmin, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const config = await jellyfin.getSystemConfiguration();
    res.json(config);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update system configuration
router.post('/system', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    // Validate input
    const errors = validateSystemConfig(req.body);
    if (errors.length > 0) {
      await AuditLogger.log('SYSTEM_CONFIG_UPDATE_FAILED', req.session.user?.Id, 'system:config', 
        { errors, attempt: req.body }, 'failure', req.ip);
      return res.status(400).json({ success: false, errors });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const result = await jellyfin.updateSystemConfiguration(req.body);
    
    // Log the successful update
    await AuditLogger.logSystemConfigUpdate(req.session.user?.Id, req.body, req.ip);
    
    res.json({ success: true });
  } catch (error) {
    await AuditLogger.log('SYSTEM_CONFIG_UPDATE_ERROR', req.session.user?.Id, 'system:config', 
      { error: error.message }, 'failure', req.ip);
    res.status(500).json({ message: error.message });
  }
});

// Companion app settings (persisted to file)
router.get('/companion', (req, res) => {
  try {
    const settings = SettingsManager.getSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/companion', csrfProtection, async (req, res) => {
  try {
    // Validate input
    const errors = validateSettings(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const settings = SettingsManager.updateSettings(req.body);
    
    // Log the update if user is authenticated
    if (req.session.user) {
      await AuditLogger.logSettingsUpdate(req.session.user?.Id, 'companion', req.body, req.ip);
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Backup settings
router.get('/backup', (req, res) => {
  try {
    const settings = SettingsManager.getSettings();
    const backup = {
      companion: settings,
      timestamp: new Date().toISOString()
    };
    res.json(backup);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Restore settings
router.post('/restore', csrfProtection, (req, res) => {
  try {
    const { companion } = req.body;
    if (!companion) {
      return res.status(400).json({ message: 'Invalid backup data' });
    }
    const settings = SettingsManager.updateSettings(companion);
    res.json({ success: true, message: 'Settings restored', settings });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;