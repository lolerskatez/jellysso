# Policy Management System - Implementation Guide

## Overview

The Policy Management System has been fully integrated into JellySSO. This guide explains the components, how they work together, and how to use them.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (UI Layer)                       │
│  - User dashboard (policy settings, device management)       │
│  - Admin dashboard (user policies, audit logs)               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    API Layer (Routes)                        │
│  - POST   /api/policy/user/device/whitelist                 │
│  - DELETE /api/policy/user/device/whitelist/:id             │
│  - GET    /api/policy/user/policy                           │
│  - GET    /api/policy/user/audit-log                        │
│  - POST   /api/policy/admin/user/:id/tier (admin only)      │
│  - GET    /api/policy/admin/policies (admin only)           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Business Logic Layer                        │
│              PolicyManager (src/models)                      │
│  - Tier management                                           │
│  - Device whitelisting                                       │
│  - Access scheduling                                         │
│  - Audit logging                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Data Layer (Database)                      │
│  - user_policies table                                       │
│  - device_whitelist table                                    │
│  - access_schedule table                                     │
│  - policy_audit_log table                                    │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── models/
│   ├── PolicyManager.js              # Core policy logic
│   └── AuditLogger.js               # Audit trail logging
├── routes/
│   └── policy.js                    # API endpoints
└── server.js                        # Route registration
```

## Key Features

### 1. User Tier Management

**Purpose**: Control the number of concurrent streams a user can have

**Tiers**:
- **Free**: 1 concurrent stream
- **Standard**: 2 concurrent streams  
- **Premium**: 4 concurrent streams
- **Family**: 6 concurrent streams (extensible)

**Usage**:
```javascript
// User checks their current tier
GET /api/policy/user/policy
→ { policy: { tier: "premium", maxConcurrentStreams: 4 } }

// Admin sets user tier
POST /api/policy/admin/user/:userId/tier
{ "tier": "premium" }
```

### 2. Device Whitelisting

**Purpose**: Only allow playback on approved devices

**How it works**:
1. User generates a device ID on their device
2. User submits device for whitelisting
3. Device is added to user's whitelist
4. Only whitelisted devices can play content

**Usage**:
```javascript
// User adds device to whitelist
POST /api/policy/user/device/whitelist
{
  "deviceId": "web-abc123",
  "deviceName": "Living Room TV",
  "deviceType": "web"
}

// User views whitelisted devices
GET /api/policy/user/policy
→ { whitelistedDevices: [...] }

// User removes device
DELETE /api/policy/user/device/whitelist/:deviceId
```

### 3. Access Scheduling

**Purpose**: Restrict playback to specific times (optional)

**Configuration**:
- Days of week (0 = Sunday, 6 = Saturday)
- Start time (HH:mm format)
- End time (HH:mm format)
- Timezone

**Status**: Available but not enforced in current version  
**Next Steps**: Integration with playback middleware

### 4. Audit Logging

**Purpose**: Track all policy-related actions

**Logged Events**:
- User tier changes
- Device whitelisting/removal
- Access schedule updates
- Admin policy modifications
- Failed policy checks

**Usage**:
```javascript
// User views their audit log
GET /api/policy/user/audit-log
→ { 
  logs: [
    { type: "TIER", action: "upgraded", timestamp: "..." },
    { type: "DEVICE", action: "added", timestamp: "..." }
  ]
}

// Admin views user's audit log
GET /api/policy/admin/user/:userId/audit-log
```

## Integration Points

### 1. Authentication Flow

When user logs in:
```
1. User authenticates via /api/auth/login
2. Session created with user.Id
3. User's policy is loaded from database
4. Policy attached to session: req.session.user.Policy
```

### 2. Playback Initiation

When user starts playback:
```
1. Request to /api/admin/playback/start/:id
2. Middleware checks req.session.user.Policy
3. Verifies tier limit not exceeded
4. Verifies device is whitelisted (if enabled)
5. Verifies current time is within access window
6. Playback approved or rejected
```

### 3. Session Management

Policy changes are reflected immediately:
```
1. Admin changes user tier
2. AuditLogger records the change
3. User's next request loads updated policy
4. Enforcement applies on next playback attempt
```

## Database Tables

### user_policies
```sql
-- Stores user-level policy settings
CREATE TABLE user_policies (
  id INTEGER PRIMARY KEY,
  userId TEXT UNIQUE,             -- Jellyfin user ID
  tier TEXT DEFAULT 'standard',   -- free|standard|premium|family
  maxConcurrentStreams INTEGER,   -- Derived from tier
  deviceWhitelistEnabled BOOLEAN,
  enforceAccessSchedule BOOLEAN,
  createdAt INTEGER,              -- Unix timestamp
  updatedAt INTEGER               -- Unix timestamp
);
```

### device_whitelist
```sql
-- Stores whitelisted devices for users
CREATE TABLE device_whitelist (
  id INTEGER PRIMARY KEY,
  userId TEXT,
  deviceId TEXT,                  -- Unique device identifier
  deviceName TEXT,                -- User-friendly name
  deviceType TEXT,                -- web|mobile|tv|desktop
  whitelistedAt INTEGER,
  lastUsedAt INTEGER,
  UNIQUE(userId, deviceId)
);
```

### access_schedule
```sql
-- Stores access time windows per user
CREATE TABLE access_schedule (
  id INTEGER PRIMARY KEY,
  userId TEXT UNIQUE,
  dayOfWeek INTEGER,              -- 0-6 (Sun-Sat)
  startTime TEXT,                 -- HH:mm
  endTime TEXT,                   -- HH:mm
  timezone TEXT DEFAULT 'UTC'
);
```

### policy_audit_log
```sql
-- Audit trail for all policy changes
CREATE TABLE policy_audit_log (
  id INTEGER PRIMARY KEY,
  userId TEXT,
  policyType TEXT,                -- TIER|DEVICE|SCHEDULE|ACCESS
  action TEXT,                    -- upgraded|added|removed|etc
  reason TEXT,
  deviceId TEXT,
  sessionId TEXT,
  ipAddress TEXT,
  createdAt INTEGER
);
```

## API Reference Quick Guide

### For Users

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/policy/user/policy` | GET | Get current policy |
| `/api/policy/user/audit-log` | GET | View policy audit |
| `/api/policy/user/device/whitelist` | POST | Add device |
| `/api/policy/user/device/whitelist/:id` | DELETE | Remove device |

### For Admins

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/policy/admin/policies` | GET | View all policies |
| `/api/policy/admin/user/:id/tier` | POST | Set user tier |
| `/api/policy/admin/user/:id/device-whitelist/enable` | POST | Toggle whitelist |
| `/api/policy/admin/user/:id/access-schedule/enforce` | POST | Toggle schedule |
| `/api/policy/admin/user/:id/audit-log` | GET | View user audit |

## Security Features

1. **CSRF Protection**: All POST/PUT requests require valid X-CSRF-Token
2. **Authentication**: All endpoints require active session
3. **Authorization**: Admin-only endpoints check for admin flag
4. **Audit Trail**: Every policy change is logged
5. **Rate Limiting**: Consider implementing rate limiting on policy endpoints
6. **Encryption**: Device IDs and secrets stored securely

## Implementation Checklist

- [x] PolicyManager model created
- [x] Database schema defined
- [x] API routes implemented
- [x] Authentication/authorization
- [x] Audit logging
- [x] API documentation
- [ ] Frontend UI components
- [ ] Admin dashboard
- [ ] Unit tests
- [ ] Integration tests
- [ ] Rate limiting middleware
- [ ] Access schedule enforcement

## Testing the Implementation

### 1. Verify Database Tables

```bash
# Check if tables exist
sqlite3 jellysso.db ".tables"
# Should show: user_policies, device_whitelist, access_schedule, policy_audit_log
```

### 2. Test User Policy Endpoint

```bash
# Get CSRF token
curl http://localhost:3000/api/csrf-token

# Get user policy
curl -X GET http://localhost:3000/api/policy/user/policy \
  -b cookies.txt

# Add device
curl -X POST http://localhost:3000/api/policy/user/device/whitelist \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: token-here" \
  -b cookies.txt \
  -d '{"deviceId":"web-1","deviceName":"Test","deviceType":"web"}'
```

### 3. Test Admin Endpoints

```bash
# Get all policies
curl -X GET http://localhost:3000/api/policy/admin/policies \
  -b cookies.txt

# Set user tier
curl -X POST http://localhost:3000/api/policy/admin/user/user-123/tier \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: token-here" \
  -b cookies.txt \
  -d '{"tier":"premium"}'
```

## Configuration

Policy tiers can be customized by editing `PolicyManager.TIERS`:

```javascript
static TIERS = {
  'free': {
    name: 'Free',
    maxStreams: 1,
    description: 'Single stream only'
  },
  'standard': {
    name: 'Standard',
    maxStreams: 2,
    description: 'Two simultaneous streams'
  },
  'premium': {
    name: 'Premium',
    maxStreams: 4,
    description: 'Four simultaneous streams'
  }
};
```

## Troubleshooting

### Tables not created
- Check database connection in DatabaseManager
- Run `PolicyManager.initializeSchema()` on startup
- Check server logs for errors

### CSRF token errors
- Ensure session is initialized before CSRF check
- Verify cookie configuration in express-session
- Check X-CSRF-Token header is being sent

### Policy not enforced
- Check that `PolicyManager` instance is initialized
- Verify user.Policy is attached to session
- Check playback middleware for policy checks

### Audit logs not appearing
- Verify `AuditLogger.log()` is being called
- Check database insert permissions
- Review policy_audit_log table

## Next Steps

1. **Create Frontend UI**:
   - User dashboard for policy settings
   - Device management interface
   - Admin dashboard for policy management

2. **Add Rate Limiting**:
   - Rate limit policy changes
   - Rate limit device whitelist modifications

3. **Implement Access Scheduling**:
   - Enforcement middleware
   - UI for setting time windows
   - Timezone support

4. **Add Tests**:
   - Unit tests for PolicyManager
   - Integration tests for API endpoints
   - Playback enforcement tests

5. **Performance Optimization**:
   - Cache policy settings
   - Batch audit log writes
   - Index policy queries

## Additional Resources

- [Policy API Documentation](./POLICY_API_DOCUMENTATION.md)
- [Architecture Overview](./SYSTEM_ARCHITECTURE.md)
- [Security Guide](./SECURITY.md)
- [Database Setup Guide](./DEPLOYMENT_GUIDE.md)
