const express = require('express');
const router = express.Router();
const SetupManager = require('../models/SetupManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const path = require('path');
const fs = require('fs');

// Plugin management page
router.get('/', (req, res) => {
  try {
    const config = SetupManager.getConfig();

    res.render('plugin', {
      title: 'Plugin Management',
      user: req.session.user,
      apiKey: config.apiKey,
      jellyfinUrl: config.jellyfinUrl,
      webAppUrl: config.webAppPublicUrl
    });
  } catch (error) {
    console.error('Error in plugin route:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download plugin endpoint
router.get('/download', (req, res) => {
  const pluginPath = path.join(__dirname, '../../jellyfin-plugin/bin/Release/net6.0/SSOCompanion.dll');

  // Check if plugin exists
  if (fs.existsSync(pluginPath)) {
    res.download(pluginPath, 'JellyfinSSOCompanion.dll');
  } else {
    // Try development path
    const devPluginPath = path.join(__dirname, '../../jellyfin-plugin/bin/Debug/net6.0/SSOCompanion.dll');
    if (fs.existsSync(devPluginPath)) {
      res.download(devPluginPath, 'JellyfinSSOCompanion.dll');
    } else {
      res.status(404).json({ error: 'Plugin not found. Please build the plugin first.' });
    }
  }
});

// Regenerate API key
router.post('/regenerate-key', csrfProtection, async (req, res) => {
  // Generate a new secure random API key
  const crypto = require('crypto');
  const newKey = crypto.randomBytes(32).toString('hex');

  SetupManager.updateConfig({ apiKey: newKey });

  // Log the API key regeneration (if user is authenticated)
  if (req.session.user) {
    await AuditLogger.logApiKeyRegenerate(req.session.user?.Id, req.ip);
  }

  res.json({
    success: true,
    newKey: newKey,
    message: 'API key regenerated successfully'
  });
});

module.exports = router;