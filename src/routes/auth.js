const express = require('express');
const router = express.Router();
const axios = require('axios');
const SetupManager = require('../models/SetupManager');
const JellyfinAPI = require('../models/JellyfinAPI');
const AuditLogger = require('../models/AuditLogger');
const TokenManager = require('../models/TokenManager');
const PolicyManager = require('../models/PolicyManager');
const DatabaseManager = require('../models/DatabaseManager');
const { getInstance: getAccountLockoutManager } = require('../models/AccountLockoutManager');
const { csrfProtection } = require('../middleware/csrf');
const { criticalLimiter } = require('../middleware/rate-limit');
const { AppError } = require('../middleware/error-handler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const SessionRotation = require('../utils/sessionRotation');
const jwt = require('jsonwebtoken');
const { getBaseUrl } = require('../utils/urlHelper');
const logger = require('../utils/logger');

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

// Login route - CSRF validated by global middleware, rate limited
router.post('/login', requireSetupComplete, criticalLimiter, async (req, res) => {
  const { username, password } = req.body;
  const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;

  // Validate input
  if (!username || !password) {
    await AuditLogger.log('LOGIN_ATTEMPT', 'unknown', `user:${username || 'unknown'}`, 
      { reason: 'Missing credentials' }, 'failure', req.ip);
    
    if (isAjax) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Username and password are required',
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    } else {
      req.session.errorMessage = 'Username and password are required';
      return res.redirect('/login');
    }
  }

  try {
    const lockoutManager = getAccountLockoutManager();

    // Check if account is locked
    const loginCheck = await lockoutManager.checkLoginAllowed(username, req.ip);
    if (!loginCheck.allowed) {
      await AuditLogger.logFailedLogin(username, 'Account locked', req.ip);
      logger.warn('Login attempt on locked account', { username, ip: req.ip, requestId: req.id });

      if (isAjax) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: loginCheck.reason,
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      } else {
        req.session.errorMessage = loginCheck.reason;
        return res.redirect('/login');
      }
    }

    // Attempt authentication
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const authResult = await jellyfin.authenticateByName(username, password);

    // Record successful login attempt
    await lockoutManager.recordLoginAttempt(username, req.ip, true);

    // Check JellySSO account status (enabled flag + expiry) before creating a session
    const access = await PolicyManager.checkAccountAccess(authResult.User.Id);
    if (!access.allowed) {
      await AuditLogger.logFailedLogin(username, access.reason, req.ip);
      
      if (isAjax) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_DISABLED',
            message: access.reason,
            timestamp: new Date().toISOString(),
            requestId: req.id
          }
        });
      }
      req.session.errorMessage = access.reason;
      return res.redirect('/login');
    }

    // Sync admin status from Jellyfin to database
    if (authResult.User && authResult.User.Id) {
      await PolicyManager.syncAdminStatusFromJellyfin(authResult.User.Id, authResult.User).catch(err => 
        logger.warn('Could not sync admin status', { error: err.message })
      );
    }
    
    // Use secure session rotation on login
    SessionRotation.rotateSessionOnLogin(req, res, authResult.User, authResult.AccessToken, (err, sessionId) => {
      if (err) {
        logger.error('Session rotation error', { error: err.message, requestId: req.id });
        AuditLogger.log('LOGIN_SESSION_ERROR', authResult.User?.Name || username, `user:${username}`, 
          { error: 'Session rotation failed' }, 'failure', req.ip);
        
        if (isAjax) {
          return res.status(500).json({
            success: false,
            error: {
              code: 'SESSION_ERROR',
              message: 'Failed to create session',
              timestamp: new Date().toISOString(),
              requestId: req.id
            }
          });
        }
        req.session.errorMessage = 'Failed to create session';
        return res.redirect('/login');
      }

      // Log successful login with session metadata
      const sessionMeta = SessionRotation.getSessionMetadata(req);
      AuditLogger.logSuccessfulLogin(authResult.User?.Name || username, req.ip);
      logger.info('User login successful', { 
        username: authResult.User?.Name, 
        userId: authResult.User?.Id, 
        sessionId: sessionMeta.sessionId,
        requestId: req.id 
      });
      
      if (isAjax) {
        res.json({ success: true, user: authResult.User });
      } else {
        // Normal form submission - redirect to quickconnect
        res.redirect('/quickconnect');
      }
    });

  } catch (error) {
    logger.error('Login error', { username, error: error.message, requestId: req.id });
    
    let errorCode = 'AUTH_ERROR';
    let statusCode = 500;
    let message = 'Authentication failed. Please try again.';
    let reason = 'Authentication failed';

    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      errorCode = 'INVALID_CREDENTIALS';
      statusCode = 401;
      message = 'Invalid username or password';
      reason = 'Invalid credentials';
    } else if (error.message.includes('403')) {
      errorCode = 'ACCOUNT_DISABLED';
      statusCode = 403;
      message = 'Account is disabled or access is forbidden';
      reason = 'Account disabled';
    } else if (error.message.includes('503')) {
      errorCode = 'SERVICE_UNAVAILABLE';
      statusCode = 503;
      message = 'Authentication service is temporarily unavailable';
      reason = 'Server unavailable';
    }

    // Record failed login attempt
    const lockoutManager = getAccountLockoutManager();
    await lockoutManager.recordLoginAttempt(username, req.ip, false, reason);
    
    // Log the failed attempt
    await AuditLogger.logFailedLogin(username, reason, req.ip);

    if (isAjax) {
      res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: message,
          timestamp: new Date().toISOString(),
          requestId: req.id
        }
      });
    } else {
      req.session.errorMessage = message;
      res.redirect('/login');
    }
  }
});

// Logout route - CSRF validated by global middleware
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Session destroy error:', err);
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    // Clear the session cookie
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ success: true });
  });
});

// Check authentication status
router.get('/check', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Get public users
router.get('/public-users', async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const response = await jellyfin.client.get('/Users/Public');
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch public users' });
  }
});

// Validate SSO token (for plugin) - requires API key authentication
router.get('/validate-sso', (req, res) => {
  const { token } = req.query;
  const apiKey = req.headers['x-api-key'];
  
  // Check API key using constant-time comparison to prevent timing attacks
  const expectedKey = SetupManager.getConfig().apiKey;
  const keyValid = expectedKey && apiKey && (() => {
    try {
      const a = Buffer.from(String(apiKey));
      const b = Buffer.from(String(expectedKey));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();
  if (!keyValid) {
    return res.status(401).json({ valid: false, error: 'Invalid API key' });
  }
  
  if (!token) {
    return res.status(400).json({ valid: false, error: 'No token provided' });
  }
  
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if token is not expired and contains valid user info
    if (decoded && decoded.userId && decoded.exp > Date.now() / 1000) {
      res.json({ valid: true, userId: decoded.userId });
    } else {
      res.status(401).json({ valid: false, error: 'Token expired or invalid' });
    }
  } catch (error) {
    logger.error('Token validation error:', error);
    res.status(401).json({ valid: false, error: 'Token validation failed' });
  }
});

// Refresh access token using refresh token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = TokenManager.verifyRefreshToken(refreshToken);
    
    // Get user from Jellyfin
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const users = await jellyfin.getUsers();
    const user = users.find(u => u.Id === decoded.userId);

    if (!user) {
      await AuditLogger.log({
        action: 'TOKEN_REFRESH_FAILED',
        userId: decoded.userId,
        resource: 'Token refresh',
        details: { reason: 'User not found' },
        status: 'failure',
        ip: req.ip
      });
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Generate new access token
    const newAccessToken = TokenManager.generateAccessToken(user);

    await AuditLogger.log({
      action: 'TOKEN_REFRESHED',
      userId: user.Id,
      resource: 'Token refresh',
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      expiresIn: 3600,
      tokenType: 'Bearer'
    });

  } catch (error) {
    logger.error('Token refresh error:', error.message);
    await AuditLogger.log({
      action: 'TOKEN_REFRESH_ERROR',
      userId: 'unknown',
      resource: 'Token refresh',
      details: { error: error.message },
      status: 'failure',
      ip: req.ip
    });
    res.status(401).json({ success: false, message: error.message });
  }
});

// Revoke refresh token
router.post('/revoke-token', csrfProtection, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    TokenManager.revokeRefreshToken(refreshToken);

    await AuditLogger.log({
      action: 'TOKEN_REVOKED',
      userId: req.session.user?.Id || 'unknown',
      resource: 'Token revocation',
      status: 'success',
      ip: req.ip
    });

    res.json({ success: true, message: 'Token revoked successfully' });

  } catch (error) {
    res.status(500).json({ success: false, message: 'Revocation failed' });
  }
});

// Get token statistics (admin only)
router.get('/token-stats', (req, res) => {
  if (!req.session.user || !req.session.user.Policy?.IsAdministrator) {
    return res.status(403).json({ message: 'Admin access required' });
  }

  const stats = TokenManager.getTokenStats();
  res.json({
    success: true,
    tokens: stats
  });
});

// ============================================
// OIDC SSO AUTHENTICATION
// ============================================

const crypto = require('crypto');

// Get OIDC config helper
async function getOidcConfig() {
  let config = await DatabaseManager.getSetting('oidc_config');
  // Handle legacy double-encoded JSON
  if (typeof config === 'string') {
    config = JSON.parse(config);
  }
  return config || null;
}

// Discovery document cache (5-minute TTL)
const _discoveryCache = new Map();
async function getDiscovery(issuerUrl) {
  const discoveryUrl = issuerUrl.includes('.well-known')
    ? issuerUrl
    : issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
  const cached = _discoveryCache.get(discoveryUrl);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    return cached.data;
  }
  const response = await axios.get(discoveryUrl);
  _discoveryCache.set(discoveryUrl, { data: response.data, timestamp: Date.now() });
  return response.data;
}

// OIDC Login - initiates the OIDC flow
router.get('/oidc/login', async (req, res) => {
  try {
    const oidcConfig = await getOidcConfig();
    
    if (!oidcConfig || !oidcConfig.enabled) {
      return res.status(400).send('OIDC SSO is not enabled');
    }

    // Fetch discovery document (cached)
    const discovery = await getDiscovery(oidcConfig.issuerUrl);

    // Generate state and nonce for security
    const state = crypto.randomBytes(32).toString('hex');
    const nonce = crypto.randomBytes(32).toString('hex');

    // Store state and nonce in session
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;

    // Get base URL for callback (respects reverse proxy headers)
    const appConfig = SetupManager.getConfig();
    const baseUrl = getBaseUrl(req, appConfig);
    const redirectUri = `${baseUrl}/api/auth/oidc/callback`;

    // Build authorization URL
    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('client_id', oidcConfig.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', oidcConfig.scopes || 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);

    await AuditLogger.log({
      action: 'OIDC_LOGIN_INITIATED',
      userId: 'anonymous',
      resource: 'oidc:login',
      status: 'success',
      ip: req.ip
    });

    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('OIDC login error:', error);
    await AuditLogger.log({
      action: 'OIDC_LOGIN_ERROR',
      userId: 'anonymous',
      resource: 'oidc:login',
      details: { error: error.message },
      status: 'failure',
      ip: req.ip
    });
    res.redirect('/login?error=oidc_init_failed');
  }
});

// OIDC Callback - handles the IdP callback
router.get('/oidc/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle IdP errors
    if (error) {
      logger.error('OIDC IdP error:', error, error_description);
      await AuditLogger.log({
        action: 'OIDC_CALLBACK_ERROR',
        userId: 'anonymous',
        resource: 'oidc:callback',
        details: { error, error_description },
        status: 'failure',
        ip: req.ip
      });
      return res.redirect(`/login?error=${encodeURIComponent(error_description || error)}`);
    }

    // Validate state
    if (!state || state !== req.session.oidcState) {
      await AuditLogger.log({
        action: 'OIDC_STATE_MISMATCH',
        userId: 'anonymous',
        resource: 'oidc:callback',
        status: 'failure',
        ip: req.ip
      });
      return res.redirect('/login?error=invalid_state');
    }

    const oidcConfig = await getOidcConfig();
    if (!oidcConfig || !oidcConfig.enabled) {
      return res.redirect('/login?error=oidc_disabled');
    }

    // Fetch discovery document (cached)
    const discovery = await getDiscovery(oidcConfig.issuerUrl);

    // Get base URL for callback (respects reverse proxy headers)
    const appConfig = SetupManager.getConfig();
    const baseUrl = getBaseUrl(req, appConfig);
    const redirectUri = `${baseUrl}/api/auth/oidc/callback`;

    // Exchange code for tokens
    const tokenResponse = await axios.post(discovery.token_endpoint, 
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: oidcConfig.clientId,
        client_secret: oidcConfig.clientSecret,
        code: code,
        redirect_uri: redirectUri
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokens = tokenResponse.data;

    // Decode ID token to get user info
    const idToken = tokens.id_token;
    const tokenParts = idToken.split('.');
    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

    // Extract username from configured claim
    const usernameClaim = oidcConfig.usernameClaim || 'preferred_username';
    const username = payload[usernameClaim] || payload.preferred_username || payload.email || payload.sub;

    if (!username) {
      throw new Error('Could not extract username from OIDC claims');
    }
    
    // Fetch userinfo endpoint to get additional claims (including groups if available)
    let userInfoPayload = payload;
    try {
      if (discovery.userinfo_endpoint && tokens.access_token) {
        const userinfoResponse = await axios.get(discovery.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        userInfoPayload = { ...payload, ...userinfoResponse.data };
      }
    } catch (err) {
      logger.warn(`Failed to fetch userinfo endpoint: ${err.message}. Will use ID token claims only.`);
    }

    // Clean up session state
    delete req.session.oidcState;
    delete req.session.oidcNonce;

    // Try to find or create user in Jellyfin
    const jellyfinConfig = SetupManager.getConfig();
    
    // Verify API key is configured
    if (!jellyfinConfig.apiKey) {
      logger.warn('⚠️  Warning: Jellyfin API key is not configured. User auto-creation and group mapping may not work.');
      // Continue anyway - local auth should still work
    }
    
    const jellyfinApi = new JellyfinAPI(jellyfinConfig.jellyfinUrl, jellyfinConfig.apiKey);

    let jellyfinUser = null;
    try {
      const users = await jellyfinApi.getUsers();
      jellyfinUser = users.find(u => u.Name.toLowerCase() === username.toLowerCase());
    } catch (err) {
      logger.error('Error fetching Jellyfin users:', err);
      // Don't fail - the user authenticated via OIDC, we'll try to sync later
    }

    // Auto-create user if enabled and user doesn't exist
    let userWasCreated = false;
    if (!jellyfinUser && oidcConfig.autoCreateUsers && jellyfinConfig.apiKey) {
      try {
        jellyfinUser = await jellyfinApi.createUser(username);
        userWasCreated = true;
        logger.info(`Created new Jellyfin user via SSO: ${username}`);

        // Newly created users never had a real password — randomize immediately so
        // they can only ever log in through SSO.
        const randomPassword = crypto.randomBytes(32).toString('hex') + crypto.randomBytes(32).toString('base64');
        await jellyfinApi.resetUserPassword(jellyfinUser.Id, randomPassword);
        await jellyfinApi.updateUserConfiguration(jellyfinUser.Id, {
          EnableLocalPassword: false,
          AuthenticationProviderId: 'SSO'
        });
        logger.info(`🔒 New SSO user locked to SSO-only login: ${username}`);
      } catch (err) {
        logger.error('Error creating Jellyfin user:', err);
        logger.info(`Continuing with OIDC session for user ${username} without Jellyfin user creation`);
      }
    }

    // SECURITY: For pre-existing Jellyfin users logging in via SSO for the first time,
    // disable local password auth without destroying their existing password.
    // We track which users have been locked in the DB to avoid repeat calls on every login.
    if (jellyfinUser && !userWasCreated && jellyfinConfig.apiKey) {
      try {
        const lockedRaw = await DatabaseManager.getSetting('sso_locked_users');
        const lockedUsers = Array.isArray(lockedRaw) ? lockedRaw : [];

        if (!lockedUsers.includes(jellyfinUser.Id)) {
          await jellyfinApi.updateUserConfiguration(jellyfinUser.Id, {
            EnableLocalPassword: false,
            AuthenticationProviderId: 'SSO'
          });
          lockedUsers.push(jellyfinUser.Id);
          await DatabaseManager.setSetting('sso_locked_users', lockedUsers, 'json');
          logger.info(`🔒 Existing SSO user configured for SSO-only login (first time): ${username}`);
        }
      } catch (configErr) {
        logger.warn(`⚠️  Could not configure SSO-only login for ${username}:`, configErr.message);
        // Not critical — continue with login
      }
    }

    // If user doesn't exist in Jellyfin and auto-create is disabled, continue anyway
    // The user is authenticated via OIDC
    if (!jellyfinUser) {
      logger.info(`User '${username}' not found in Jellyfin. Auto-creation is ${oidcConfig.autoCreateUsers ? 'enabled' : 'disabled'}. Continuing with OIDC authentication.`);
    }

    // Extract groups from OIDC claims first (regardless of Jellyfin availability)
    let userGroups = [];
    
    // First, try to get groups from userinfo/JWT claims (standard locations)
    if (userInfoPayload.groups && Array.isArray(userInfoPayload.groups)) {
      userGroups = userInfoPayload.groups;
    } else if (userInfoPayload.roles && Array.isArray(userInfoPayload.roles)) {
      userGroups = userInfoPayload.roles;
    } else if (userInfoPayload.group && typeof userInfoPayload.group === 'string') {
      userGroups = [userInfoPayload.group];
    } else if (userInfoPayload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/groups']) {
      // Some IdPs use SAML-style claim names
      const groups = userInfoPayload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/groups'];
      userGroups = Array.isArray(groups) ? groups : [groups];
    } else {
      // Log what we're getting from the payload for debugging
    }
    
    const adminGroupMapping = oidcConfig.adminGroupMapping || oidcConfig.adminGroup || [];
    const adminGroups = Array.isArray(adminGroupMapping) ? adminGroupMapping : [adminGroupMapping];
    
    
    // Check if user is in admin group
    const isAdminFromGroups = adminGroups && adminGroups.length > 0 && 
      adminGroups.some(adminGroup => 
        userGroups.some(userGroup => 
          String(userGroup).toLowerCase() === String(adminGroup).toLowerCase()
        )
      );
    

    // Apply group/role mapping to Jellyfin if user exists and API key is available
    if (jellyfinUser && jellyfinConfig.apiKey) {
      try {
        // Get current user policy
        const currentUser = await jellyfinApi.getUser(jellyfinUser.Id);
        const currentPolicy = currentUser?.Policy || {};
        
        // Update policy if admin status needs to change
        const needsUpdate = isAdminFromGroups !== currentPolicy.IsAdministrator;
        logger.info(`Current admin status: ${currentPolicy.IsAdministrator}, needs update: ${needsUpdate}`);
        
        if (needsUpdate) {
          const updateResult = await jellyfinApi.updateUserPolicy(jellyfinUser.Id, { IsAdministrator: isAdminFromGroups });
          logger.info(`Policy update result:`, updateResult);
          if (isAdminFromGroups) {
            logger.info(`User ${username} granted admin privileges via group mapping: ${adminGroups.join(', ')}`);
          } else {
            logger.info(`User ${username} admin privileges revoked (not in admin groups: ${adminGroups.join(', ')})`);
          }
        }
        
        // Refresh user data to get updated policy
        jellyfinUser = await jellyfinApi.getUser(jellyfinUser.Id);
        
        await AuditLogger.log({
          action: 'OIDC_GROUP_MAPPING',
          userId: jellyfinUser.Id,
          resource: `user:${username}`,
          details: { 
            isAdmin: isAdminFromGroups, 
            groups: userGroups,
            adminGroups: adminGroups,
            updated: needsUpdate,
            finalAdminStatus: jellyfinUser.Policy?.IsAdministrator
          },
          status: 'success',
          ip: req.ip
        });
      } catch (err) {
        logger.error(`Error applying group mapping to user ${username}:`, err);
        // Don't fail the login, just log the error
      }
    } else {
      logger.info(`Skipping Jellyfin user update: jellyfinUser=${!!jellyfinUser}, apiKey=${!!jellyfinConfig.apiKey}`);
    }

    // Set session with user info
    // If jellyfinUser is not available, create a minimal session object from OIDC claims
    let sessionUser = jellyfinUser;
    if (!sessionUser) {
      logger.info(`Creating minimal session user from OIDC claims for ${username} (admin: ${isAdminFromGroups})`);
      sessionUser = {
        Name: username,
        Id: `oidc_${username}`,
        serverId: 'oidc',
        Policy: {
          IsAdministrator: isAdminFromGroups,
          IsDisabled: false
        }
      };
    }

    req.session.user = sessionUser;
    req.session.accessToken = jellyfinConfig.apiKey || null;
    req.session.authMethod = 'oidc';
    req.session.oidcClaims = userInfoPayload;

    // Sync admin status from Jellyfin to database
    if (jellyfinUser && jellyfinUser.Id) {
      const PolicyManager = require('../models/PolicyManager');
      await PolicyManager.syncAdminStatusFromJellyfin(jellyfinUser.Id, jellyfinUser).catch(err => 
        logger.warn('Could not sync admin status:', err.message)
      );
    }

    await AuditLogger.log({
      action: 'OIDC_LOGIN_SUCCESS',
      userId: sessionUser.Id,
      resource: `user:${username}`,
      details: { 
        provider: oidcConfig.providerName,
        fromJellyfin: !!jellyfinUser
      },
      status: 'success',
      ip: req.ip
    });

    res.redirect('/');
  } catch (error) {
    logger.error('OIDC callback error:', error);
    await AuditLogger.log({
      action: 'OIDC_CALLBACK_ERROR',
      userId: 'anonymous',
      resource: 'oidc:callback',
      details: { error: error.message },
      status: 'failure',
      ip: req.ip
    });
    res.redirect('/login?error=oidc_callback_failed');
  }
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
router.post('/forgot-password', criticalLimiter, async (req, res) => {
  try {
    const { username } = req.body;
    const { publicLimiter } = require('../middleware/rate-limit');

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    let jellyfin;
    try {
      jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
    } catch (err) {
      logger.error('Failed to initialize Jellyfin API:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Service temporarily unavailable'
      });
    }

    let users;
    try {
      users = await jellyfin.getUsers();
    } catch (err) {
      logger.error('Failed to fetch users from Jellyfin:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Service temporarily unavailable'
      });
    }

    const user = users.find(u => u.Name.toLowerCase() === username.toLowerCase());

    if (!user) {
      await AuditLogger.log('FORGOT_PASSWORD_NOT_FOUND', 'unknown', 'auth:forgot-password',
        { username }, 'failure', req.ip);
      return res.json({
        success: true,
        message: 'If that account exists, you will receive a password reset email.'
      });
    }

    // Get user profile with email
    const UserProfileManager = require('../models/UserProfileManager');
    const profile = await UserProfileManager.getProfile(user.Id).catch(() => null);

    if (!profile || !profile.email) {
      await AuditLogger.log('FORGOT_PASSWORD_NO_EMAIL', user.Id, 'auth:forgot-password',
        { username: user.Name }, 'failure', req.ip);
      return res.json({
        success: true,
        message: 'If that account exists, you will receive a password reset email.'
      });
    }

    // Generate reset token
    const PasswordResetManager = require('../models/PasswordResetManager');
    const resetManager = PasswordResetManager.getInstance();
    const token = await resetManager.generateResetToken(user.Id, profile.email);

    // Build reset link
    const baseUrl = SetupManager.getConfig().appUrl || `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/auth/reset-password?token=${token}`;

    // Send email
    try {
      await resetManager.sendResetEmail(user.Id, profile.email, resetLink);
    } catch (err) {
      logger.error('Failed to send reset email:', err.message);
    }

    await AuditLogger.log('FORGOT_PASSWORD_REQUESTED', user.Id, 'auth:forgot-password',
      { email: profile.email }, 'success', req.ip);

    res.json({
      success: true,
      message: 'If that account exists, you will receive a password reset email.'
    });
  } catch (err) {
    logger.error('Forgot password error:', err.message);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred'
    });
  }
});

/**
 * GET /api/auth/reset-password/validate
 * Validate a password reset token
 */
router.get('/reset-password/validate', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ valid: false, message: 'Token is required' });
    }

    const PasswordResetManager = require('../models/PasswordResetManager');
    const resetManager = PasswordResetManager.getInstance();
    const tokenData = await resetManager.validateToken(token);

    if (!tokenData) {
      return res.json({ valid: false, message: 'Token is invalid or has expired' });
    }

    res.json({
      valid: true,
      message: 'Token is valid'
    });
  } catch (err) {
    logger.error('Token validation error:', err.message);
    res.status(500).json({ valid: false, message: 'Validation error' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password using token
 */
router.post('/reset-password', criticalLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required'
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const PasswordResetManager = require('../models/PasswordResetManager');
    const resetManager = PasswordResetManager.getInstance();
    const tokenData = await resetManager.validateToken(token);

    if (!tokenData) {
      await AuditLogger.log('PASSWORD_RESET_INVALID_TOKEN', 'unknown', 'auth:reset-password',
        {}, 'failure', req.ip);
      return res.status(400).json({
        success: false,
        message: 'Token is invalid or has expired'
      });
    }

    // Update password in Jellyfin
    try {
      const adminApi = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, SetupManager.getConfig().apiKey);
      await adminApi.resetUserPassword(tokenData.user_id, newPassword);
    } catch (err) {
      logger.error('Failed to update password in Jellyfin:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to update password. Please try again later.'
      });
    }

    // Mark token as used
    await resetManager.markTokenAsUsed(token);

    await AuditLogger.log('PASSWORD_RESET_SUCCESS', tokenData.user_id, 'auth:reset-password',
      {}, 'success', req.ip);

    res.json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.'
    });
  } catch (err) {
    logger.error('Password reset error:', err.message);
    res.status(500).json({
      success: false,
      message: 'An unexpected error occurred'
    });
  }
});

// ============================================================================
// SELF-SERVICE SIGNUP VIA INVITE CODE
// ============================================================================

// GET /api/auth/password-policy — return the server's password requirements (public)
router.get('/password-policy', async (req, res) => {
  try {
    const [minLen, upper, nums, special] = await Promise.all([
      DatabaseManager.getSetting('password_min_length'),
      DatabaseManager.getSetting('password_require_uppercase'),
      DatabaseManager.getSetting('password_require_numbers'),
      DatabaseManager.getSetting('password_require_special')
    ]);
    res.json({
      minLength:        parseInt(minLen) || 8,
      requireUppercase: upper   === 'true',
      requireNumbers:   nums    === 'true',
      requireSpecial:   special === 'true'
    });
  } catch (_) {
    res.json({ minLength: 8, requireUppercase: false, requireNumbers: false, requireSpecial: false });
  }
});

// POST /api/auth/signup/verify-contact
// Initiates a contact method verification for a pre-signup user.
// Returns a verificationId; the user must then confirm with the code they receive via the bot.
router.post('/signup/verify-contact', criticalLimiter, async (req, res) => {
  try {
    const { method, contactId } = req.body;
    const validMethods = ['discord', 'telegram', 'matrix'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid contact method. Use discord, telegram, or matrix.' });
    }
    if (!contactId || typeof contactId !== 'string' || contactId.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Contact ID is required' });
    }

    const ContactMethodManager = require('../models/ContactMethodManager');
    const SIGNUP_VERIFY_USER = '__signup__';
    const verification = await ContactMethodManager.getInstance()
      .createVerificationRequest(SIGNUP_VERIFY_USER, method, contactId.trim());

    // Store the verificationId in session so only the same session can confirm it
    if (!req.session.signupPendingVerifications) req.session.signupPendingVerifications = {};
    req.session.signupPendingVerifications[verification.id] = { method, contactId: contactId.trim() };

    res.json({
      success: true,
      verificationId: verification.id,
      message: `A verification code has been sent to your ${method} account. Enter it below.`
    });
  } catch (err) {
    logger.error('Signup verify-contact error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to initiate verification' });
  }
});

// POST /api/auth/signup/confirm-contact
// Validates the verification code and stores verified status in session.
router.post('/signup/confirm-contact', criticalLimiter, async (req, res) => {
  try {
    const { verificationId, code } = req.body;
    if (!verificationId || !code) {
      return res.status(400).json({ success: false, error: 'verificationId and code are required' });
    }

    // Ensure this verification was initiated by this session
    const pending = req.session.signupPendingVerifications || {};
    if (!pending[verificationId]) {
      return res.status(400).json({ success: false, error: 'Verification not found or expired' });
    }

    const ContactMethodManager = require('../models/ContactMethodManager');
    await ContactMethodManager.getInstance().verifyWithCode(verificationId, String(code).trim());

    // Mark as verified in session
    req.session.signupContactVerified = verificationId;
    delete req.session.signupPendingVerifications[verificationId];

    res.json({ success: true, message: 'Contact method verified successfully' });
  } catch (err) {
    logger.error('Signup confirm-contact error:', err.message);
    res.status(400).json({ success: false, error: err.message || 'Verification failed' });
  }
});

// POST /api/auth/signup — create Jellyfin account via invite
// Public endpoint; protected by invite code validation + optional CAPTCHA + rate limit.
// No CSRF required (CSRF middleware exempts this path in server.js).
router.post('/signup', criticalLimiter, async (req, res) => {
  try {
    const { username, email, password, inviteCode, captchaToken } = req.body;

    // Basic validation
    if (!username || !password || !inviteCode) {
      return res.status(400).json({ success: false, error: 'Username, password, and invite code are required' });
    }

    const cleanUsername = String(username).trim();
    if (!/^[a-zA-Z0-9_.\- ]+$/.test(cleanUsername) || cleanUsername.length < 2 || cleanUsername.length > 50) {
      return res.status(400).json({ success: false, error: 'Invalid username. Use 2–50 characters: letters, numbers, spaces, hyphens, underscores, or dots.' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Enforce configurable password policy
    const [policyMinLen, policyUpper, policyNums, policySpecial] = await Promise.all([
      DatabaseManager.getSetting('password_min_length'),
      DatabaseManager.getSetting('password_require_uppercase'),
      DatabaseManager.getSetting('password_require_numbers'),
      DatabaseManager.getSetting('password_require_special')
    ]);
    const minLen = Math.max(8, parseInt(policyMinLen) || 8);
    if (String(password).length < minLen) {
      return res.status(400).json({ success: false, error: `Password must be at least ${minLen} characters` });
    }
    if (policyUpper === 'true' && !/[A-Z]/.test(password)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one uppercase letter' });
    }
    if (policyNums === 'true' && !/[0-9]/.test(password)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one number' });
    }
    if (policySpecial === 'true' && !/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one special character' });
    }

    // CAPTCHA verification (if enabled)
    const captchaEnabled = await DatabaseManager.getSetting('captcha_enabled');
    if (captchaEnabled === 'true') {
      if (!captchaToken) {
        return res.status(400).json({ success: false, error: 'CAPTCHA verification required' });
      }
      const provider = (await DatabaseManager.getSetting('captcha_provider')) || 'hcaptcha';
      const secretKey = await DatabaseManager.getSetting('captcha_secret_key');
      if (!secretKey) {
        logger.error('CAPTCHA enabled but secret key not configured');
        return res.status(500).json({ success: false, error: 'CAPTCHA is not configured on the server' });
      }
      const verifyUrl = provider === 'recaptcha'
        ? 'https://www.google.com/recaptcha/api/siteverify'
        : 'https://api.hcaptcha.com/siteverify';
      const params = new URLSearchParams();
      params.append('secret', secretKey);
      params.append('response', String(captchaToken));
      params.append('remoteip', req.ip);
      try {
        const captchaRes = await axios.post(verifyUrl, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000
        });
        if (!captchaRes.data?.success) {
          logger.warn('CAPTCHA verification failed on signup', { ip: req.ip, provider, codes: captchaRes.data?.['error-codes'] });
          return res.status(400).json({ success: false, error: 'CAPTCHA verification failed. Please try again.' });
        }
      } catch (captchaErr) {
        logger.error('CAPTCHA API request failed', { error: captchaErr.message });
        return res.status(502).json({ success: false, error: 'CAPTCHA service unavailable. Please try again.' });
      }
    }

    // Validate invite code
    const InviteManager = require('../models/InviteManager');
    let invite;
    try {
      invite = await InviteManager.getInstance().validateInvite(String(inviteCode).trim());
    } catch (inviteErr) {
      return res.status(400).json({ success: false, error: inviteErr.message });
    }

    // If the signup profile requires contact verification, enforce it
    if (invite.signupProfileId) {
      const SignupProfileManager = require('../models/SignupProfileManager');
      const profile = await SignupProfileManager.getInstance().getProfile(invite.signupProfileId);
      if (profile && profile.requireContactVerification) {
        const verifiedId = req.session.signupContactVerified;
        if (!verifiedId) {
          return res.status(400).json({ success: false, error: 'This invite requires contact method verification before signup. Please verify your Discord, Telegram, or Matrix account first.' });
        }
        // Clear verified flag so it can't be reused
        delete req.session.signupContactVerified;
      }
    }

    // Create Jellyfin user with admin API key (no user session available)
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    // Check username uniqueness
    const existingUsers = await jellyfin.getUsers();
    if (existingUsers.some(u => u.Name.toLowerCase() === cleanUsername.toLowerCase())) {
      return res.status(409).json({ success: false, error: 'That username is already taken' });
    }

    // Create user with the password chosen by the registrant
    const newUser = await jellyfin.createUser({ Name: cleanUsername, Password: String(password) });

    // Sync the new user to Jellyseerr (if enabled) — fire-and-forget
    const JellyseerrManager = require('../models/JellyseerrManager');
    JellyseerrManager.getInstance().syncUser(newUser.Id).catch(e =>
      logger.warn('Jellyseerr sync failed on signup:', e.message)
    );
    // Sync the new user to Ombi (if enabled) — fire-and-forget: import + profile
    const OmbiManager = require('../models/OmbiManager');
    const ombi = OmbiManager.getInstance();
    ombi.syncUser(newUser.Id)
      .then(() => ombi.syncUserProfile(newUser.Id))
      .catch(e => logger.warn('Ombi sync failed on signup:', e.message));

    await AuditLogger.log({
      action: 'USER_SIGNUP',
      userId: newUser.Id,
      resource: cleanUsername,
      details: { inviteCode: String(inviteCode).substring(0, 8) + '...', email: email || null },
      status: 'success',
      ip: req.ip
    });

    res.json({ success: true, user: { id: newUser.Id, name: newUser.Name } });
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ success: false, error: 'Failed to create account' });
  }
});

module.exports = router;