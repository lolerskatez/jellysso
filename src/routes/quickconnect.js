const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const AuditLogger = require('../models/AuditLogger');
const DatabaseManager = require('../models/DatabaseManager');
const logger = require('../utils/logger');
const { csrfProtection } = require('../middleware/csrf');
const { validateQuickConnectParams } = require('../middleware/validation');

const QC_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Middleware to require setup to be complete
const requireSetupComplete = (req, res, next) => {
  if (!SetupManager.isSetupComplete()) {
    const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
    if (isAjax) {
      return res.status(503).json({ success: false, message: 'System not configured. Please complete setup.' });
    }
    return res.redirect('/setup');
  }
  next();
};

// --- DB helpers for quickconnect_sessions ---

async function qcInsert(code, secret, deviceName, deviceType) {
  const expiresAt = new Date(Date.now() + QC_TTL_MS).toISOString();
  await DatabaseManager.query(
    `INSERT OR REPLACE INTO quickconnect_sessions (code, secret, device_name, device_type, initiated_at, expires_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    [code, secret, deviceName, deviceType, expiresAt]
  );
}

async function qcGet(code) {
  return DatabaseManager.queryOne(
    'SELECT * FROM quickconnect_sessions WHERE code = ? AND expires_at > datetime(\'now\')',
    [code]
  );
}

async function qcDelete(code) {
  await DatabaseManager.query('DELETE FROM quickconnect_sessions WHERE code = ?', [code]);
}

async function qcAll() {
  return DatabaseManager.query(
    'SELECT * FROM quickconnect_sessions WHERE expires_at > datetime(\'now\') ORDER BY initiated_at DESC'
  );
}

async function qcCleanup() {
  await DatabaseManager.query('DELETE FROM quickconnect_sessions WHERE expires_at <= datetime(\'now\')');
}

// Periodic cleanup of expired sessions
setInterval(() => qcCleanup().catch(() => {}), 60000);

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
router.post('/initiate', requireSetupComplete, csrfProtection, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const result = await jellyfin.initiateQuickConnect();
    
    const deviceName = req.body.deviceName || req.headers['user-agent'] || 'Unknown Device';
    const deviceType = req.body.deviceType || 'Web App';
    
    await qcInsert(result.Code, result.Secret, deviceName, deviceType);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get QuickConnect state
router.post('/connect', requireSetupComplete, csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
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
router.post('/authorize', requireSetupComplete, csrfProtection, async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ success: false, message: 'Code is required' });
  }

  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in to authorize devices' });
  }

  try {
    // Upsert session record if not already tracked
    const existing = await qcGet(code);
    if (!existing) {
      await qcInsert(code, null, 'Unknown Device', 'Quick Connect');
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const result = await jellyfin.authorizeQuickConnect(code, req.session.user.Id);
    
    await AuditLogger.log('QUICKCONNECT_AUTHORIZE', req.session.user.Id, 'quickconnect:authorize', 
      { code: code.substring(0, 3) + '***' }, 'success', req.ip);

    await qcDelete(code);
    
    res.json({ success: true, message: 'Device authorized successfully' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_AUTHORIZE_FAILED', req.session.user?.Id || 'unknown', 'quickconnect:authorize', 
      { error: error.message }, 'failure', req.ip);
    await qcDelete(code);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Authenticate with QuickConnect
router.post('/authenticate', requireSetupComplete, csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
  const errors = validateQuickConnectParams({ secret });
  if (errors.length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const authResult = await jellyfin.authenticateWithQuickConnect(secret);
    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    
    await AuditLogger.logQuickConnectAuth(authResult.User?.Id, req.ip);
    
    req.session.save((err) => {
      if (err) {
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
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  try {
    const rows = await qcAll();
    const sessions = rows.map(s => ({
      Code: s.code,
      DeviceName: s.device_name,
      DeviceType: s.device_type,
      DateCreated: s.initiated_at
    }));
    res.json({ success: true, sessions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Approve a quick connect session
router.post('/sessions/:code/approve', requireSetupComplete, csrfProtection, async (req, res) => {
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  const { code } = req.params;
  const session = await qcGet(code);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  try {
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, req.session.accessToken);
    await jellyfin.approveQuickConnectSession(code, req.session.user.Id);
    await qcDelete(code);
    
    await AuditLogger.log('QUICKCONNECT_SESSION_APPROVED', req.session.user.Id, 'quickconnect:session:approve', 
      { code: code.substring(0, 3) + '***', device: session.device_name }, 'success', req.ip);
    
    res.json({ success: true, message: 'Session approved' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_SESSION_APPROVE_FAILED', req.session.user.Id, 'quickconnect:session:approve', 
      { code: code.substring(0, 3) + '***', error: error.message }, 'failure', req.ip);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Reject a quick connect session
router.post('/sessions/:code/reject', requireSetupComplete, csrfProtection, async (req, res) => {
  if (!req.session?.user?.Id) {
    return res.status(401).json({ success: false, message: 'You must be logged in' });
  }

  const { code } = req.params;
  const session = await qcGet(code);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }

  try {
    await qcDelete(code);
    
    await AuditLogger.log('QUICKCONNECT_SESSION_REJECTED', req.session.user.Id, 'quickconnect:session:reject', 
      { code: code.substring(0, 3) + '***', device: session.device_name }, 'success', req.ip);
    
    res.json({ success: true, message: 'Session rejected' });
  } catch (error) {
    await AuditLogger.log('QUICKCONNECT_SESSION_REJECT_FAILED', req.session.user.Id, 'quickconnect:session:reject', 
      { code: code.substring(0, 3) + '***', error: error.message }, 'failure', req.ip);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Check QuickConnect status (poll for authorization)
router.post('/status', requireSetupComplete, csrfProtection, async (req, res) => {
  const { secret } = req.body;
  
  if (!secret) {
    return res.status(400).json({ success: false, message: 'Secret required' });
  }

  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const state = await jellyfin.getQuickConnectState(secret);
    
    if (state.Authenticated) {
      const authResult = await jellyfin.authenticateWithQuickConnect(secret);
      req.session.user = authResult.User;
      req.session.accessToken = authResult.AccessToken;
      
      await AuditLogger.logQuickConnectAuth(authResult.User?.Id, req.ip);
      
      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Session save failed' });
        }
        res.json({ success: true, authenticated: true, user: authResult.User });
      });
    } else {
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
