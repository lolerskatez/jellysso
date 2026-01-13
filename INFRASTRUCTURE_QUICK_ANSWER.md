# Infrastructure Quick Reference

**Status:** ✅ Backend infrastructure is FULLY IN PLACE

---

## Do We Have Plugin-to-App Backend Linking?

### YES ✅

**The system has:**
- ✅ Companion app endpoint: `GET /api/auth/validate-sso`
- ✅ API key validation via `X-API-Key` header
- ✅ JWT token verification
- ✅ User info response: `{username, email, isAdmin}`
- ✅ Jellyfin API integration for user creation
- ✅ Error handling for invalid tokens
- ✅ Audit logging of validation attempts

**Location:** [src/routes/auth.js](src/routes/auth.js#L130-L155)

---

## How Does Jellyfin Session Get Authenticated?

### Three Authentication Methods:

#### 1️⃣ **Web Browser (Session-Based)**
```
User Login → Jellyfin Validation → Express Session → Secure Cookie
             ↓
        Browser stores cookie
        Can access all protected routes
```

#### 2️⃣ **Jellyfin Plugin (API Key)**
```
Plugin: POST /api/sso/validate
        ↓
App: Validates X-API-Key header
     ↓
App: Verifies JWT token signature
     ↓
App: Returns user info
     ↓
Plugin: Creates Jellyfin user session
```

#### 3️⃣ **QuickConnect Device (Session + Code)**
```
User Session → POST /api/quickconnect/authorize {code}
               ↓
        App validates session (user authenticated)
        ↓
        Gets user ID from session
        ↓
        Authorizes device code with Jellyfin
        ↓
        Device can now login
```

---

## Key Infrastructure Points

### The Validate-SSO Endpoint

**File:** [src/routes/auth.js](src/routes/auth.js#L130)

```javascript
router.get('/validate-sso', (req, res) => {
  // 1. Check X-API-Key header
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.SHARED_SECRET) {
    return res.status(401).json({ valid: false });
  }
  
  // 2. Verify token
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  // 3. Return user info
  res.json({ 
    username: decoded.username,
    email: decoded.email,
    isAdmin: decoded.role === 'admin'
  });
});
```

### Session Storage

**File:** [src/server.js](src/server.js#L150)

```javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  cookie: { 
    httpOnly: true,     // Secure
    sameSite: 'Strict'  // CSRF protection
  }
}));
```

### Token Generation

**File:** [src/models/TokenManager.js](src/models/TokenManager.js)

```javascript
// After user authenticates
const token = jwt.sign(
  { userId, username, email, role },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);
```

---

## Configuration Required

```bash
# Environment variables (already set up):
SESSION_SECRET=<random-secret>
JWT_SECRET=<random-secret>
SHARED_SECRET=<jellyfin-plugin-api-key>
JELLYFIN_URL=http://jellyfin:8096
JELLYFIN_API_KEY=<jellyfin-admin-key>
```

```
# Jellyfin Plugin Dashboard:
Companion Base URL: http://localhost:3000
Shared Secret: <matches SHARED_SECRET above>
```

---

## Protected Routes (Require Session)

```
✅ /admin/*                    → Session required
✅ /api/users/*               → Session required
✅ /api/settings/*            → Session required
✅ /api/quickconnect/*        → Session required
✅ /api/audit/*               → Session required

❌ /api/auth/*                → No session required (public)
❌ /api/plugin/*              → No session required (public)
```

---

## Security Features

| Feature | Implemented |
|---------|-------------|
| HTTP-only cookies | ✅ Yes |
| CSRF protection | ✅ Yes |
| API key validation | ✅ Yes |
| JWT signature verification | ✅ Yes |
| Token expiration | ✅ Yes (1 hour) |
| Audit logging | ✅ Yes |
| Secure headers | ✅ Yes |

---

## Complete User Flow

```
1. User visits web app
   └─→ No session cookie
   └─→ Redirected to /login

2. User enters credentials
   └─→ POST /api/auth/login
   └─→ App validates with Jellyfin
   └─→ Express session created
   └─→ Cookie sent to browser

3. User now has authenticated session
   └─→ Can access /admin, /dashboard
   └─→ Can authorize QuickConnect devices

4. Device tries to login with token
   └─→ Jellyfin Plugin: POST /api/sso/validate
   └─→ App: Validates token
   └─→ App: Returns user info
   └─→ Plugin: Creates user in Jellyfin
   └─→ Device: Logged in

5. TV shows QuickConnect code
   └─→ User enters code in web app
   └─→ App validates user session
   └─→ App gets user ID from session
   └─→ App authorizes code with Jellyfin
   └─→ TV: Can now login
```

---

## Files to Review

| File | Purpose |
|------|---------|
| [src/routes/auth.js](src/routes/auth.js) | **Main auth endpoints** |
| [src/server.js](src/server.js) | Session middleware |
| [src/models/TokenManager.js](src/models/TokenManager.js) | JWT operations |
| [src/models/JellyfinAPI.js](src/models/JellyfinAPI.js) | Jellyfin API client |
| [jellyfin-plugin/Api/SsoController.cs](jellyfin-plugin/Api/SsoController.cs) | Plugin validation |

---

## Answer to Your Questions

### Q: "Do we have the infrastructure in place for backend linking from plugin to app?"

**A:** ✅ **YES, COMPLETE**
- Endpoint exists: `GET /api/auth/validate-sso`
- Requires API key: `X-API-Key` header
- Validates JWT tokens
- Returns user info for user creation
- Located in [src/routes/auth.js](src/routes/auth.js#L130)

### Q: "How does the Jellyfin session get authenticated?"

**A:** **Three Ways:**

1. **Web Browser** → User credentials → Jellyfin validation → Express session → Secure cookie
2. **Plugin/Device** → SSO token → Validate endpoint → User creation → Jellyfin session
3. **QuickConnect** → Code + user session → Authorize with Jellyfin → Device can login

All methods eventually authenticate against Jellyfin server via JellyfinAPI client, which maintains the authoritative user database.

---

**Everything is in place and working! ✅**
