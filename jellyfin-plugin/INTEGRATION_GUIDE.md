# Jellyfin SSO Plugin - Integration Guide

Complete guide for integrating the Jellyfin SSO Companion Plugin with your companion application.

---

## Overview

The integration works in three steps:

1. **User authenticates** in the companion app
2. **Companion app receives SSO token** after successful authentication
3. **Token is sent to Jellyfin plugin** for validation and user creation

```
┌─────────────────────┐
│  Companion App      │
│  ├─ User Login      │
│  ├─ Generate Token  │
│  └─ Send to Plugin  │
└──────────┬──────────┘
           │ HTTP POST /api/sso/validate
           │ {"token": "..."}
           ▼
┌─────────────────────┐
│  Jellyfin Plugin    │
│  ├─ Validate Token  │
│  ├─ Create User     │
│  └─ Sync Admin      │
└──────────┬──────────┘
           │ {"success": true, "userId": "..."}
           ▼
┌─────────────────────┐
│  Jellyfin Server    │
│  └─ User Session    │
└─────────────────────┘
```

---

## Prerequisites

### Companion App Requirements
- Node.js-based web application (based on codebase)
- Express.js or similar HTTP server
- Authentication system already implemented
- Can generate SSO tokens after user authentication

### Jellyfin Setup
- Plugin installed and enabled
- Configuration page accessible
- Companion Base URL and Shared Secret configured

---

## Step 1: Implement Companion App Endpoints

### Required: Token Validation Endpoint

Your companion app must expose this endpoint:

**Endpoint:**
```
POST /api/auth/validate-sso
```

**Headers:**
```
X-API-Key: <shared-secret-from-plugin-config>
Content-Type: application/json
```

**Request Body:**
```json
{
  "token": "sso_token_string"
}
```

**Response (Success - 200 OK):**
```json
{
  "username": "john.doe",
  "email": "john@example.com",
  "isAdmin": true,
  "displayName": "John Doe"
}
```

**Response (Error - 401 Unauthorized):**
```json
{
  "error": "Invalid or expired token"
}
```

### Example Implementation (Node.js/Express)

```javascript
const express = require('express');
const app = express();

// Middleware to validate API key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.JELLYFIN_SHARED_SECRET;
  
  if (apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// SSO Token Validation Endpoint
app.post('/api/auth/validate-sso', validateApiKey, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    // Validate token (use your existing auth logic)
    const user = validateSsoToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Return user info in expected format
    res.json({
      username: user.username,
      email: user.email,
      isAdmin: user.role === 'admin',
      displayName: user.displayName || user.username
    });
    
  } catch (error) {
    console.error('SSO validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to validate tokens
function validateSsoToken(token) {
  try {
    // Implement your token validation logic
    // This could be JWT verification, session lookup, etc.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}
```

### Optional: Health Check Endpoint

The plugin test connection uses this endpoint:

**Endpoint:**
```
GET /api/health
```

**Response (Success - 200 OK):**
```json
{
  "status": "healthy"
}
```

**Example Implementation:**
```javascript
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});
```

---

## Step 2: Generate and Pass SSO Tokens

### Token Generation

After successful user authentication in your companion app:

```javascript
// After user login verification
const user = authenticateUser(username, password);

if (user) {
  // Generate SSO token
  const ssoToken = generateSsoToken(user);
  
  // Send to frontend or store in session
  req.session.ssoToken = ssoToken;
}

function generateSsoToken(user) {
  // Generate a JWT or session-based token
  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
    },
    process.env.JWT_SECRET
  );
  
  return token;
}
```

### Token in Web Client

After user authenticates in browser:

```javascript
// In your web application (JavaScript)
async function loginToJellyfin() {
  // Get SSO token from companion app
  const response = await fetch('/api/auth/current', {
    credentials: 'include'
  });
  
  const user = await response.json();
  const ssoToken = user.ssoToken;
  
  // Send to Jellyfin plugin
  const jellifyResponse = await fetch(
    'http://jellyfin-server:8096/api/sso/validate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: ssoToken })
    }
  );
  
  const result = await jellifyResponse.json();
  
  if (result.success) {
    // User is authenticated in Jellyfin
    window.location.href = 'http://jellyfin-server:8096/';
  }
}
```

---

## Step 3: Configure Plugin Settings

### Via Jellyfin Dashboard

1. **Open Jellyfin Dashboard** - `http://jellyfin-server:8096`
2. **Go to Plugins** - Dashboard > Plugins > SSO Companion Plugin
3. **Configure Settings:**

| Setting | Value | Example |
|---------|-------|---------|
| **Companion Base URL** | URL of companion app | `http://localhost:3000` |
| **Shared Secret** | API key (must match header validation) | `your-secure-api-key-123` |
| **Enable SSO** | Toggle | ✓ Enabled |
| **Auto Create Users** | Toggle | ✓ Enabled |
| **Update User Policies** | Toggle | ✓ Enabled |
| **Log SSO Attempts** | Toggle | ✓ Enabled |

4. **Test Connection** - Click button to verify connectivity
5. **Save Changes**

---

## Step 4: Test the Integration

### Test 1: Test Connection Button
1. In plugin configuration, click **Test Connection**
2. Expected result: "Connection to companion app successful"

### Test 2: Validate Token Endpoint
Using curl:

```bash
# 1. Generate a test token in your companion app
TOKEN="your_test_sso_token"
API_KEY="your-shared-secret"

# 2. Call the plugin validation endpoint
curl -X POST http://localhost:8096/api/sso/validate \
  -H "Content-Type: application/json" \
  -d "{\"token\": \"$TOKEN\"}"

# Expected response:
# {
#   "success": true,
#   "userId": "jellyfin-user-id",
#   "username": "john.doe",
#   "message": "Token validated successfully"
# }
```

### Test 3: Full SSO Flow
1. **User logs into companion app** - With valid credentials
2. **Get SSO token** - From companion app session
3. **Call plugin endpoint** - POST `/api/sso/validate`
4. **Verify Jellyfin user created** - Check Dashboard > Users
5. **Verify admin status synced** - If enabled, check user permissions

---

## Common Integration Patterns

### Pattern 1: OAuth2-style Flow

```
User → Companion App Login
       ↓
       Generate JWT Token
       ↓
User's Browser → Redirect to Jellyfin with token
                 ↓
                 Validate with Plugin
                 ↓
                 Create Jellyfin Session
```

### Pattern 2: Session-based Flow

```
User → Companion App Login
       ↓
       Create Session
       ↓
User's Browser → Query companion app for token
                 ↓
                 Send token to plugin
                 ↓
                 Create Jellyfin Session
```

### Pattern 3: API Token Exchange

```
Companion App → Generates SSO Token for User
                ↓
                Returns token to client
                ↓
Client → Validates token with plugin
         ↓
         Gets Jellyfin user ID
         ↓
         Authenticates in Jellyfin
```

---

## Error Handling

### Common Errors and Solutions

#### Error: 401 Unauthorized
```json
{
  "error": "Invalid or expired token"
}
```
**Solution:**
- Verify token is still valid (check expiration)
- Verify API key in request header matches plugin configuration
- Check token format (should be JWT or valid session token)

#### Error: 400 Bad Request
```json
{
  "error": "Token is required"
}
```
**Solution:**
- Ensure request body includes `token` field
- Verify content-type is `application/json`

#### Error: 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```
**Solution:**
- Check companion app logs for errors
- Verify database connections
- Review Jellyfin plugin logs for details

#### Error: 503 Service Unavailable
```json
{
  "error": "Service unavailable"
}
```
**Solution:**
- Verify companion app is running
- Check network connectivity between Jellyfin and companion app
- Verify firewall rules allow connection

---

## Security Best Practices

### 1. Shared Secret Management
```javascript
// GOOD: Use environment variable
const sharedSecret = process.env.JELLYFIN_SHARED_SECRET;

// BAD: Hardcode secret
const sharedSecret = 'my-secret-123';
```

### 2. Token Validation
```javascript
// Always validate token signature and expiration
function validateSsoToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      maxAge: '1h'
    });
    return decoded;
  } catch (error) {
    // Token invalid, expired, or tampered
    return null;
  }
}
```

### 3. HTTPS in Production
```javascript
// Configure plugin with HTTPS URLs
// Companion Base URL: https://secure-domain.com
// Use proper SSL certificates on both ends
```

### 4. Rate Limiting
```javascript
// Protect endpoints from brute force
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.post('/api/auth/validate-sso', limiter, validateApiKey, (req, res) => {
  // ...
});
```

### 5. Input Validation
```javascript
// Validate all inputs
const { body, validationResult } = require('express-validator');

app.post('/api/auth/validate-sso',
  validateApiKey,
  body('token')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Token must be a non-empty string'),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // Process valid token
  }
);
```

---

## Debugging Integration Issues

### Enable Logging

**In Jellyfin Plugin:**
- Enable "Log SSO Attempts" in configuration
- Check logs: Dashboard > Logs > Filter "SSO"

**In Companion App:**
```javascript
// Add detailed logging
app.post('/api/auth/validate-sso', validateApiKey, async (req, res) => {
  console.log('[SSO] Token validation request received');
  console.log('[SSO] Token:', req.body.token.substring(0, 20) + '...');
  
  try {
    const user = validateSsoToken(req.body.token);
    console.log('[SSO] Validation successful:', user.username);
    res.json({ username: user.username, ... });
  } catch (error) {
    console.error('[SSO] Validation failed:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});
```

### Test Endpoints Individually

```bash
# 1. Test companion app health
curl -X GET http://localhost:3000/api/health

# 2. Test token validation with valid token
curl -X POST http://localhost:3000/api/auth/validate-sso \
  -H "X-API-Key: your-shared-secret" \
  -H "Content-Type: application/json" \
  -d '{"token": "your_valid_token"}'

# 3. Test plugin health (if available)
curl -X GET http://localhost:8096/api/sso/test

# 4. Test full validation flow
curl -X POST http://localhost:8096/api/sso/validate \
  -H "Content-Type: application/json" \
  -d '{"token": "your_valid_token"}'
```

---

## Advanced Configuration

### Custom User Fields

If you need to pass additional user information:

```json
{
  "username": "john.doe",
  "email": "john@example.com",
  "isAdmin": true,
  "displayName": "John Doe",
  "customField1": "value1"
}
```

The plugin uses: `username`, `email`, `isAdmin`

Additional fields are preserved in logs but not used for user creation.

### Synchronization Options

**With "Update User Policies" enabled:**
- Admin status is synced every SSO login
- User loses admin if `isAdmin: false`
- Useful for managing permissions externally

**With "Update User Policies" disabled:**
- Admin status set once at user creation
- Subsequent changes require manual dashboard update
- Useful if admin status is managed in Jellyfin

---

## Troubleshooting Checklist

Before going live, verify:

- [ ] Companion app `/api/auth/validate-sso` endpoint exists
- [ ] Endpoint validates `X-API-Key` header
- [ ] Token validation returns correct JSON format
- [ ] Plugin configuration has correct Companion Base URL
- [ ] Plugin configuration has correct Shared Secret
- [ ] Test Connection button shows success
- [ ] Sample token validates successfully via plugin
- [ ] Jellyfin user is created automatically
- [ ] Admin status is synced if enabled
- [ ] Logs show validation attempts
- [ ] No network/firewall blocks between Jellyfin and companion app

---

## Example: Complete Integration

### Companion App (Node.js/Express)

[Complete code example in separate file: `INTEGRATION_EXAMPLE.js`]

### Complete Flow

1. User authentication in companion app
2. SSO token generated and stored in session
3. Frontend calls Jellyfin plugin with token
4. Plugin validates with companion app
5. User created in Jellyfin if needed
6. Admin status synced
7. User authenticated in Jellyfin

---

## Support

For issues or questions:

1. Check [README.md](README.md) for configuration help
2. Review [BUILD_GUIDE.md](BUILD_GUIDE.md) for plugin setup
3. Enable logging and check logs for error details
4. Test endpoints individually with curl
5. Verify network connectivity between servers

---

**Last Updated:** January 13, 2026  
**Version:** 1.0.0
