# Policy Management API Documentation

## Overview

The Policy Management API provides a comprehensive system for controlling user access to streaming resources. It includes:

- **User Tier Management**: Control concurrent streaming limits
- **Device Whitelisting**: Restrict playback to approved devices
- **Access Scheduling**: Enforce time-based access restrictions
- **Audit Logging**: Track all policy-related actions

---

## API Endpoints

### User Endpoints

#### 1. Get User Policy Settings
```
GET /api/policy/user/policy
```

**Authentication**: Required (user must be logged in)

**Response**:
```json
{
  "success": true,
  "policy": {
    "tier": "premium",
    "maxConcurrentStreams": 4,
    "deviceWhitelistEnabled": true,
    "enforceAccessSchedule": false
  },
  "whitelistedDevices": [
    {
      "deviceId": "device-uuid-123",
      "deviceName": "Living Room TV",
      "deviceType": "web",
      "whitelistedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "availableTiers": ["free", "standard", "premium", "family"]
}
```

**Tiers**:
- `free`: 1 concurrent stream
- `standard`: 2 concurrent streams
- `premium`: 4 concurrent streams
- `family`: 6 concurrent streams

---

#### 2. Get User Audit Log
```
GET /api/policy/user/audit-log?limit=50
```

**Authentication**: Required

**Query Parameters**:
- `limit` (optional): Number of records to return (default: 50, max: 500)

**Response**:
```json
{
  "success": true,
  "logs": [
    {
      "type": "TIER",
      "action": "upgraded",
      "reason": "auto_upgrade_on_subscription",
      "device": null,
      "timestamp": "2024-01-15T10:30:00Z"
    },
    {
      "type": "DEVICE_WHITELIST",
      "action": "device_added",
      "reason": "user_request",
      "device": "device-uuid-123",
      "timestamp": "2024-01-14T15:45:00Z"
    }
  ]
}
```

---

#### 3. Add Device to Whitelist
```
POST /api/policy/user/device/whitelist
```

**Authentication**: Required (user must be logged in)

**Headers**:
- `X-CSRF-Token`: Required (obtain from `/api/csrf-token`)
- `Content-Type`: application/json

**Request Body**:
```json
{
  "deviceId": "web-browser-abc123",
  "deviceName": "Chrome - Home Laptop",
  "deviceType": "web"
}
```

**Device Types**:
- `web`: Web browser
- `mobile`: Mobile app
- `tv`: Smart TV app
- `desktop`: Desktop app

**Response**:
```json
{
  "success": true,
  "message": "Device whitelisted: Chrome - Home Laptop"
}
```

**Error Response** (duplicate device):
```json
{
  "success": false,
  "message": "Device already whitelisted"
}
```

---

#### 4. Remove Device from Whitelist
```
DELETE /api/policy/user/device/whitelist/:deviceId
```

**Authentication**: Required

**Response**:
```json
{
  "success": true,
  "message": "Device removed from whitelist"
}
```

---

### Admin Endpoints

#### 1. Get All User Policies
```
GET /api/policy/admin/policies
```

**Authentication**: Required (admin only)

**Response**:
```json
{
  "success": true,
  "policies": [
    {
      "userId": "user-1",
      "tier": "premium",
      "maxConcurrentStreams": 4,
      "deviceWhitelistEnabled": true,
      "enforceAccessSchedule": false,
      "whitelistedDeviceCount": 2,
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "totalUsers": 42,
  "availableTiers": ["free", "standard", "premium", "family"]
}
```

**Audit Log**:
- Event Type: `ADMIN_VIEW_ALL_POLICIES`
- Policy Count tracked

---

#### 2. Set User Tier
```
POST /api/policy/admin/user/:userId/tier
```

**Authentication**: Required (admin only)

**Headers**:
- `X-CSRF-Token`: Required

**Request Body**:
```json
{
  "tier": "premium"
}
```

**Response**:
```json
{
  "success": true,
  "message": "User tier set to premium",
  "tier": "premium",
  "maxStreams": 4
}
```

**Valid Tiers**: `free`, `standard`, `premium`, `family`

**Audit Log**:
- Event Type: `ADMIN_SET_USER_TIER`
- Tracks: New tier, max streams

---

#### 3. Enable/Disable Device Whitelist
```
POST /api/policy/admin/user/:userId/device-whitelist/enable
```

**Authentication**: Required (admin only)

**Headers**:
- `X-CSRF-Token`: Required

**Request Body**:
```json
{
  "enabled": true
}
```

**Response**:
```json
{
  "success": true,
  "message": "Device whitelist enforcement enabled for user",
  "deviceWhitelistEnabled": true
}
```

**Audit Log**:
- Event Type: `ADMIN_DEVICE_WHITELIST_TOGGLE`
- Tracks: Enabled/disabled state

---

#### 4. Enable/Disable Access Schedule
```
POST /api/policy/admin/user/:userId/access-schedule/enforce
```

**Authentication**: Required (admin only)

**Headers**:
- `X-CSRF-Token`: Required

**Request Body**:
```json
{
  "enforce": true
}
```

**Response**:
```json
{
  "success": true,
  "message": "Access schedule enforcement updated for user",
  "enforceAccessSchedule": true
}
```

**Audit Log**:
- Event Type: `ADMIN_ACCESS_SCHEDULE_TOGGLE`
- Tracks: Enforce state

---

#### 5. Get User Audit Log (Admin)
```
GET /api/policy/admin/user/:userId/audit-log?limit=100
```

**Authentication**: Required (admin only)

**Query Parameters**:
- `limit` (optional): Number of records to return (default: 100, max: 500)

**Response**:
```json
{
  "success": true,
  "userId": "user-1",
  "logs": [
    {
      "type": "TIER",
      "action": "upgraded",
      "reason": "auto_upgrade_on_subscription",
      "device": null,
      "session": "session-123",
      "ipAddress": "192.168.1.100",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

**Cause**: Not logged in or session expired

---

### 403 Forbidden
```json
{
  "success": false,
  "message": "Admin access required"
}
```

**Cause**: User is not an admin (for admin endpoints)

---

### 400 Bad Request
```json
{
  "success": false,
  "message": "tier is required"
}
```

**Cause**: Missing or invalid request parameters

---

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Failed to retrieve policy settings"
}
```

**Cause**: Server-side error (check logs)

---

## Implementation Examples

### JavaScript/Fetch Example

#### Get User Policy
```javascript
// Get CSRF token first
const csrfResponse = await fetch('/api/csrf-token');
const { csrf_token } = await csrfResponse.json();

// Get user policy
const response = await fetch('/api/policy/user/policy');
const data = await response.json();

if (data.success) {
  console.log('Current tier:', data.policy.tier);
  console.log('Max concurrent streams:', data.policy.maxConcurrentStreams);
  console.log('Whitelisted devices:', data.whitelistedDevices);
}
```

#### Whitelist Device
```javascript
const response = await fetch('/api/policy/user/device/whitelist', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({
    deviceId: 'web-' + Date.now(),
    deviceName: 'My Laptop',
    deviceType: 'web'
  })
});

const data = await response.json();
if (data.success) {
  console.log('Device whitelisted!');
}
```

#### Admin: Set User Tier
```javascript
const response = await fetch('/api/policy/admin/user/user-123/tier', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken
  },
  body: JSON.stringify({
    tier: 'premium'
  })
});

const data = await response.json();
console.log(`User tier updated to ${data.tier} (max ${data.maxStreams} streams)`);
```

### cURL Examples

#### Get User Policy
```bash
curl -X GET http://localhost:3000/api/policy/user/policy \
  -H "Cookie: connect.sid=sessionid"
```

#### Add Device to Whitelist
```bash
curl -X POST http://localhost:3000/api/policy/user/device/whitelist \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: your-csrf-token" \
  -H "Cookie: connect.sid=sessionid" \
  -d '{
    "deviceId": "device-123",
    "deviceName": "Living Room TV",
    "deviceType": "tv"
  }'
```

#### Admin: Set Tier
```bash
curl -X POST http://localhost:3000/api/policy/admin/user/user-123/tier \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: your-csrf-token" \
  -H "Cookie: connect.sid=sessionid" \
  -d '{"tier": "family"}'
```

---

## Integration with Playback

The policy management system integrates with playback limiting to enforce concurrent stream limits.

### Playback Rate Limiting Middleware

When a user attempts to start a new stream:

1. **User tier is checked** against `maxConcurrentStreams`
2. **Active sessions** for the user are counted
3. **If limit exceeded**, the playback is rejected with `403 Forbidden`
4. **Access is logged** in the audit trail

Example error response when stream limit exceeded:
```json
{
  "success": false,
  "message": "Concurrent stream limit reached",
  "detail": "Your tier allows 2 streams, you have 2 active",
  "policy": {
    "tier": "standard",
    "maxConcurrentStreams": 2,
    "activeSessions": 2
  }
}
```

---

## Database Schema

### users_policies Table
```sql
CREATE TABLE users_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL UNIQUE,
  tier TEXT DEFAULT 'free',
  discoveryUpdateDate INTEGER,
  maxConcurrentStreams INTEGER,
  deviceWhitelistEnabled BOOLEAN DEFAULT 0,
  enforceAccessSchedule BOOLEAN DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

### device_whitelist Table
```sql
CREATE TABLE device_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  deviceId TEXT NOT NULL,
  deviceName TEXT,
  deviceType TEXT,
  whitelistedAt INTEGER NOT NULL,
  lastUsedAt INTEGER,
  UNIQUE(userId, deviceId)
);
```

### access_schedule Table
```sql
CREATE TABLE access_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL UNIQUE,
  dayOfWeek INTEGER,
  startTime TEXT,
  endTime TEXT,
  timezone TEXT DEFAULT 'UTC'
);
```

### policy_audit_log Table
```sql
CREATE TABLE policy_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  policyType TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  deviceId TEXT,
  sessionId TEXT,
  ipAddress TEXT,
  createdAt INTEGER NOT NULL
);
```

---

## Security Considerations

1. **CSRF Protection**: All POST/PUT endpoints require valid X-CSRF-Token
2. **Authentication**: All endpoints require active session
3. **Authorization**: Admin endpoints check for admin flag in policy
4. **Rate Limiting**: Policy changes are audited and logged
5. **Device Tracking**: Device IDs should be unique per session/installation
6. **Audit Trail**: All policy changes are logged with timestamp and IP

---

## Future Enhancements

- [ ] Time-based access scheduling with timezone support
- [ ] Geolocation-based device restrictions
- [ ] Quality/bitrate limiting per tier
- [ ] Bandwidth limiting
- [ ] Dynamic tier assignment based on subscription
- [ ] Integration with payment systems
- [ ] Advanced analytics dashboard
