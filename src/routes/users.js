const express = require('express');
const router = express.Router();
const SetupManager = require('../models/SetupManager');
const JellyfinAPI = require('../models/JellyfinAPI');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');

const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    jellyfin.apiKey = req.session.accessToken;
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

// Validation helper
const validateUserData = (data) => {
  const errors = [];
  
  if (data.Name && typeof data.Name !== 'string') {
    errors.push('Name must be a string');
  }
  if (data.Name && data.Name.trim().length === 0) {
    errors.push('Name cannot be empty');
  }
  
  return errors;
};

// Get users with search and filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, isDisabled, isAdministrator, limit = 50, startIndex = 0 } = req.query;
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    let users = await jellyfin.getUsers();
    
    // Apply filters
    if (search) {
      users = users.filter(user => 
        user.Name.toLowerCase().includes(search.toLowerCase())
      );
    }
    
    if (isDisabled !== undefined) {
      const disabled = isDisabled === 'true';
      users = users.filter(user => user.Policy?.IsDisabled === disabled);
    }
    
    if (isAdministrator !== undefined) {
      const admin = isAdministrator === 'true';
      users = users.filter(user => user.Policy?.IsAdministrator === admin);
    }
    
    // Apply pagination
    const start = parseInt(startIndex);
    const end = start + parseInt(limit);
    const paginatedUsers = users.slice(start, end);
    
    res.json({
      Items: paginatedUsers,
      TotalRecordCount: users.length,
      StartIndex: start
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user
router.post('/', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    // Validate input
    const errors = validateUserData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    if (!req.body.Name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const user = await jellyfin.createUser(req.body);
    
    // Log the user creation
    await AuditLogger.logUserCreate(req.session.user?.Id, user.Name, user.PrimaryImageTag, req.ip);
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update user
router.put('/:userId', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    // Validate input
    const errors = validateUserData(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const user = await jellyfin.updateUser(req.params.userId, req.body);
    
    // Log the user update
    await AuditLogger.logUserUpdate(req.session.user?.Id, req.params.userId, req.body, req.ip);
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user by ID
router.get('/:userId', requireAuth, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    // For now, get all users and filter - in real implementation, use specific endpoint
    const users = await jellyfin.getUsers();
    const user = users.find(u => u.Id === req.params.userId);
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete user
router.delete('/:userId', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    if (!req.params.userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    // Note: Jellyfin may not have a direct delete user endpoint
    // This would need to be implemented based on available API
    await jellyfin.deleteUser(req.params.userId);
    
    // Log the user deletion
    await AuditLogger.logUserDelete(req.session.user?.Id, req.params.userId, req.params.userId, req.ip);
    
    res.json({ success: true, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;