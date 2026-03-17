# Policy Management - Quick Reference

## Files Created/Modified

```
NEW:
  src/models/PolicyManager.js              # Core policy manager
  src/routes/policy.js                     # API routes
  POLICY_API_DOCUMENTATION.md              # API docs
  POLICY_MANAGEMENT_GUIDE.md               # Implementation guide

MODIFIED:
  src/server.js                            # Added route registration
```

## Core Concepts

### PolicyManager Class

**Initialization**:
```javascript
const PolicyManager = require('./models/PolicyManager');

// Initialize schema on startup
await PolicyManager.initializeSchema();
```

**Main Methods**:
```javascript
// User Management
await PolicyManager.getUserPolicy(userId)          // Get user's policy
await PolicyManager.setUserTier(userId, tier)      // Set tier
await PolicyManager.getAvailableTiers()             // List all tiers

// Device Management
await PolicyManager.getWhitelistedDevices(userId)  // Get devices
await PolicyManager.whitelistDevice(userId, ...)   // Add device
await PolicyManager.unwhitelistDevice(userId, ...)  // Remove device
await PolicyManager.setDeviceWhitelistEnabled(...) // Toggle enforcement

// Access Scheduling
await PolicyManager.setAccessSchedule(userId, ...) // Set schedule
await PolicyManager.getAccessSchedule(userId)      // Get schedule
await PolicyManager.isAccessAllowed(userId)        // Check current access

// Audit & Compliance
await PolicyManager.getAuditLog(userId, limit)     // Get audit log
await PolicyManager.getAllPolicies()               // Admin: all policies
```

## API Quick Routes

### User Routes (Authenticated)
```
GET  /api/policy/user/policy                       # Get user policy
GET  /api/policy/user/audit-log                    # View audit log
POST /api/policy/user/device/whitelist             # Add device
DEL  /api/policy/user/device/whitelist/:deviceId   # Remove device
```

### Admin Routes (Admin + Auth)
```
GET  /api/policy/admin/policies                    # View all policies
POST /api/policy/admin/user/:id/tier               # Set tier
POST /api/policy/admin/user/:id/device-whitelist/enable     # Toggle device WL
POST /api/policy/admin/user/:id/access-schedule/enforce    # Toggle schedule
GET  /api/policy/admin/user/:id/audit-log         # View user audit
```

## Integration Example

### Using PolicyManager in Routes

```javascript
router.get('/api/policy/user/policy', requireAuth, async (req, res) => {
  try {
    // Get user policy
    const policy = await PolicyManager.getUserPolicy(req.session.user.Id);
    
    // Get whitelisted devices
    const devices = await PolicyManager.getWhitelistedDevices(req.session.user.Id);
    
    res.json({
      success: true,
      policy,
      devices
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});
```

### Using PolicyManager in Middleware

```javascript
// Playback enforcement middleware
async (req, res, next) => {
  const userId = req.session.user.Id;
  const policy = await PolicyManager.getUserPolicy(userId);
  
  // Check if user can access based on policy
  if (policy.deviceWhitelistEnabled) {
    const devices = await PolicyManager.getWhitelistedDevices(userId);
    const isWhitelisted = devices.some(d => d.deviceId === req.deviceId);
    if (!isWhitelisted) {
      return res.status(403).json({ error: 'Device not whitelisted' });
    }
  }
  
  // Check access schedule
  if (policy.enforceAccessSchedule) {
    const allowed = await PolicyManager.isAccessAllowed(userId);
    if (!allowed) {
      return res.status(403).json({ error: 'Outside allowed hours' });
    }
  }
  
  next();
}
```

## Database Tables at a Glance

### user_policies
| Column | Type | Purpose |
|--------|------|---------|
| userId | TEXT | Jellyfin user ID |
| tier | TEXT | free/standard/premium/family |
| maxConcurrentStreams | INT | Streams allowed (from tier) |
| deviceWhitelistEnabled | BOOL | Enforce device whitelist |
| enforceAccessSchedule | BOOL | Enforce time restrictions |

### device_whitelist
| Column | Type | Purpose |
|--------|------|---------|
| userId | TEXT | Owner of device |
| deviceId | TEXT | Unique device identifier |
| deviceName | TEXT | User-friendly name |
| deviceType | TEXT | web/mobile/tv/desktop |
| whitelistedAt | INT | Timestamp |
| lastUsedAt | INT | Last playback timestamp |

### policy_audit_log
| Column | Type | Purpose |
|--------|------|---------|
| userId | TEXT | Affected user |
| policyType | TEXT | TIER/DEVICE/SCHEDULE/ACCESS |
| action | TEXT | upgraded/added/removed/checked |
| reason | TEXT | Why change occurred |
| deviceId | TEXT | Related device (if any) |
| ipAddress | TEXT | Request source |
| createdAt | INT | Timestamp |

## Tier Configuration

```javascript
PolicyManager.TIERS = {
  'free': { maxStreams: 1 },
  'standard': { maxStreams: 2 },
  'premium': { maxStreams: 4 },
  'family': { maxStreams: 6 }
};
```

To change: Edit `src/models/PolicyManager.js` line ~30

## Common Tasks

### Check if User Can Stream

```javascript
async function canUserStream(userId, deviceId) {
  // Get policy
  const policy = await PolicyManager.getUserPolicy(userId);
  
  // Check device whitelist
  if (policy.deviceWhitelistEnabled) {
    const devices = await PolicyManager.getWhitelistedDevices(userId);
    if (!devices.some(d => d.deviceId === deviceId)) {
      throw new Error('Device not whitelisted');
    }
  }
  
  // Check access schedule
  if (policy.enforceAccessSchedule) {
    if (!await PolicyManager.isAccessAllowed(userId)) {
      throw new Error('Outside allowed hours');
    }
  }
  
  return true;
}
```

### Add Device for User

```javascript
async function registerDevice(userId, deviceInfo) {
  await PolicyManager.whitelistDevice(
    userId,
    deviceInfo.id,
    deviceInfo.name,
    deviceInfo.type
  );
  
  await AuditLogger.log(
    'POLICY_DEVICE_WHITELISTED',
    userId,
    'policy:device',
    { deviceId: deviceInfo.id },
    'success',
    req.ip
  );
}
```

### Admin: Upgrade User Tier

```javascript
async function setUserTier(userId, newTier) {
  const result = await PolicyManager.setUserTier(userId, newTier);
  
  await AuditLogger.log(
    'ADMIN_SET_USER_TIER',
    adminId,
    `admin:policy:${userId}`,
    { tier: newTier, maxStreams: result.maxStreams },
    'success',
    req.ip
  );
  
  return result;
}
```

## Error Handling

All API endpoints return:

**Success**:
```json
{ "success": true, "data": {...} }
```

**Error**:
```json
{ "success": false, "message": "Error description" }
```

**Common Errors**:
- `401`: Not authenticated
- `403`: Not authorized (admin only) or CSRF token invalid
- `400`: Bad request (missing params)
- `500`: Server error (check logs)

## Session Integration

When user logs in, their policy is attached to session:

```javascript
// After auth login
req.session.user = {
  Id: jellyfinUser.Id,
  Name: jellyfinUser.Name,
  Policy: await PolicyManager.getUserPolicy(jellyfinUser.Id)
};
```

This allows easy access in routes:
```javascript
const userTier = req.session.user.Policy.tier;
const maxStreams = req.session.user.Policy.maxConcurrentStreams;
```

## Testing the API

### Get User Policy
```bash
curl http://localhost:3000/api/policy/user/policy \
  -b cookies.txt
```

### Add Device
```bash
curl -X POST http://localhost:3000/api/policy/user/device/whitelist \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(curl http://localhost:3000/api/csrf-token | jq -r .csrf_token)" \
  -b cookies.txt \
  -d '{"deviceId":"web-1","deviceName":"Test","deviceType":"web"}'
```

### Admin: Set Tier
```bash
curl -X POST http://localhost:3000/api/policy/admin/user/user-123/tier \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(curl http://localhost:3000/api/csrf-token | jq -r .csrf_token)" \
  -b cookies.txt \
  -d '{"tier":"premium"}'
```

## Debugging

Enable detailed logging:
```javascript
// In server.js
logger.setLevel('debug');

// Check policy manager queries
console.log('User policy:', await PolicyManager.getUserPolicy(userId));
```

Check audit log directly:
```bash
sqlite3 jellysso.db "SELECT * FROM policy_audit_log ORDER BY createdAt DESC LIMIT 10;"
```

Check user policies:
```bash
sqlite3 jellysso.db "SELECT userId, tier, maxConcurrentStreams FROM user_policies;"
```

## Next Steps

1. **Create Frontend Components**: Build UI for policy management
2. **Add Unit Tests**: Test PolicyManager methods
3. **Implement Rate Limiting**: Prevent abuse of policy endpoints
4. **Add Playback Enforcement**: Integrate with playback routes
5. **Create Admin Dashboard**: View/manage user policies

## Resources

- [Full API Documentation](./POLICY_API_DOCUMENTATION.md)
- [Implementation Guide](./POLICY_MANAGEMENT_GUIDE.md)
- [System Architecture](./SYSTEM_ARCHITECTURE.md)
