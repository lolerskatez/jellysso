const express = require('express');
const router = express.Router();
const axios = require('axios');
const SetupManager = require('../models/SetupManager');
const JellyfinAPI = require('../models/JellyfinAPI');
const AuditLogger = require('../models/AuditLogger');
const TokenManager = require('../models/TokenManager');
const { csrfProtection } = require('../middleware/csrf');
const jwt = require('jsonwebtoken');
const { getBaseUrl } = require('../utils/urlHelper');

const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);

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

// Login route - CSRF validated by global middleware
router.post('/login', requireSetupComplete, async (req, res) => {
  console.log('Login request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Login request body:', JSON.stringify(req.body, null, 2));
  const { username, password } = req.body;
  if (!username || !password) {
    await AuditLogger.log('LOGIN_ATTEMPT', 'unknown', `user:${username || 'unknown'}`, 
      { reason: 'Missing credentials' }, 'failure', req.ip);
    
    // Check if this is an AJAX request
    const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
    
    if (isAjax) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    } else {
      req.session.errorMessage = 'Username and password required';
      return res.redirect('/login');
    }
  }
  
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    const authResult = await jellyfin.authenticateByName(username, password);
    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        AuditLogger.log('LOGIN_SESSION_ERROR', authResult.User?.Id, `user:${username}`, 
          { error: 'Session save failed' }, 'failure', req.ip);
        return res.status(500).json({ success: false, message: 'Session save failed' });
      }
      // Log successful login
      AuditLogger.logSuccessfulLogin(authResult.User?.Id, req.ip);
      
      // Check if this is an AJAX request
      const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
      
      if (isAjax) {
        res.json({ success: true, user: authResult.User });
      } else {
        // Normal form submission - redirect to quickconnect
        res.redirect('/quickconnect');
      }
    });
  } catch (error) {
    console.error('Login error:', error.message);
    let reason = 'Authentication failed';
    let statusCode = 500;
    let message = 'Login failed. Please try again.';
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      reason = 'Invalid credentials';
      statusCode = 401;
      message = 'Invalid username or password';
      await AuditLogger.logFailedLogin(username, reason, req.ip);
    } else if (error.message.includes('403')) {
      reason = 'Account disabled';
      statusCode = 403;
      message = 'Account disabled or access forbidden';
      await AuditLogger.logFailedLogin(username, reason, req.ip);
    } else if (error.message.includes('503')) {
      reason = 'Server unavailable';
      statusCode = 503;
      message = 'Server temporarily unavailable';
      await AuditLogger.logFailedLogin(username, reason, req.ip);
    } else {
      await AuditLogger.logFailedLogin(username, error.message, req.ip);
    }
    
    // Check if this is an AJAX request
    const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
    
    if (isAjax) {
      res.status(statusCode).json({ success: false, message });
    } else {
      // Normal form submission - redirect back to login with error
      req.session.errorMessage = message;
      res.redirect('/login');
    }
  }
});

// Logout route - CSRF validated by global middleware
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
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
  
  // Check API key (must match the apiKey configured in setup)
  const expectedKey = process.env.SHARED_SECRET || 'default-shared-secret';
  if (apiKey !== expectedKey) {
    return res.status(401).json({ valid: false, error: 'Invalid API key' });
  }
  
  if (!token) {
    return res.status(400).json({ valid: false, error: 'No token provided' });
  }
  
  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-jwt-secret');
    
    // Check if token is not expired and contains valid user info
    if (decoded && decoded.userId && decoded.exp > Date.now() / 1000) {
      res.json({ valid: true, userId: decoded.userId });
    } else {
      res.status(401).json({ valid: false, error: 'Token expired or invalid' });
    }
  } catch (error) {
    console.error('Token validation error:', error);
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
    console.error('Token refresh error:', error.message);
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
const DatabaseManager = require('../models/DatabaseManager');

// Get OIDC config helper
async function getOidcConfig() {
  let config = await DatabaseManager.getSetting('oidc_config');
  // Handle legacy double-encoded JSON
  if (typeof config === 'string') {
    config = JSON.parse(config);
  }
  return config || null;
}

// OIDC Login - initiates the OIDC flow
router.get('/oidc/login', async (req, res) => {
  try {
    const oidcConfig = await getOidcConfig();
    
    if (!oidcConfig || !oidcConfig.enabled) {
      return res.status(400).send('OIDC SSO is not enabled');
    }

    // Fetch discovery document
    let discoveryUrl = oidcConfig.issuerUrl;
    if (!discoveryUrl.includes('.well-known')) {
      discoveryUrl = discoveryUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
    }

    const discoveryResponse = await axios.get(discoveryUrl);
    const discovery = discoveryResponse.data;

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
    console.error('OIDC login error:', error);
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
      console.error('OIDC IdP error:', error, error_description);
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
    console.log(`OIDC Config loaded:`, {
      enabled: oidcConfig?.enabled,
      adminGroup: oidcConfig?.adminGroup,
      adminGroupMapping: oidcConfig?.adminGroupMapping,
      all_keys: oidcConfig ? Object.keys(oidcConfig) : []
    });
    
    if (!oidcConfig || !oidcConfig.enabled) {
      return res.redirect('/login?error=oidc_disabled');
    }

    // Fetch discovery document
    let discoveryUrl = oidcConfig.issuerUrl;
    if (!discoveryUrl.includes('.well-known')) {
      discoveryUrl = discoveryUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
    }
    const discoveryResponse = await axios.get(discoveryUrl);
    const discovery = discoveryResponse.data;

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
        console.log(`UserInfo endpoint returned:`, Object.keys(userinfoResponse.data));
      }
    } catch (err) {
      console.warn(`Failed to fetch userinfo endpoint: ${err.message}. Will use ID token claims only.`);
    }

    // Clean up session state
    delete req.session.oidcState;
    delete req.session.oidcNonce;

    // Try to find or create user in Jellyfin
    const jellyfinConfig = SetupManager.getConfig();
    
    // Verify API key is configured
    if (!jellyfinConfig.apiKey) {
      console.warn('Warning: Jellyfin API key is not configured. User auto-creation and group mapping may not work.');
      // Continue anyway - local auth should still work
    }
    
    const jellyfinApi = new JellyfinAPI(jellyfinConfig.jellyfinUrl, jellyfinConfig.apiKey);

    let jellyfinUser = null;
    try {
      const users = await jellyfinApi.getUsers();
      jellyfinUser = users.find(u => u.Name.toLowerCase() === username.toLowerCase());
    } catch (err) {
      console.error('Error fetching Jellyfin users:', err);
      // Don't fail - the user authenticated via OIDC, we'll try to sync later
    }

    // Auto-create user if enabled and user doesn't exist
    if (!jellyfinUser && oidcConfig.autoCreateUsers && jellyfinConfig.apiKey) {
      try {
        jellyfinUser = await jellyfinApi.createUser(username);
        console.log(`Created new Jellyfin user via SSO: ${username}`);
      } catch (err) {
        console.error('Error creating Jellyfin user:', err);
        // Don't fail - OIDC authentication succeeded, just continue without the Jellyfin user
        console.log(`Continuing with OIDC session for user ${username} without Jellyfin user creation`);
      }
    }

    // If user doesn't exist in Jellyfin and auto-create is disabled, continue anyway
    // The user is authenticated via OIDC
    if (!jellyfinUser) {
      console.log(`User '${username}' not found in Jellyfin. Auto-creation is ${oidcConfig.autoCreateUsers ? 'enabled' : 'disabled'}. Continuing with OIDC authentication.`);
    }

    // Extract groups from OIDC claims first (regardless of Jellyfin availability)
    let userGroups = [];
    
    // First, try to get groups from userinfo/JWT claims (standard locations)
    if (userInfoPayload.groups && Array.isArray(userInfoPayload.groups)) {
      userGroups = userInfoPayload.groups;
      console.log(`Groups extracted from userinfo/JWT 'groups' claim: ${userGroups.join(', ')}`);
    } else if (userInfoPayload.roles && Array.isArray(userInfoPayload.roles)) {
      userGroups = userInfoPayload.roles;
      console.log(`Groups extracted from userinfo/JWT 'roles' claim: ${userGroups.join(', ')}`);
    } else if (userInfoPayload.group && typeof userInfoPayload.group === 'string') {
      userGroups = [userInfoPayload.group];
      console.log(`Groups extracted from userinfo/JWT 'group' claim: ${userGroups.join(', ')}`);
    } else if (userInfoPayload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/groups']) {
      // Some IdPs use SAML-style claim names
      const groups = userInfoPayload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/groups'];
      userGroups = Array.isArray(groups) ? groups : [groups];
      console.log(`Groups extracted from SAML-style claim: ${userGroups.join(', ')}`);
    } else {
      // Log what we're getting from the payload for debugging
      console.log(`No standard groups claim found. Available claims: ${Object.keys(userInfoPayload).join(', ')}`);
    }
    
    const adminGroupMapping = oidcConfig.adminGroupMapping || oidcConfig.adminGroup || [];
    const adminGroups = Array.isArray(adminGroupMapping) ? adminGroupMapping : [adminGroupMapping];
    
    console.log(`Admin group configuration: ${JSON.stringify(adminGroups)}`);
    console.log(`User groups extracted: ${JSON.stringify(userGroups)}`);
    
    // Check if user is in admin group
    const isAdminFromGroups = adminGroups && adminGroups.length > 0 && 
      adminGroups.some(adminGroup => 
        userGroups.some(userGroup => 
          String(userGroup).toLowerCase() === String(adminGroup).toLowerCase()
        )
      );
    
    console.log(`Admin check result from OIDC groups: isAdmin=${isAdminFromGroups}`);

    // Apply group/role mapping to Jellyfin if user exists and API key is available
    if (jellyfinUser && jellyfinConfig.apiKey) {
      try {
        // Get current user policy
        const currentUser = await jellyfinApi.getUser(jellyfinUser.Id);
        const currentPolicy = currentUser?.Policy || {};
        
        // Update policy if admin status needs to change
        const needsUpdate = isAdminFromGroups !== currentPolicy.IsAdministrator;
        console.log(`Current admin status: ${currentPolicy.IsAdministrator}, needs update: ${needsUpdate}`);
        
        if (needsUpdate) {
          const updateResult = await jellyfinApi.updateUserPolicy(jellyfinUser.Id, { IsAdministrator: isAdminFromGroups });
          console.log(`Policy update result:`, updateResult);
          if (isAdminFromGroups) {
            console.log(`User ${username} granted admin privileges via group mapping: ${adminGroups.join(', ')}`);
          } else {
            console.log(`User ${username} admin privileges revoked (not in admin groups: ${adminGroups.join(', ')})`);
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
        console.error(`Error applying group mapping to user ${username}:`, err);
        // Don't fail the login, just log the error
      }
    } else {
      console.log(`Skipping Jellyfin user update: jellyfinUser=${!!jellyfinUser}, apiKey=${!!jellyfinConfig.apiKey}`);
    }

    // Set session with user info
    // If jellyfinUser is not available, create a minimal session object from OIDC claims
    let sessionUser = jellyfinUser;
    if (!sessionUser) {
      console.log(`Creating minimal session user from OIDC claims for ${username} (admin: ${isAdminFromGroups})`);
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
    console.error('OIDC callback error:', error);
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

module.exports = router;