const express = require('express');
const router = express.Router();
const SetupManager = require('../models/SetupManager');
const JellyfinAPI = require('../models/JellyfinAPI');
const { csrfProtection } = require('../middleware/csrf');

// Middleware to check if setup is needed
const requireSetupIncomplete = (req, res, next) => {
  if (SetupManager.isSetupComplete()) {
    // If user is logged in, log them out
    if (req.session.user) {
      req.session.destroy();
    }
    return res.redirect('/login');
  }
  next();
};

// Middleware to check if setup is complete
const requireSetupComplete = (req, res, next) => {
  if (!SetupManager.isSetupComplete()) {
    return res.redirect('/setup');
  }
  next();
};

// Setup wizard main page
router.get('/', requireSetupIncomplete, (req, res) => {
  res.render('setup', {
    step: 1,
    title: 'Setup Wizard',
    version: '1.0.0'
  });
});

// Get current setup config (for AJAX)
router.get('/config', requireSetupIncomplete, (req, res) => {
  const config = SetupManager.getConfig();
  // Don't expose sensitive data
  const safeConfig = {
    jellyfinUrl: config.jellyfinUrl,
    jellyfinPublicUrl: config.jellyfinPublicUrl,
    webAppPublicUrl: config.webAppPublicUrl
  };
  res.json(safeConfig);
});

// Step 1: Basic configuration
router.post('/step1', requireSetupIncomplete, (req, res) => {
  const { jellyfinUrl, jellyfinPublicUrl, webAppPublicUrl } = req.body;

  // Validate URLs
  const urlRegex = /^https?:\/\/.+/;
  if (!urlRegex.test(jellyfinUrl) || !urlRegex.test(jellyfinPublicUrl) || !urlRegex.test(webAppPublicUrl)) {
    return res.json({ success: false, error: 'All URLs must be valid HTTP/HTTPS URLs' });
  }

  // Test Jellyfin connection
  const jellyfin = new JellyfinAPI(jellyfinUrl);
  jellyfin.testConnection().then(() => {
    // Connection successful
    SetupManager.updateConfig({
      jellyfinUrl,
      jellyfinPublicUrl,
      webAppPublicUrl
    });
    res.json({ success: true });
  }).catch(error => {
    res.json({ success: false, error: 'Cannot connect to Jellyfin server. Please check the URL.' });
  });
});

// Step 2: Admin user setup
router.post('/step2', requireSetupIncomplete, async (req, res) => {
  const { adminUsername, adminPassword } = req.body;

  if (!adminUsername || !adminPassword) {
    return res.json({ success: false, error: 'Admin username and password are required' });
  }

  if (adminPassword.length < 8) {
    return res.json({ success: false, error: 'Admin password must be at least 8 characters long' });
  }

  try {
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl);

    // Try to authenticate as admin
    const authResult = await jellyfin.authenticateByName(adminUsername, adminPassword);

    if (!authResult.User.Policy?.IsAdministrator) {
      return res.json({ success: false, error: 'User is not an administrator in Jellyfin' });
    }

    // Generate API key after successful admin authentication
    const crypto = require('crypto');
    const apiKey = crypto.randomBytes(32).toString('hex');

    // Update config with admin user and API key
    SetupManager.updateConfig({
      adminUser: adminUsername,
      apiKey: apiKey
    });

    res.json({
      success: true,
      apiKey: apiKey,
      message: 'Admin credentials validated. API key generated successfully.'
    });
  } catch (error) {
    console.error('Admin authentication error:', error.message);
    // Provide more specific error messages
    if (error.message.includes('Unable to connect')) {
      return res.json({ success: false, error: 'Cannot connect to Jellyfin server. Please check the server URL.' });
    }
    if (error.message.includes('Authentication failed')) {
      return res.json({ success: false, error: 'Invalid username or password. Please check your credentials.' });
    }
    return res.json({ success: false, error: `Authentication failed: ${error.message}` });
  }
});

// Complete setup (called after API key generation)
router.post('/complete', requireSetupIncomplete, (req, res) => {
  try {
    const config = SetupManager.getConfig();
    
    // Mark setup as complete
    const finalConfig = {
      ...config,
      isSetupComplete: true,
      setupCompletedAt: new Date().toISOString()
    };
    
    SetupManager.updateConfig(finalConfig);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Failed to complete setup' });
  }
});

module.exports = router;