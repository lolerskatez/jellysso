/**
 * Jellyfin SSO Plugin Integration Example
 * 
 * This file demonstrates a complete integration between a companion application
 * and the Jellyfin SSO Plugin. It shows:
 * 
 * 1. Token generation after user authentication
 * 2. SSO token validation endpoint
 * 3. Health check endpoint
 * 4. Secure API key validation
 * 5. Error handling and logging
 * 
 * Copy and adapt this code to your companion application.
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ============================================================================
// Configuration
// ============================================================================

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration values (should be in environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const JELLYFIN_SHARED_SECRET = process.env.JELLYFIN_SHARED_SECRET || 'your-jellyfin-api-key';
const TOKEN_EXPIRY = '1h'; // Tokens valid for 1 hour

// ============================================================================
// Middleware
// ============================================================================

// Parse JSON bodies
app.use(express.json());

// API Key Validation Middleware
const validateJellyfinApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Missing X-API-Key header'
    });
  }
  
  if (apiKey !== JELLYFIN_SHARED_SECRET) {
    console.warn('[SSO] Invalid API key attempt from', req.ip);
    return res.status(401).json({
      error: 'Invalid API key'
    });
  }
  
  next();
};

// Rate limiting for SSO endpoint
const ssoRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many SSO validation attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Request logging middleware
const requestLogger = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
};

app.use(requestLogger);

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Generate an SSO token for authenticated user
 * @param {Object} user - User object with id, username, email, role
 * @returns {string} JWT token
 */
function generateSsoToken(user) {
  try {
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: TOKEN_EXPIRY,
        issuer: 'companion-app'
      }
    );
    
    return token;
  } catch (error) {
    console.error('[SSO] Error generating token:', error.message);
    throw error;
  }
}

/**
 * Validate an SSO token and extract user information
 * @param {string} token - JWT token to validate
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function validateSsoToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'companion-app'
    });
    
    return decoded;
  } catch (error) {
    console.warn('[SSO] Token validation failed:', error.message);
    return null;
  }
}

/**
 * Lookup user in database (replace with your actual user lookup)
 * @param {string} username - Username to lookup
 * @returns {Object|null} User object or null if not found
 */
function lookupUserByUsername(username) {
  // This is a mock implementation
  // Replace with your actual database query
  
  const mockUsers = {
    'admin': {
      id: 'user-001',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin'
    },
    'john.doe': {
      id: 'user-002',
      username: 'john.doe',
      email: 'john.doe@example.com',
      role: 'user'
    },
    'jane.smith': {
      id: 'user-003',
      username: 'jane.smith',
      email: 'jane.smith@example.com',
      role: 'admin'
    }
  };
  
  return mockUsers[username] || null;
}

/**
 * Authenticate user with username and password
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Object|null} User object if authenticated, null otherwise
 */
function authenticateUser(username, password) {
  // This is a mock implementation
  // Replace with your actual authentication logic (e.g., bcrypt password comparison)
  
  console.log(`[AUTH] Authenticating user: ${username}`);
  
  const user = lookupUserByUsername(username);
  
  if (!user) {
    console.log(`[AUTH] User not found: ${username}`);
    return null;
  }
  
  // Mock password check - NEVER do this in production!
  // Use bcrypt or similar for real password hashing
  if (password === 'demo123') {
    console.log(`[AUTH] Authentication successful: ${username}`);
    return user;
  }
  
  console.log(`[AUTH] Authentication failed: ${username}`);
  return null;
}

// ============================================================================
// Routes - Authentication
// ============================================================================

/**
 * Login endpoint - authenticate user and return SSO token
 * POST /api/auth/login
 * 
 * Request:
 * {
 *   "username": "john.doe",
 *   "password": "secret123"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "token": "eyJhbGc...",
 *   "user": {
 *     "id": "user-002",
 *     "username": "john.doe",
 *     "email": "john.doe@example.com",
 *     "role": "user"
 *   }
 * }
 */
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }
    
    // Authenticate user
    const user = authenticateUser(username, password);
    
    if (!user) {
      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }
    
    // Generate SSO token
    const token = generateSsoToken(user);
    
    console.log(`[AUTH] Login successful: ${username}, Token: ${token.substring(0, 20)}...`);
    
    // Return token and user info
    res.json({
      success: true,
      token: token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * Get current user endpoint - return user info from token
 * GET /api/auth/current
 * 
 * Headers:
 * Authorization: Bearer <token>
 * 
 * Response:
 * {
 *   "username": "john.doe",
 *   "email": "john.doe@example.com",
 *   "role": "user"
 * }
 */
app.get('/api/auth/current', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Missing or invalid authorization header'
      });
    }
    
    const token = authHeader.substring(7);
    const decoded = validateSsoToken(token);
    
    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid or expired token'
      });
    }
    
    res.json({
      username: decoded.username,
      email: decoded.email,
      role: decoded.role,
      ssoToken: token // Return token for client to use with Jellyfin
    });
    
  } catch (error) {
    console.error('[AUTH] Current user error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// ============================================================================
// Routes - Jellyfin SSO Plugin Integration
// ============================================================================

/**
 * SSO Token Validation Endpoint
 * POST /api/auth/validate-sso
 * 
 * This endpoint is called by the Jellyfin SSO Plugin to validate tokens
 * and retrieve user information for Jellyfin user creation/update.
 * 
 * Headers:
 * X-API-Key: <shared-secret-from-plugin-config>
 * Content-Type: application/json
 * 
 * Request:
 * {
 *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 * }
 * 
 * Response (Success):
 * {
 *   "username": "john.doe",
 *   "email": "john.doe@example.com",
 *   "isAdmin": false,
 *   "displayName": "John Doe"
 * }
 * 
 * Response (Error):
 * {
 *   "error": "Invalid or expired token"
 * }
 */
app.post('/api/auth/validate-sso',
  ssoRateLimiter,
  validateJellyfinApiKey,
  (req, res) => {
    try {
      const { token } = req.body;
      
      console.log('[SSO] Token validation request received');
      
      // Validate input
      if (!token) {
        console.warn('[SSO] Token validation failed: no token provided');
        return res.status(400).json({
          error: 'Token is required'
        });
      }
      
      // Validate token
      const decoded = validateSsoToken(token);
      
      if (!decoded) {
        console.warn('[SSO] Token validation failed: invalid token');
        return res.status(401).json({
          error: 'Invalid or expired token'
        });
      }
      
      // Get user details from decoded token
      const user = lookupUserByUsername(decoded.username);
      
      if (!user) {
        console.warn(`[SSO] User not found: ${decoded.username}`);
        return res.status(401).json({
          error: 'User not found'
        });
      }
      
      // Format response for Jellyfin plugin
      const response = {
        username: user.username,
        email: user.email,
        isAdmin: user.role === 'admin',
        displayName: user.username
      };
      
      console.log(`[SSO] Token validation successful: ${user.username}, Admin: ${response.isAdmin}`);
      
      res.json(response);
      
    } catch (error) {
      console.error('[SSO] Token validation error:', error);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  }
);

// ============================================================================
// Routes - Health Checks
// ============================================================================

/**
 * Health check endpoint
 * GET /api/health
 * 
 * Response:
 * {
 *   "status": "healthy"
 * }
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

/**
 * Detailed health check endpoint
 * GET /api/status
 * 
 * Response:
 * {
 *   "status": "healthy",
 *   "timestamp": "2026-01-13T00:00:00Z",
 *   "uptime": 3600,
 *   "version": "1.0.0"
 * }
 */
app.get('/api/status', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// ============================================================================
// Routes - Testing
// ============================================================================

/**
 * Test SSO validation endpoint (for development/testing)
 * This endpoint allows testing without requiring valid Jellyfin API key
 * 
 * GET /api/test/sso?username=john.doe
 */
app.get('/api/test/sso', (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({
        error: 'Username query parameter required'
      });
    }
    
    console.log(`[TEST] SSO test for user: ${username}`);
    
    const user = lookupUserByUsername(username);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }
    
    // Generate test token
    const token = generateSsoToken(user);
    
    // Validate token
    const decoded = validateSsoToken(token);
    
    res.json({
      success: true,
      message: `SSO test successful for ${username}`,
      token: token,
      decoded: decoded,
      jellyfinResponse: {
        username: user.username,
        email: user.email,
        isAdmin: user.role === 'admin',
        displayName: user.username
      }
    });
    
  } catch (error) {
    console.error('[TEST] SSO test error:', error);
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// ============================================================================
// Error Handling
// ============================================================================

/**
 * 404 - Not Found
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

/**
 * Global error handler
 */
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================================================
// Server Startup
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║   Jellyfin SSO Plugin Integration Server                ║
║   Version: 1.0.0                                        ║
╚════════════════════════════════════════════════════════╝

🚀 Server running on http://localhost:${PORT}

📚 Available Endpoints:

Authentication:
  POST   /api/auth/login                  - User login
  GET    /api/auth/current                - Get current user

Jellyfin Integration:
  POST   /api/auth/validate-sso           - Token validation (requires X-API-Key)
  GET    /api/health                      - Health check

Testing:
  GET    /api/test/sso?username=john.doe  - Test SSO flow
  GET    /api/status                      - Detailed status

Configuration:
  JWT_SECRET: ${JWT_SECRET.substring(0, 10)}...
  JELLYFIN_API_KEY: ${JELLYFIN_SHARED_SECRET.substring(0, 10)}...

ℹ️  Plugin Configuration:
  Companion Base URL: http://localhost:${PORT}
  Shared Secret: ${JELLYFIN_SHARED_SECRET}

🧪 Quick Test:
  curl -X GET "http://localhost:${PORT}/api/test/sso?username=john.doe"

`);
});

// ============================================================================
// Exports (for testing)
// ============================================================================

module.exports = {
  app,
  generateSsoToken,
  validateSsoToken,
  authenticateUser,
  lookupUserByUsername
};

/**
 * Usage Example:
 * 
 * 1. Start the server:
 *    node INTEGRATION_EXAMPLE.js
 * 
 * 2. Test login:
 *    curl -X POST http://localhost:3000/api/auth/login \
 *      -H "Content-Type: application/json" \
 *      -d '{"username":"john.doe","password":"demo123"}'
 * 
 * 3. Test SSO validation (with Jellyfin plugin):
 *    curl -X POST http://localhost:3000/api/auth/validate-sso \
 *      -H "Content-Type: application/json" \
 *      -H "X-API-Key: your-jellyfin-api-key" \
 *      -d '{"token":"<token-from-login>"}'
 * 
 * 4. Test quick SSO flow (no API key required):
 *    curl -X GET "http://localhost:3000/api/test/sso?username=john.doe"
 */
