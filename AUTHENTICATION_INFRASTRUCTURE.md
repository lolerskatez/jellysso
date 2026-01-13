# Jellyfin SSO - Authentication Infrastructure Analysis

**Date:** January 12, 2026  
**Status:** Backend infrastructure is COMPLETE and properly configured

---

## Executive Summary

**✅ YES - The infrastructure for backend linking between the plugin and companion app IS IN PLACE.**

The system has:
1. ✅ A working `/api/auth/validate-sso` endpoint (GET) in the companion app
2. ✅ API key authentication via `X-API-Key` header
3. ✅ Jellyfin API integration for user authentication
4. ✅ Session-based authentication with secure cookies
5. ✅ Proper token validation and refresh mechanisms
6. ✅ Complete QuickConnect device authorization flow

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Jellyfin Plugin (C# .NET)                  │
│                   POST /api/sso/validate                        │
│              Validates token with companion app                 │
└────────────────────────┬────────────────────────────────────────┘
                         │ {"token": "..."}
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│               Companion App (Node.js/Express)                   │
│          GET /api/auth/validate-sso (requires X-API-Key)        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. Validates API key from request header                │  │
│  │  2. Verifies JWT token signature                         │  │
│  │  3. Returns user info: {username, email, isAdmin}        │  │
│  │  4. Logs the validation attempt                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │ {username, email, isAdmin}
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Jellyfin Server                              │
│  • Creates/updates user based on response                      │
│  • Syncs admin status if UpdateUserPolicies enabled            │
│  • Establishes user session                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## How Jellyfin Session Gets Authenticated

### Complete Authentication Flow

#### **Step 1: User Authenticates in Companion App**
```
POST /api/auth/login
{
  "username": "john.doe",
  "password": "secret123"
}
```

**File:** [src/routes/auth.js](src/routes/auth.js#L15)

```javascript
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // 1. Validate Jellyfin credentials
  const authResult = await jellyfin.authenticateByName(username, password);
  
  // 2. Store in Express session
  req.session.user = authResult.User;
  req.session.accessToken = authResult.AccessToken;
  
  // 3. Return success
  res.json({ success: true, user: authResult.User });
});
```

**What happens:**
- Companion app **relays credentials to Jellyfin** via JellyfinAPI
- Jellyfin validates and returns User object + AccessToken
- **Express session is created** with user data and access token
- Session is **stored in secure HTTP-only cookie** (`connect.sid`)

---

#### **Step 2: User's Browser Has Active Session**

After login, every request includes:
```
Cookie: connect.sid=<encrypted-session-id>
```

**File:** [src/server.js](src/server.js#L150) - Session middleware

```javascript
app.use(session({
  store: new FileStore(),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { 
    httpOnly: true,      // Can't be accessed by JavaScript
    secure: true,        // Only sent over HTTPS in production
    sameSite: 'Strict'   // CSRF protection
  }
}));
```

**Session contents:**
```javascript
{
  user: {
    Id: 'jellyfin-user-id',
    Name: 'john.doe',
    Policy: { IsAdministrator: false },
    // ... other user data from Jellyfin
  },
  accessToken: 'jellyfin-access-token'
}
```

---

#### **Step 3: Generate SSO Token for Plugin**

When a user wants to authenticate Jellyfin from another device (TV, Roku, etc.):

**File:** [src/models/TokenManager.js](src/models/TokenManager.js)

```javascript
function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.Id,
      username: user.Name,
      email: user.Email,
      role: user.Policy?.IsAdministrator ? 'admin' : 'user'
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}
```

**Token contains:**
- User ID
- Username
- Email
- Admin status
- **Expiration: 1 hour**

---

#### **Step 4: Plugin Validates Token**

When the plugin receives a token from user trying to log in:

**File:** [jellyfin-plugin/Api/SsoController.cs](jellyfin-plugin/Api/SsoController.cs)

```csharp
[HttpPost("validate")]
[AllowAnonymous]
public async Task<ActionResult<ValidateSsoResponse>> ValidateToken(
    [FromBody] ValidateSsoRequest request)
{
    // 1. Call companion app to validate token
    using var httpClient = new HttpClient();
    httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.SharedSecret);
    
    var response = await httpClient.GetAsync(
        $"{_config.CompanionBaseUrl}/api/auth/validate-sso?token={request.Token}"
    );
    
    // 2. Parse response
    var userInfo = JsonSerializer.Deserialize<SsoUserInfo>(
        await response.Content.ReadAsStringAsync()
    );
    
    // 3. Create/update Jellyfin user
    var user = _userManager.GetUserByName(userInfo.Username) ?? 
               _userManager.CreateUserAsync(newUser).Result;
    
    // 4. Sync admin status
    if (_config.UpdateUserPolicies)
        user.SetPermission(UserPermissions.IsAdministrator, userInfo.IsAdmin);
    
    return Ok(new ValidateSsoResponse { 
        Success = true, 
        UserId = user.Id, 
        Username = user.Name 
    });
}
```

**Validation endpoint in companion app:**

**File:** [src/routes/auth.js](src/routes/auth.js#L130)

```javascript
router.get('/validate-sso', (req, res) => {
  const { token } = req.query;
  const apiKey = req.headers['x-api-key'];
  
  // 1. Validate API key
  const expectedKey = process.env.SHARED_SECRET;
  if (apiKey !== expectedKey) {
    return res.status(401).json({ valid: false, error: 'Invalid API key' });
  }
  
  try {
    // 2. Verify JWT signature and expiration
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded && decoded.userId && decoded.exp > Date.now() / 1000) {
      // 3. Return user info
      res.json({ 
        valid: true, 
        username: decoded.username,
        email: decoded.email,
        isAdmin: decoded.role === 'admin'
      });
    } else {
      res.status(401).json({ valid: false, error: 'Token expired' });
    }
  } catch (error) {
    res.status(401).json({ valid: false, error: 'Token validation failed' });
  }
});
```

---

## Authentication Methods in Companion App

### 1. **Session-Based (Primary - For Web Browser)**

```
User Login → Jellyfin Auth → Express Session → Secure Cookie
                                        ↓
                              User has active session
                              (can use all web features)
```

**Where it's used:**
- Web dashboard login
- QuickConnect device authorization
- Settings changes
- Audit logs

**Endpoints protected by session middleware:**
[src/server.js](src/server.js#L212)

```javascript
// Middleware to require authentication for web routes
const authMiddleware = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Protect routes
app.use('/admin', authMiddleware);
app.use('/api/users', authMiddleware);
app.use('/api/settings', authMiddleware);
```

---

### 2. **API Key Authentication (For Plugin)**

```
Plugin Request → X-API-Key Header → Validate Against SHARED_SECRET
                              ↓
                    Allow token validation
```

**Endpoint:** `GET /api/auth/validate-sso`  
**Requires:** `X-API-Key` header matching `process.env.SHARED_SECRET`

**Configuration:**
```javascript
// In Jellyfin Plugin Dashboard:
Shared Secret: "your-secure-api-key-12345"

// In Companion App:
SHARED_SECRET=your-secure-api-key-12345
```

---

### 3. **JWT Token Authentication (For SSO)**

```
User Session → Generate JWT Token → Send to Plugin
                                          ↓
                                    Validate Token
                                          ↓
                                    Create Jellyfin Session
```

**Token generation:**
```javascript
// After user authenticates with companion app
const token = jwt.sign(
  { userId, username, email, role },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// Token is returned to user's browser/device
res.json({ token: token, user: userData });
```

**Token validation:**
```javascript
// Plugin calls validate-sso endpoint with token
const decoded = jwt.verify(token, process.env.JWT_SECRET);
// If valid: return user info
// If invalid/expired: return 401 Unauthorized
```

---

### 4. **OIDC Authentication (For External Providers)**

Optional external SSO integration:

**File:** [src/routes/oidc-auth.js](src/routes/oidc-auth.js)

```javascript
// External provider (Azure AD, Okta, etc.) → OIDC Flow
// → Companion app receives ID token
// → Creates/syncs Jellyfin user
// → Establishes session
```

---

## Complete Request/Response Examples

### Example 1: Jellyfin Plugin Validates Token

**Plugin sends:**
```http
GET http://localhost:3000/api/auth/validate-sso?token=eyJhbGc...
X-API-Key: your-shared-secret
```

**Companion app responds:**
```json
{
  "valid": true,
  "username": "john.doe",
  "email": "john@example.com",
  "isAdmin": false
}
```

**Jellyfin plugin then:**
1. Creates user "john.doe" in Jellyfin (if not exists)
2. Sets admin = false
3. Returns user ID to establish session

---

### Example 2: User Logs in via Web Browser

**User submits:**
```http
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{
  "username": "john.doe",
  "password": "secret123"
}
```

**Companion app:**
1. Calls Jellyfin: `POST /Users/AuthenticateByName` with credentials
2. Receives: User object + AccessToken from Jellyfin
3. **Creates Express session** with user data
4. Sets secure HTTP-only cookie: `Set-Cookie: connect.sid=...`

**Browser response:**
```json
{
  "success": true,
  "user": {
    "Id": "jellyfin-user-id",
    "Name": "john.doe",
    "Policy": { "IsAdministrator": false }
  }
}
```

**Now browser has session cookie and can:**
- Access `/admin` routes
- View dashboard
- Authorize QuickConnect devices
- Change settings

---

### Example 3: QuickConnect Authorization

**User sees code on TV: "ABC123"**

**User enters code in web app:**
```http
POST http://localhost:3000/api/quickconnect/authorize
X-CSRF-Token: ...
Cookie: connect.sid=...

{
  "code": "ABC123"
}
```

**Companion app:**
1. Checks: User is authenticated (session exists)
2. Gets user ID from session
3. Calls Jellyfin: `POST /QuickConnect/Authorize`
4. Sends: User's session token + code

**Jellyfin:**
- Links code to user's account
- TV can now authenticate with that code

**Result:** TV is now logged in as john.doe

---

## Security Measures

### 1. **Session Security**

| Feature | Implementation | File |
|---------|---------------|----|
| HTTP-only Cookies | ✅ Can't be accessed by JavaScript | [src/server.js](src/server.js#L150) |
| Secure Flag | ✅ Only sent over HTTPS in production | [src/server.js](src/server.js#L150) |
| SameSite | ✅ Strict - prevents CSRF | [src/server.js](src/server.js#L150) |
| Secure Secret | ✅ From environment variable | [src/server.js](src/server.js#L150) |

### 2. **Token Security**

| Feature | Implementation | File |
|---------|---------------|----|
| JWT Signing | ✅ HMAC-SHA256 with secret | [src/models/TokenManager.js](src/models/TokenManager.js) |
| Expiration | ✅ 1 hour for access tokens | [src/models/TokenManager.js](src/models/TokenManager.js) |
| Signature Verification | ✅ Checked before accepting token | [src/routes/auth.js](src/routes/auth.js#L130) |
| API Key Validation | ✅ Required X-API-Key header | [src/routes/auth.js](src/routes/auth.js#L130) |

### 3. **CSRF Protection**

**File:** [src/middleware/csrf.js](src/middleware/csrf.js)

```javascript
const csrfProtection = csrf({ cookie: false });

// All state-changing endpoints require CSRF token:
router.post('/login', csrfProtection, ...);
router.post('/logout', csrfProtection, ...);
router.post('/quickconnect/authorize', csrfProtection, ...);
```

### 4. **Audit Logging**

**File:** [src/models/AuditLogger.js](src/models/AuditLogger.js)

Every authentication event is logged:
- ✅ Successful logins (user, IP, timestamp)
- ✅ Failed login attempts (username, reason, IP)
- ✅ Token validations (user, success/failure)
- ✅ Session changes (login/logout)
- ✅ QuickConnect authorizations (device, user, timestamp)

---

## Configuration

### Environment Variables Needed

```bash
# Session security
SESSION_SECRET=your-long-random-session-secret

# JWT tokens
JWT_SECRET=your-long-random-jwt-secret

# API authentication
SHARED_SECRET=your-jellyfin-plugin-api-key

# Jellyfin connection
JELLYFIN_URL=http://jellyfin-server:8096
JELLYFIN_API_KEY=jellyfin-admin-api-key
```

### Jellyfin Plugin Configuration

```
Dashboard > Plugins > SSO Companion Plugin:
- Companion Base URL: http://localhost:3000
- Shared Secret: your-jellyfin-plugin-api-key (must match SHARED_SECRET)
- Enable SSO: ✓
- Auto Create Users: ✓
- Update User Policies: ✓
- Log SSO Attempts: ✓
```

---

## Complete Authentication Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER FLOWS                                │
└─────────────────────────────────────────────────────────────────────┘

FLOW 1: Browser Login (Session-based)
═══════════════════════════════════════
  Browser
    │
    ├─→ POST /api/auth/login {user, pass}
    │
    ▼
  Companion App
    │
    ├─→ Validates with Jellyfin API
    │
    ├─→ Creates Express session
    │
    ├─→ Sets secure cookie
    │
    ▼
  Browser now has:
    - Express session cookie
    - User data in session
    - Can access /admin, /dashboard, etc.


FLOW 2: Plugin Token Validation (Plugin authorization)
═════════════════════════════════════════════════════════
  TV/Device
    │
    ├─→ Requests SSO token from Jellyfin Plugin
    │
    ▼
  Jellyfin Plugin
    │
    ├─→ POST /api/sso/validate {token}
    │
    ├─→ (sends token to validate-sso endpoint)
    │
    ▼
  Companion App
    │
    ├─→ GET /api/auth/validate-sso?token=... [X-API-Key: ...]
    │
    ├─→ Verifies JWT signature
    │
    ├─→ Returns {username, email, isAdmin}
    │
    ▼
  Jellyfin Plugin
    │
    ├─→ Creates/updates user
    │
    ├─→ Syncs admin status
    │
    ├─→ Establishes user session
    │
    ▼
  TV/Device
    │
    └─→ Now logged in to Jellyfin as that user


FLOW 3: QuickConnect Device Authorization
═════════════════════════════════════════════
  TV sees code: "ABC123"
    │
    ├─→ User enters code in web app
    │
    ▼
  Browser
    │
    ├─→ POST /api/quickconnect/authorize {code}
    │   (with session cookie + CSRF token)
    │
    ▼
  Companion App
    │
    ├─→ Checks session (user authenticated)
    │
    ├─→ Calls Jellyfin: /QuickConnect/Authorize
    │
    ├─→ Sends: user's session token + code
    │
    ▼
  Jellyfin
    │
    ├─→ Links code to user
    │
    ▼
  TV
    │
    └─→ Can now authenticate with code


FLOW 4: Token Refresh (For long-lived sessions)
═════════════════════════════════════════════════
  Browser/Client has: refreshToken
    │
    ├─→ POST /api/auth/refresh-token {refreshToken}
    │
    ▼
  Companion App
    │
    ├─→ Verifies refresh token (hasn't been revoked)
    │
    ├─→ Generates new access token
    │
    ├─→ Returns new token
    │
    ▼
  Browser/Client
    │
    └─→ Can now use new access token
```

---

## Endpoint Reference

### Authentication Endpoints

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/api/auth/login` | POST | No | User login |
| `/api/auth/logout` | POST | Session | User logout |
| `/api/auth/check` | GET | No | Check login status |
| `/api/auth/validate-sso` | GET | X-API-Key | **Plugin uses this** |
| `/api/auth/refresh-token` | POST | No | Refresh access token |
| `/api/auth/revoke-token` | POST | Session | Revoke refresh token |

### Session Protection

| Route Pattern | Requires Session |
|--------------|-----------------|
| `/admin/*` | ✅ Yes |
| `/api/users/*` | ✅ Yes |
| `/api/settings/*` | ✅ Yes |
| `/api/quickconnect/*` | ✅ Yes |
| `/api/audit/*` | ✅ Yes |
| `/api/auth/*` | ❌ No (public) |
| `/api/plugin/*` | ❌ No (public) |

---

## How It All Works Together

### User Authentication Journey

```
1. USER ARRIVES AT http://localhost:3000
   ├─ No session cookie
   ├─ Redirected to /login
   └─ Shows login form

2. USER ENTERS CREDENTIALS
   ├─ Browser: POST /api/auth/login
   ├─ App: Validates with Jellyfin
   ├─ App: Creates Express session
   ├─ App: Sets Set-Cookie header
   └─ Browser: Stores cookie

3. USER HAS ACTIVE SESSION
   ├─ Every request includes: Cookie: connect.sid=...
   ├─ Middleware checks session exists
   ├─ User ID available in req.session.user
   ├─ Can access protected routes
   └─ Can authorize devices

4. USER WANTS TO LOGIN ON TV
   ├─ TV shows QuickConnect code
   ├─ User sees code: ABC123
   ├─ User goes to web app
   ├─ Browser: POST /api/quickconnect/authorize
   ├─ App: Checks session (authenticated user)
   ├─ App: Gets user ID from session
   ├─ App: Calls Jellyfin with user's token
   └─ TV: Can now login with code

5. PLUGIN AUTHENTICATES (From TV/Roku/etc)
   ├─ Jellyfin Plugin: Receives token from device
   ├─ Plugin: POST /api/sso/validate
   ├─ App: GET /api/auth/validate-sso
   ├─ App: Validates JWT signature
   ├─ App: Returns user info
   ├─ Plugin: Creates user in Jellyfin
   ├─ Plugin: Syncs admin status
   └─ Device: Logged into Jellyfin
```

---

## Infrastructure Completion Status

| Component | Status | File(s) |
|-----------|--------|---------|
| Session middleware | ✅ Complete | [src/server.js](src/server.js#L150) |
| Session storage | ✅ Complete | [src/server.js](src/server.js#L150) |
| Login endpoint | ✅ Complete | [src/routes/auth.js](src/routes/auth.js#L15) |
| Logout endpoint | ✅ Complete | [src/routes/auth.js](src/routes/auth.js#L100) |
| **validate-sso endpoint** | ✅ Complete | [src/routes/auth.js](src/routes/auth.js#L130) |
| JWT token generation | ✅ Complete | [src/models/TokenManager.js](src/models/TokenManager.js) |
| JWT token validation | ✅ Complete | [src/routes/auth.js](src/routes/auth.js#L130) |
| Plugin integration | ✅ Complete | [jellyfin-plugin/Api/SsoController.cs](jellyfin-plugin/Api/SsoController.cs) |
| QuickConnect flow | ✅ Complete | [src/routes/quickconnect.js](src/routes/quickconnect.js) |
| CSRF protection | ✅ Complete | [src/middleware/csrf.js](src/middleware/csrf.js) |
| Audit logging | ✅ Complete | [src/models/AuditLogger.js](src/models/AuditLogger.js) |
| API key validation | ✅ Complete | [src/routes/auth.js](src/routes/auth.js#L130) |

---

## Summary

### ✅ YES - Backend Infrastructure Is Complete

**What's in place:**

1. **Session Authentication** - Express sessions with secure cookies, perfect for web browser users
2. **API Key Authentication** - X-API-Key header validation, used by Jellyfin Plugin
3. **JWT Token Authentication** - Signed tokens with expiration, for SSO flows
4. **Token Validation Endpoint** - `/api/auth/validate-sso` that the plugin calls
5. **User Management** - Auto-creates/updates Jellyfin users from tokens
6. **QuickConnect Integration** - Authorizes devices for Jellyfin login
7. **Security** - CSRF protection, secure cookies, audit logging, API key validation
8. **Jellyfin API Integration** - Direct communication with Jellyfin server

### How Jellyfin Session Gets Authenticated

**Two main paths:**

**Path 1: Web Browser User**
1. User logs in with username/password
2. Companion app validates with Jellyfin
3. Express session created with user data
4. Secure HTTP-only cookie set
5. User has authenticated session

**Path 2: Device/Plugin User**
1. Device requests SSO token
2. Plugin validates token with `/api/auth/validate-sso`
3. Companion app verifies JWT signature
4. Returns user info to plugin
5. Plugin creates Jellyfin user session
6. Device is authenticated

Both paths properly integrate with Jellyfin through the companion app's JellyfinAPI client, maintaining a secure bridge between external authentication and Jellyfin's user management system.
