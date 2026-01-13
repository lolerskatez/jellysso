const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const { validateActivityLogParams } = require('../middleware/validation');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Get activity logs
router.get('/', requireAuth, async (req, res) => {
  try {
    // Validate query parameters
    const errors = validateActivityLogParams(req.query);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const { startIndex = 0, limit = 50 } = req.query;
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const logs = await jellyfin.getActivityLog(parseInt(startIndex), parseInt(limit));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;