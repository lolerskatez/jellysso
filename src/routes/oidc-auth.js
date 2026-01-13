const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');

// OIDC login initiation
router.get('/login', (req, res) => {
  // Redirect to OIDC provider
  res.redirect('/oidc/auth?client_id=jellyfin-companion&response_type=code&scope=openid profile&redirect_uri=http://localhost:3000/auth/callback');
});

// OIDC callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No authorization code');
  }

  try {
    // Exchange code for tokens (simplified)
    // In real implementation, use oidc-provider client
    const tokenResponse = await fetch('http://localhost:3000/oidc/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://localhost:3000/auth/callback',
        client_id: 'jellyfin-companion',
        client_secret: 'companion-secret',
      }),
    });

    const tokens = await tokenResponse.json();
    
    // Decode ID token to get user info
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(tokens.id_token);
    
    // Check if user exists in Jellyfin
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl);
    let users = await jellyfin.getUsers();
    let user = users.find(u => u.Name === decoded.preferred_username);
    
    if (!user) {
      // Create new user
      const userData = {
        Name: decoded.preferred_username,
        Password: '', // OIDC users don't need password
      };
      user = await jellyfin.createUser(userData);
    }
    
    // Authenticate the user
    const authResult = await jellyfin.authenticateByName(user.Name, '');
    
    req.session.user = authResult.User;
    req.session.accessToken = authResult.AccessToken;
    
    res.redirect('/');
  } catch (error) {
    console.error('OIDC callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

module.exports = router;