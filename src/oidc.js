const { Provider } = require('oidc-provider');
const JellyfinAPI = require('./models/JellyfinAPI');
const SetupManager = require('./models/SetupManager');
const TokenManager = require('./models/TokenManager');
const AuditLogger = require('./models/AuditLogger');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');

// Scope definitions with descriptions
const SCOPES = {
  'openid': 'Required for OpenID Connect',
  'profile': 'Access to user profile information',
  'email': 'Access to user email address',
  'offline_access': 'Access to refresh tokens for offline use',
  'admin': 'Administrator-only operations',
  'api': 'Full API access'
};

const configuration = {
  cookies: {
    keys: [process.env.COOKIE_SECRET || 'some-secret-key']
  },
  clients: [
    {
      client_id: 'jellyfin-companion',
      client_secret: process.env.OIDC_CLIENT_SECRET || 'companion-secret',
      grant_types: ['authorization_code', 'refresh_token', 'client_credentials'],
      redirect_uris: [
        'http://localhost:3000/auth/callback',
        'http://localhost:3000/oidc-auth/callback'
      ],
      response_types: ['code', 'id_token', 'token'],
      scope: 'openid profile email offline_access api',
      token_endpoint_auth_method: 'client_secret_basic',
      require_auth_time: true,
      id_token_signed_response_alg: 'HS256'
    },
    // External OIDC clients (configurable)
    ...(process.env.EXTERNAL_OIDC_CLIENTS ? JSON.parse(process.env.EXTERNAL_OIDC_CLIENTS) : []),
  ],
  pkce: {
    required: () => false,
  },
  scopes: Object.keys(SCOPES),
  claims: {
    openid: ['sub'],
    profile: ['name', 'preferred_username', 'groups', 'updated_at'],
    email: ['email', 'email_verified'],
    api: ['scope', 'permissions']
  },
  ttl: {
    AccessToken: 3600, // 1 hour
    AuthorizationCode: 600, // 10 minutes
    IdToken: 3600, // 1 hour
    RefreshToken: 2592000 // 30 days
  },
  findAccount: async (ctx, sub) => {
    // Check if setup is complete
    if (!SetupManager.isSetupComplete()) {
      throw new Error('Setup not complete');
    }

    try {
      const config = SetupManager.getConfig();
      if (!config.jellyfinUrl) {
        throw new Error('Jellyfin URL not configured');
      }
      
      const jellyfin = new JellyfinAPI(config.jellyfinUrl);
      const users = await jellyfin.getUsers();
      const existingUser = users.find(u => u.Id === sub);
      
      if (existingUser) {
        return {
          accountId: sub,
          async claims(use, scope, claims) {
            // Generate tokens with TokenManager
            const accessToken = TokenManager.generateAccessToken(existingUser);
            const refreshToken = TokenManager.generateRefreshToken(existingUser.Id);

            // Build claims based on requested scopes
            const claimsData = {
              sub,
              aud: 'jellyfin-companion-app',
              iss: 'jellyfin-companion',
              updated_at: Math.floor(Date.now() / 1000)
            };

            // Profile scope
            if (scope && scope.includes('profile')) {
              claimsData.name = existingUser.Name;
              claimsData.preferred_username = existingUser.Name;
              claimsData.groups = existingUser.Policy?.IsAdministrator ? ['admin', 'users'] : ['users'];
            }

            // Email scope
            if (scope && scope.includes('email')) {
              claimsData.email = existingUser.Name + '@jellyfin.local';
              claimsData.email_verified = false;
            }

            // API scope for administrators
            if (scope && scope.includes('api') && existingUser.Policy?.IsAdministrator) {
              claimsData.scope = 'admin:read admin:write api:read api:write';
              claimsData.permissions = ['user:read', 'user:write', 'settings:read', 'settings:write', 'logs:read'];
            }

            // Offline access - include refresh token claim
            if (scope && scope.includes('offline_access')) {
              claimsData.refresh_token_claim = refreshToken;
            }

            // Log token issuance
            await AuditLogger.log({
              action: 'OIDC_TOKEN_ISSUED',
              userId: existingUser.Id,
              resource: 'OIDC',
              details: {
                scope: scope || 'openid',
                clientId: ctx?.oidc?.client?.clientId || 'unknown'
              },
              status: 'success',
              ip: ctx?.request?.ip || 'unknown'
            });

            return claimsData;
          },
        };
      } else {
        // Create new user
        const newUser = {
          Name: `oidc_${sub.slice(0, 8)}`,
          Password: crypto.randomBytes(16).toString('hex'),
        };
        
        try {
          const createdUser = await jellyfin.createUser(newUser);
          
          await AuditLogger.log({
            action: 'OIDC_USER_CREATED',
            userId: createdUser.Id,
            resource: newUser.Name,
            details: { source: 'OIDC_authentication' },
            status: 'success',
            ip: ctx?.request?.ip || 'unknown'
          });

          return {
            accountId: sub,
            async claims(use, scope, claims) {
              const accessToken = TokenManager.generateAccessToken(createdUser);
              const refreshToken = TokenManager.generateRefreshToken(createdUser.Id);

              return {
                sub,
                name: createdUser.Name,
                preferred_username: createdUser.Name,
                groups: ['users'],
                email: createdUser.Name + '@jellyfin.local',
                email_verified: false,
                updated_at: Math.floor(Date.now() / 1000),
                refresh_token_claim: scope && scope.includes('offline_access') ? refreshToken : undefined
              };
            },
          };
        } catch (createError) {
          console.error('Error creating OIDC user:', createError);
          throw new Error(`Failed to create OIDC user: ${createError.message}`);
        }
      }
    } catch (error) {
      console.error('Error in findAccount:', error);
      await AuditLogger.log({
        action: 'OIDC_AUTH_ERROR',
        userId: 'unknown',
        resource: 'OIDC',
        details: { error: error.message },
        status: 'failure',
        ip: ctx?.request?.ip || 'unknown'
      });
      
      throw error;
    }
  },
  features: {
    devInteractions: { enabled: false },
    deviceFlow: { enabled: true },
    revocation: { enabled: true },
  },
};

const oidc = new Provider('http://localhost:3000', configuration);

module.exports = oidc;