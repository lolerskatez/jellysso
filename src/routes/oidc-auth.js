const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const PolicyManager = require('../models/PolicyManager');
const AuditLogger = require('../models/AuditLogger');
const logger = require('../utils/logger');

function getPublicBase() {
  const raw = process.env.PUBLIC_URL ||
    (() => { try { return SetupManager.getConfig().webAppPublicUrl; } catch (_) { return ''; } })() ||
    `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/$/, '');
}

// OIDC login initiation
router.get('/login', (req, res) => {
  const base = getPublicBase();
  const callbackUri = encodeURIComponent(`${base}/oidc-auth/callback`);
  res.redirect(`/oidc/auth?client_id=jellyfin-companion&response_type=code&scope=openid%20profile&redirect_uri=${callbackUri}`);
});

// OIDC callback — exchanges the auth code for an id_token, then establishes
// a JellySSO session without requiring the user's real Jellyfin password.
//
// Strategy: set a strong random temporary password on the Jellyfin account
// via admin API, authenticate with it to obtain a user-scoped access token,
// then immediately rotate to a new random password so the temp pw is unusable.
router.get('/callback', async (req, res) => {
  const { code, error: oidcError } = req.query;

  if (oidcError) {
    logger.warn('OIDC callback received error', { error: oidcError });
    return res.redirect('/login?error=oidc_denied');
  }

  if (!code) {
    return res.redirect('/login?error=oidc_no_code');
  }

  try {
    const base = getPublicBase();
    const callbackUri = `${base}/oidc-auth/callback`;
    const clientSecret = process.env.OIDC_CLIENT_SECRET || 'companion-secret';

    // Exchange authorisation code for tokens via local OIDC provider
    const tokenResponse = await fetch(`${base}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUri,
        client_id: 'jellyfin-companion',
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      logger.error('OIDC token exchange failed', { status: tokenResponse.status, body });
      return res.redirect('/login?error=oidc_token_exchange');
    }

    const tokens = await tokenResponse.json();
    if (!tokens.id_token) {
      logger.error('OIDC token response missing id_token');
      return res.redirect('/login?error=oidc_no_id_token');
    }

    // Decode without signature verification — the payload was issued by our own
    // provider and we trust the server-to-server code exchange above.
    const decoded = jwt.decode(tokens.id_token);
    if (!decoded || !decoded.sub) {
      logger.error('OIDC id_token missing sub claim');
      return res.redirect('/login?error=oidc_invalid_token');
    }

    const config = SetupManager.getConfig();
    // Admin-authorised client — can set passwords for any user
    const adminJellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    // Resolve the Jellyfin user from the OIDC sub claim (Jellyfin user ID)
    const users = await adminJellyfin.getUsers();
    let jellyfinUser = users.find(u => u.Id === decoded.sub);
    if (!jellyfinUser && decoded.preferred_username) {
      jellyfinUser = users.find(u => u.Name === decoded.preferred_username);
    }

    if (!jellyfinUser) {
      logger.warn('OIDC callback: no matching Jellyfin user', { sub: decoded.sub });
      return res.redirect('/login?error=oidc_user_not_found');
    }

    // Check JellySSO-level account access before establishing a session
    const access = await PolicyManager.checkAccountAccess(jellyfinUser.Id);
    if (!access.allowed) {
      await AuditLogger.log({
        action: 'OIDC_LOGIN_DENIED',
        userId: jellyfinUser.Id,
        resource: 'oidc-auth',
        details: { reason: access.reason },
        status: 'failure',
        ip: req.ip
      });
      return res.redirect('/login?error=account_disabled');
    }

    // Generate a cryptographically strong temporary password
    const tempPassword = crypto.randomBytes(24).toString('base64url');

    // Set temp password via admin API, authenticate, then immediately rotate
    await adminJellyfin.resetUserPassword(jellyfinUser.Id, tempPassword);

    let authResult;
    try {
      const userJellyfin = new JellyfinAPI(config.jellyfinUrl);
      authResult = await userJellyfin.authenticateByName(jellyfinUser.Name, tempPassword);
    } finally {
      // Always rotate to a new random password so the temp one is single-use
      const rotatedPassword = crypto.randomBytes(24).toString('base64url');
      await adminJellyfin.resetUserPassword(jellyfinUser.Id, rotatedPassword).catch(err => {
        logger.error('OIDC: failed to rotate user password after auth', { error: err.message });
      });
    }

    // Rotate session ID to prevent session fixation
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => err ? reject(err) : resolve())
    );

    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    req.session.lastActivity = Date.now();

    await AuditLogger.log({
      action: 'OIDC_LOGIN_SUCCESS',
      userId: jellyfinUser.Id,
      resource: 'oidc-auth',
      details: { username: jellyfinUser.Name },
      status: 'success',
      ip: req.ip
    });

    res.redirect('/');
  } catch (error) {
    logger.error('OIDC callback error', { message: error.message });
    res.redirect('/login?error=oidc_internal');
  }
});

module.exports = router;


function getPublicBase() {
  const raw = process.env.PUBLIC_URL ||
    (() => { try { return SetupManager.getConfig().webAppPublicUrl; } catch (_) { return ''; } })() ||
    `http://localhost:${process.env.PORT || 3000}`;
  return raw.replace(/\/$/, '');
}

// OIDC login initiation
router.get('/login', (req, res) => {
  const base = getPublicBase();
  const callbackUri = encodeURIComponent(`${base}/oidc-auth/callback`);
  res.redirect(`/oidc/auth?client_id=jellyfin-companion&response_type=code&scope=openid%20profile&redirect_uri=${callbackUri}`);
});

// OIDC callback — exchanges the auth code for an id_token, then establishes
// a JellySSO session without requiring the user's Jellyfin password.
// Strategy: use OTPManager to generate a short-lived one-time Jellyfin password
// for the OIDC-authenticated user so authenticateByName can succeed, then
// immediately rotate the password back to a fresh random value.
router.get('/callback', async (req, res) => {
  const { code, error: oidcError } = req.query;

  if (oidcError) {
    logger.warn('OIDC callback received error', { error: oidcError });
    return res.redirect('/login?error=oidc_denied');
  }

  if (!code) {
    return res.redirect('/login?error=oidc_no_code');
  }

  try {
    const base = getPublicBase();
    const callbackUri = `${base}/oidc-auth/callback`;
    const clientSecret = process.env.OIDC_CLIENT_SECRET || 'companion-secret';

    // Exchange authorisation code for tokens via local OIDC provider
    const tokenResponse = await fetch(`${base}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUri,
        client_id: 'jellyfin-companion',
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      logger.error('OIDC token exchange failed', { status: tokenResponse.status, body });
      return res.redirect('/login?error=oidc_token_exchange');
    }

    const tokens = await tokenResponse.json();
    if (!tokens.id_token) {
      logger.error('OIDC token response missing id_token');
      return res.redirect('/login?error=oidc_no_id_token');
    }

    // Decode without verification — the payload was issued by our own provider
    // and we are not relying on it for security decisions beyond user identification.
    // The real security boundary is the code exchange above (server-to-server).
    const decoded = jwt.decode(tokens.id_token);
    if (!decoded || !decoded.sub) {
      logger.error('OIDC id_token missing sub claim');
      return res.redirect('/login?error=oidc_invalid_token');
    }

    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    // Resolve the Jellyfin user from the OIDC sub claim (Jellyfin user ID)
    const users = await jellyfin.getUsers();
    let jellyfinUser = users.find(u => u.Id === decoded.sub);

    if (!jellyfinUser && decoded.preferred_username) {
      jellyfinUser = users.find(u => u.Name === decoded.preferred_username);
    }

    if (!jellyfinUser) {
      logger.warn('OIDC callback: no matching Jellyfin user', { sub: decoded.sub });
      return res.redirect('/login?error=oidc_user_not_found');
    }

    // Check JellySSO-level account access before establishing a session
    const access = await PolicyManager.checkAccountAccess(jellyfinUser.Id);
    if (!access.allowed) {
      await AuditLogger.log({
        action: 'OIDC_LOGIN_DENIED',
        userId: jellyfinUser.Id,
        resource: 'oidc-auth',
        details: { reason: access.reason },
        status: 'failure',
        ip: req.ip
      });
      return res.redirect('/login?error=account_disabled');
    }

    // Use OTPManager to generate a one-time password, authenticate with it,
    // then immediately invalidate it. This avoids storing or transmitting the
    // user's real password while still obtaining a valid Jellyfin access token.
    const otp = await OTPManager.generateOTP(jellyfinUser.Id);
    let authResult;
    try {
      authResult = await jellyfin.authenticateByName(jellyfinUser.Name, otp);
    } finally {
      // Always revoke the OTP whether auth succeeded or not
      await OTPManager.revokeOTP(jellyfinUser.Id).catch(() => {});
    }

    // Rotate session ID to prevent fixation
    await new Promise((resolve, reject) =>
      req.session.regenerate(err => err ? reject(err) : resolve())
    );

    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    req.session.lastActivity = Date.now();

    await AuditLogger.log({
      action: 'OIDC_LOGIN_SUCCESS',
      userId: jellyfinUser.Id,
      resource: 'oidc-auth',
      details: { username: jellyfinUser.Name },
      status: 'success',
      ip: req.ip
    });

    res.redirect('/');
  } catch (error) {
    logger.error('OIDC callback error', { message: error.message });
    res.redirect('/login?error=oidc_internal');
  }
});

module.exports = router;
