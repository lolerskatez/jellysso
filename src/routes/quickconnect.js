const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { validateQuickConnectParams } = require('../middleware/validation');

// In-memory store for pending quick connect sessions
// Format: { code: { secret, code, deviceName, deviceType, initiatedAt, userId } }
const pendingSessions = new Map();

// Clean up expired sessions every minute
setInterval(() => {
  const now = Date.now();
  const maxAge = 15 * 60 * 1000; // 15 minutes
  for (const [code, session] of pendingSessions.entries()) {
    if (now - session.initiatedAt > maxAge) {
      pendingSessions.delete(code);
      console.log(`Cleaned up expired quick connect session: ${code}`);
    }
  }
}, 60000);

// Check if QuickConnect is enabled
router.get('/enabled', async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const enabled = await jellyfin.checkQuickConnectEnabled();
    res.json({ enabled });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Initiate QuickConnect - tracks the new pending session
router.post('/initiate', csrfProtection, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const result = await jellyfin.initiateQuickConnect();
    
    // Store pending session with device info from headers/request
    const deviceName = req.body.deviceName || req.headers['user-agent'] || 'Unknown Device';
    const deviceType = req.body.deviceType || 'Web App';
    
    pendingSessions.set(result.Code, {
      secret: result.Secret,
      code: result.Code,
      deviceName: deviceName,
      deviceType: deviceType,
      initiatedAt: Date.now()
    });
    
    console.log(`Initiated Quick Connect: ${result.Code} for device: ${deviceName}`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get QuickConnect state
router.post('/connect', csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
  // Validate input
  const errors = validateQuickConnectParams({ secret });
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const state = await jellyfin.getQuickConnectState(secret);
    res.json(state);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Authorize QuickConnect - authorizes a device code using the logged-in user's session
router.post('/authorize', csrfProtection, async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ success: false, message: 'Code is required' });
  }

  // Must be logged in to authorize
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in to authorize devices' });
  }

  try {
    // Add to pending sessions if not already there (for approval tracking)
    if (!pendingSessions.has(code)) {
      pendingSessions.set(code, {
        secret: null,
        code: code,
        deviceName: 'Unknown Device',
        deviceType: 'Quick Connect',
        initiatedAt: Date.now()
      });
      console.log(`Added pending Quick Connect session: ${code}`);
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const result = await jellyfin.authorizeQuickConnect(code, req.session.user.Id);
    
    // Log the authorization
    await AuditLogger.log('QUICKCONNECT_AUTHORIZE', req.session.user.Id, 'quickconnect:authorize', 
      { code: code.substring(0, 3) + '***' }, 'success', req.ip);

    // Remove from pending after successful authorization
    pendingSessions.delete(code);
    
    res.json({ success: true, message: 'Device authorized successfully' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_AUTHORIZE_FAILED', req.session.user.Id, 'quickconnect:authorize', 
      { error: error.message }, 'failure', req.ip);
    
    // Remove from pending if authorization failed
    pendingSessions.delete(code);
    
    res.status(400).json({ success: false, message: error.message });
  }
});

// Authenticate with QuickConnect
router.post('/authenticate', csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
  // Validate input
  const errors = validateQuickConnectParams({ secret });
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const authResult = await jellyfin.authenticateWithQuickConnect(secret);
    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    
    // Log successful QuickConnect authentication
    await AuditLogger.logQuickConnectAuth(authResult.User?.Id, req.ip);
    
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ success: false, message: 'Session save failed' });
      }
      res.json({ success: true, user: authResult.User });
    });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_AUTH_FAILED', 'unknown', 'quickconnect:auth', 
      { error: error.message }, 'failure', req.ip);
    res.status(401).json({ success: false, message: error.message });
  }
});

// Get pending quick connect sessions
router.get('/sessions', async (req, res) => {
  // Must be logged in to view pending sessions
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  try {
    // Convert pending sessions map to array
    const sessions = Array.from(pendingSessions.values()).map(session => ({
      Code: session.code,
      DeviceName: session.deviceName,
      DeviceType: session.deviceType,
      DateCreated: new Date(session.initiatedAt).toISOString()
    }));

    console.log(`Returning ${sessions.length} pending sessions`);
    res.json({ success: true, sessions: sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Approve a quick connect session
router.post('/sessions/:code/approve', csrfProtection, async (req, res) => {
  // Must be logged in to approve sessions
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  const { code } = req.params;
  const session = pendingSessions.get(code);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  try {
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, req.session.accessToken);
    
    // Authorize the quick connect code
    const result = await jellyfin.approveQuickConnectSession(code, req.session.user.Id);
    
    // Remove from pending sessions
    pendingSessions.delete(code);
    
    await AuditLogger.log('QUICKCONNECT_SESSION_APPROVED', req.session.user.Id, 'quickconnect:session:approve', 
      { code: code.substring(0, 3) + '***', device: session.deviceName }, 'success', req.ip);
    
    console.log(`Approved quick connect session: ${code}`);
    res.json({ success: true, message: 'Session approved' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_SESSION_APPROVE_FAILED', req.session.user.Id, 'quickconnect:session:approve', 
      { code: code.substring(0, 3) + '***', error: error.message }, 'failure', req.ip);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Reject a quick connect session
router.post('/sessions/:code/reject', csrfProtection, async (req, res) => {
  // Must be logged in to reject sessions
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  const { code } = req.params;
  const session = pendingSessions.get(code);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  try {
    // Remove from pending sessions
    pendingSessions.delete(code);
    
    await AuditLogger.log('QUICKCONNECT_SESSION_REJECTED', req.session.user.Id, 'quickconnect:session:reject', 
      { code: code.substring(0, 3) + '***', device: session.deviceName }, 'success', req.ip);
    
    console.log(`Rejected quick connect session: ${code}`);
    res.json({ success: true, message: 'Session rejected' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_SESSION_REJECT_FAILED', req.session.user.Id, 'quickconnect:session:reject', 
      { code: code.substring(0, 3) + '***', error: error.message }, 'failure', req.ip);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Check QuickConnect status (poll for authorization)
router.post('/status', csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
  if (!secret) {
    return res.status(400).json({ success: false, message: 'Secret required' });
  }

  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const state = await jellyfin.getQuickConnectState(secret);
    
    // Check if authorized
    if (state.Authenticated) {
      // Now authenticate with the secret to get access token
      const authResult = await jellyfin.authenticateWithQuickConnect(secret);
      req.session.user = authResult.User;
      req.session.accessToken = authResult.AccessToken;
      
      // Log successful authentication
      await AuditLogger.logQuickConnectAuth(authResult.User?.Id, req.ip);
      
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ success: false, message: 'Session save failed' });
        }
        res.json({ success: true, authenticated: true, user: authResult.User });
      });
    } else {
      // Not yet authorized, return current state
      res.json({ 
        success: true, 
        authenticated: false, 
        code: state.Code,
        dateAdded: state.DateAdded
      });
    }
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;