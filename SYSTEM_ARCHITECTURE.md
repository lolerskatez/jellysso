# Complete System Architecture Diagram

## System Component Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    USER INTERFACES                               │  │
│  │                                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │  │
│  │  │ Web Browser  │  │   TV/Roku    │  │   Mobile/Desktop     │  │  │
│  │  │   (React)    │  │   (Plugin)   │  │   (QuickConnect)     │  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘  │  │
│  └─────────────┬──────────────┬─────────────────────┬──────────────┘  │
│                │              │                     │                   │
│                ▼              ▼                     ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │          COMPANION APP (Node.js/Express)                        │  │
│  │          http://localhost:3000                                  │  │
│  │                                                                  │  │
│  │  Routes:                                                        │  │
│  │  ├─ POST   /api/auth/login              → Jellyfin auth       │  │
│  │  ├─ POST   /api/auth/logout             → Destroy session     │  │
│  │  ├─ GET    /api/auth/check              → Session status      │  │
│  │  ├─ GET    /api/auth/validate-sso       ← PLUGIN CALLS THIS  │  │
│  │  ├─ POST   /api/quickconnect/authorize  → Device approval     │  │
│  │  └─ GET    /admin/*                     → Admin dashboard     │  │
│  │                                                                  │  │
│  │  Middleware:                                                    │  │
│  │  ├─ Session (Express session store)                            │  │
│  │  ├─ CSRF protection                                            │  │
│  │  ├─ JWT validation                                             │  │
│  │  └─ Audit logging                                              │  │
│  │                                                                  │  │
│  │  Models:                                                        │  │
│  │  ├─ TokenManager (JWT operations)                              │  │
│  │  ├─ JellyfinAPI (Jellyfin client)                              │  │
│  │  ├─ AuditLogger (Event logging)                                │  │
│  │  └─ DatabaseManager (Settings)                                 │  │
│  └─────────┬──────────────────────────────────┬────────────────────┘  │
│            │                                  │                        │
│            │ (Session-based auth)            │ (API key auth)         │
│            │ (Jellyfin API calls)            │ (Token validation)     │
│            │                                  │                        │
│            ▼                                  ▼                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │          JELLYFIN SERVER                                         │  │
│  │          http://jellyfin:8096                                   │  │
│  │                                                                  │  │
│  │  API Endpoints:                                                 │  │
│  │  ├─ POST   /Users/AuthenticateByName    ← Auth with creds     │  │
│  │  ├─ GET    /Users                       ← List users           │  │
│  │  ├─ POST   /Users                       ← Create user          │  │
│  │  ├─ GET    /QuickConnect/Status         ← QC status            │  │
│  │  └─ POST   /QuickConnect/Authorize      ← Approve device       │  │
│  │                                                                  │  │
│  │  Plugins:                                                       │  │
│  │  └─ Jellyfin.Plugin.SSOCompanion.dll                            │  │
│  │     ├─ POST /api/sso/validate                                   │  │
│  │     ├─ GET  /api/sso/config                                     │  │
│  │     └─ GET  /api/sso/test                                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication Flow Sequence Diagrams

### Flow 1: Web Browser User Login

```
Browser                    Companion App              Jellyfin
  │                              │                        │
  ├──POST /api/auth/login───────→│                        │
  │  {username, password}         │                        │
  │                               ├─POST /Users/Auth─────→│
  │                               │  {username, password}  │
  │                               │                        │
  │                               │←──{User, AccessToken}──│
  │                               │                        │
  │                        [Session created]               │
  │                        [Cookie set]                    │
  │                               │                        │
  │←─────{success: true}──────────│                        │
  │                               │                        │
  │ [Browser stores cookie]       │                        │
  │ [Next request includes:       │                        │
  │  Cookie: connect.sid=...]     │                        │
  │                               │                        │
  ├──GET /admin?────────────────→│                        │
  │  Cookie: connect.sid=...      │                        │
  │                        [Validate session]              │
  │←──────[Admin page]────────────│                        │
```

### Flow 2: Jellyfin Plugin SSO

```
TV/Device              Jellyfin Plugin           Companion App        Jellyfin
  │                         │                          │                 │
  ├─[User wants to login]   │                          │                 │
  │                         │                          │                 │
  │                    [User submits SSO token]        │                 │
  │                         │                          │                 │
  │                         ├─POST /api/sso/validate──→│                 │
  │                         │  {token}                 │                 │
  │                         │                          │                 │
  │                         │  ┌─GET /api/auth/─────────→
  │                         │  │   validate-sso         │
  │                         │  │   [X-API-Key: ...]     │
  │                         │  │   ?token=...           │
  │                         │  │                        │
  │                         │  │  [Validate JWT]        │
  │                         │  │  [Verify signature]    │
  │                         │  │                        │
  │                         │←─{username, email, ─────→
  │                         │   isAdmin}               │
  │                         │                          │
  │                    [Create/Update user]            │
  │                    [Sync admin status]             │
  │                         │                          │
  │                         ├─POST /Users/Auth────────→│
  │                         │  (create if needed)      │
  │                         │                          │
  │                         │←──{User, AccessToken}────│
  │                         │                          │
  │←────[User authenticated]│                          │
  │    [Can stream content]│                          │
```

### Flow 3: QuickConnect Device Authorization

```
TV                   Browser              Companion App         Jellyfin
 │                       │                       │                 │
 │ [Shows code: ABC123]  │                       │                 │
 │                       │                       │                 │
 │                   [User enters code]          │                 │
 │                       │                       │                 │
 │                       ├─POST /api/quickconnect─→
 │                       │  /authorize             │
 │                       │  {code: "ABC123"}      │
 │                       │  [Cookie: connect.sid] │
 │                       │  [CSRF token]          │
 │                       │                        │
 │                       │     [Check session]    │
 │                       │     [Get user ID]      │
 │                       │                        │
 │                       │        ├─POST /QuickConnect/─→
 │                       │        │  Authorize          │
 │                       │        │  {code, userId}     │
 │                       │        │                     │
 │                       │        │←──{success}────────│
 │                       │←──{success}─────────────    │
 │                       │                             │
 │ [Can now authenticate with code ABC123]           │
 │ ├─[Send code to Jellyfin]───────────────────────→
 │ │                                                 │
 │ │←──{AccessToken, User}─────────────────────────│
 │ │                                                 │
 │ └─[Logged in! Can stream content]                │
```

---

## Data Flow for Authentication

### Session Data Structure

```javascript
req.session = {
  user: {
    Id: "jellyfin-user-id-uuid",
    Name: "john.doe",
    Email: "john@example.com",
    Policy: {
      IsAdministrator: false,
      IsDisabled: false,
      // ... other policies
    }
  },
  accessToken: "jellyfin-access-token",
  createdAt: 1705081200,
  lastActivity: 1705081205
}
```

### JWT Token Structure

```javascript
// Header
{
  "alg": "HS256",
  "typ": "JWT"
}

// Payload
{
  "sub": "jellyfin-user-id",
  "username": "john.doe",
  "email": "john@example.com",
  "role": "user",  // or "admin"
  "iat": 1705081200,
  "exp": 1705084800  // 1 hour later
}

// Signature
HMAC256(
  base64UrlEncode(header) + "." +
  base64UrlEncode(payload),
  "SECRET_KEY"
)
```

### Validate-SSO Response

```javascript
// When token is valid:
{
  "valid": true,
  "username": "john.doe",
  "email": "john@example.com",
  "isAdmin": false
}

// When token is invalid:
{
  "valid": false,
  "error": "Invalid token" | "Token expired" | "Invalid signature"
}
```

---

## Security Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                  SECURITY LAYER 1                        │
│                 (Authentication)                         │
│                                                           │
│  Input: Credentials or Token                            │
│  Output: User object + Session                          │
│                                                           │
│  ├─ Password hashing (Jellyfin handles)                │
│  ├─ JWT signature verification                         │
│  ├─ Expiration checking                                │
│  └─ API key validation                                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  SECURITY LAYER 2                        │
│                 (Session Management)                     │
│                                                           │
│  Input: Authenticated user                             │
│  Output: Session cookie                                │
│                                                           │
│  ├─ HTTP-only cookie (JS can't access)                │
│  ├─ Secure flag (HTTPS only in production)            │
│  ├─ SameSite=Strict (CSRF protection)                 │
│  └─ Session secret encryption                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                  SECURITY LAYER 3                        │
│                 (Request Validation)                     │
│                                                           │
│  Input: HTTP request with session                      │
│  Output: Authenticated request context                 │
│                                                           │
│  ├─ CSRF token validation                             │
│  ├─ Session existence check                           │
│  ├─ Route authorization                               │
│  └─ Audit logging                                     │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 Jellyfin Server                          │
│            (Authoritative User Store)                   │
│                                                           │
│  ├─ User creation/update                               │
│  ├─ Policy enforcement                                 │
│  ├─ Permission checking                                │
│  └─ Device authorization                               │
└─────────────────────────────────────────────────────────┘
```

---

## Complete Authentication State Machine

```
         ┌─────────────────┐
         │  Unauthenticated│
         │   (No session)  │
         └────────┬────────┘
                  │
                  │ POST /api/auth/login
                  │ with valid credentials
                  │
         ┌────────▼────────┐
         │   Jellyfin      │
         │   Validates     │
         │   Credentials   │
         └────────┬────────┘
                  │
      ┌───────────┴──────────┐
      │                      │
   Valid                  Invalid
      │                      │
      ▼                      ▼
┌─────────────┐      ┌──────────────┐
│ Session     │      │ Return 401   │
│ Created     │      │ "Invalid     │
│ Cookie Set  │      │  credentials"│
└──────┬──────┘      └──────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│    Authenticated                     │
│  (Session cookie in browser)         │
│                                      │
│  ├─ Can access /admin/*             │
│  ├─ Can access /api/users/*         │
│  ├─ Can authorize devices           │
│  └─ Session tracked in audit log    │
└────────────┬────────────────────────┘
             │
             │ POST /api/auth/logout
             │
             ▼
      ┌─────────────┐
      │  Session    │
      │  Destroyed  │
      │  Cookie     │
      │  Cleared    │
      └─────┬───────┘
            │
            ▼
      ┌──────────────┐
      │Unauthenticated
      └──────────────┘
```

---

## Integration Checklist

### Backend Infrastructure ✅

- [x] Express.js server running on port 3000
- [x] Session middleware configured with secure cookies
- [x] JWT token library (jsonwebtoken) installed
- [x] CSRF protection middleware
- [x] API key validation for plugin requests
- [x] Jellyfin API client for server communication
- [x] Audit logging system
- [x] Database for settings and audit logs

### Authentication Routes ✅

- [x] POST /api/auth/login - User login
- [x] POST /api/auth/logout - User logout
- [x] GET /api/auth/check - Check login status
- [x] **GET /api/auth/validate-sso** - Plugin validation
- [x] POST /api/auth/refresh-token - Token refresh
- [x] POST /api/auth/revoke-token - Token revocation

### Jellyfin Plugin ✅

- [x] Plugin.cs main class
- [x] SsoController.cs API controller
- [x] PluginConfiguration.cs with 8 properties
- [x] configPage.html web UI
- [x] API endpoints for validation
- [x] Error handling
- [x] Logging system

### Security Features ✅

- [x] HTTP-only cookies
- [x] CSRF protection
- [x] API key validation
- [x] JWT signature verification
- [x] Token expiration
- [x] Audit logging
- [x] Secure headers
- [x] Input validation

### Integration Documentation ✅

- [x] README with installation guide
- [x] BUILD_GUIDE with deployment steps
- [x] INTEGRATION_GUIDE with technical details
- [x] INTEGRATION_EXAMPLE.js with working code
- [x] AUTHENTICATION_INFRASTRUCTURE.md with complete explanation
- [x] This architecture diagram

---

## Summary

### Backend Infrastructure Status: ✅ COMPLETE

**All systems are in place:**
1. Web users authenticate via session cookies
2. Plugins authenticate via API key + JWT validation
3. Devices authenticate via QuickConnect with user authorization
4. All authentication flows integrate with Jellyfin server
5. Complete audit trail of all authentication events
6. Security measures prevent unauthorized access

**The `/api/auth/validate-sso` endpoint is fully implemented and ready to be called by the Jellyfin plugin for token validation and user creation.**
