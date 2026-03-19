# Policy-to-Jellyfin Synchronization Guide

## Overview
This document explains how JellySSO policies are synchronized with Jellyfin and what happens when policies are updated.

## Policy Synchronization Status

### ✅ Synchronized to Jellyfin

#### 1. Account Status (Enable/Disable)
- **JellySSO Field**: `accountEnabled`
- **Jellyfin Field**: `IsDisabled`
- **How It Works**: When an admin disables a user account or sets an expiry date, JellySSO sends the `IsDisabled` flag to Jellyfin
- **Endpoint**: `POST /api/policy/admin/user/:userId/account-status`
- **Sync Enabled**: ✅ Yes
- **Location**: `src/routes/policy.js` lines 257-293

**Example Request**:
```bash
POST /api/policy/admin/user/user-123/account-status
{
  "enabled": false
}
```

**Jellyfin Update**:
```javascript
await jellyfin.updateUserPolicy(userId, { IsDisabled: true });
```

---

#### 2. Tier / Stream Limit
- **JellySSO Field**: `tier`, `maxConcurrentStreams`
- **Jellyfin Field**: `SimultaneousStreamLimit`
- **How It Works**: When an admin changes a user's tier, the stream limit is immediately sent to Jellyfin, which enforces it natively
- **Endpoint**: `POST /api/policy/admin/user/:userId/tier`
- **Sync Enabled**: ✅ Yes
- **Location**: `src/models/PolicyManager.js` lines 180-220

**Example Request**:
```bash
POST /api/policy/admin/user/user-123/tier
{
  "tier": "standard"
}
```

**JellySSO Flow**:
1. Update local database with tier and maxConcurrentStreams
2. Call `jellyfin.updateUserPolicy(userId, { SimultaneousStreamLimit: tierConfig.maxConcurrentStreams })`
3. Jellyfin enforces the stream limit natively

---

### ⚠️ JellySSO-Only Policies (Not Synced to Jellyfin)

These features are enforced by JellySSO at the playback level, not stored in Jellyfin:

#### 1. Device Whitelist
- **JellySSO Field**: `deviceWhitelistEnabled`
- **Jellyfin Support**: ❌ Not supported natively
- **How It Works**: JellySSO maintains a list of whitelisted device IDs in its database and checks them at playback time
- **Endpoint**: `POST /api/policy/admin/user/:userId/device-whitelist/enable`
- **Enforcement**: Checked in `src/models/PolicyManager.js` - `canStartStream()` method

**Flow**:
1. Admin enables device whitelist for user
2. JellySSO stores this setting in local database
3. When user attempts to play content, JellySSO checks if device is whitelisted
4. If NOT whitelisted, playback is blocked (Jellyfin doesn't know about this)

---

#### 2. Access Schedule  
- **JellySSO Field**: `enforceAccessSchedule`
- **Jellyfin Support**: ❌ Not supported natively (though Jellyfin has AccessSchedules API, we implement custom logic)
- **How It Works**: JellySSO checks current time against user's access schedule at playback time
- **Endpoint**: `POST /api/policy/admin/user/:userId/access-schedule/enforce`
- **Enforcement**: Checked in `src/models/PolicyManager.js` - `isInAccessWindow()` method

**Flow**:
1. Admin enables access schedule enforcement for user
2. JellySSO stores this setting in local database
3. When user attempts to play content, JellySSO checks if current time is within allowed window
4. If outside window, playback is blocked (Jellyfin doesn't know about this)

---

## Troubleshooting

### "User is disabled in JellySSO but not in Jellyfin"

**Check**:
1. Verify the account-status endpoint was called: Check logs for `ADMIN_ACCOUNT_STATUS_CHANGED`
2. Verify Jellyfin API connection: Test with `curl -X GET http://jellyfin:8096/System/Info -H "Authorization: Bearer YOUR_API_KEY"`
3. Check error logs for: `"Could not mirror account status to Jellyfin"`

**Solution**:
- Ensure Jellyfin API key is correct in `src/config/settings.json`
- Ensure Jellyfin is reachable and running
- Try manually updating via Jellyfin API:
  ```bash
  curl -X POST http://jellyfin:8096/Users/USER_ID/Policy \
    -H "Authorization: Bearer YOUR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"IsDisabled": true}'
  ```

---

### "Stream limit not taking effect in Jellyfin"

**Check**:
1. Verify tier was set: Check logs for `ADMIN_SET_USER_TIER`
2. Check that the stream limit was sent to Jellyfin
3. Verify Jellyfin picked up the change for the user

**Solution**:
- Ensure user's tier exists and has correct maxConcurrentStreams value
- Verify Jellyfin API key is correct
- Test manually:
  ```bash
  curl -X GET http://jellyfin:8096/Users/USER_ID/Policy \
    -H "Authorization: Bearer YOUR_API_KEY"
  ```

---

### "Device whitelist is not being enforced"

**Note**: Device whitelist is a JellySSO-only feature. It's not stored in Jellyfin.

**Check**:
1. Verify the setting is enabled in JellySSO database: `SELECT deviceWhitelistEnabled FROM user_policies WHERE userId = 'USER_ID'`
2. Verify at least one device is whitelisted: `SELECT * FROM device_whitelist WHERE userId = 'USER_ID'`
3. Check playback logs for device validation: Search logs for `deviceWhitelistEnabled`

**Solution**:
- Ensure device whitelist is enabled for the user
- Ensure the device attempting playback has whitelisted its deviceId
- Check that the playback request includes the correct deviceId

---

### "Access schedule is not being enforced"

**Note**: Access schedule is a JellySSO-only feature. It's not stored in Jellyfin.

**Check**:
1. Verify the setting is enabled: `SELECT enforceAccessSchedule FROM user_policies WHERE userId = 'USER_ID'`
2. Check access schedule rules in database
3. Verify current time is being calculated correctly

**Solution**:
- Ensure access schedule enforcement is enabled for the user
- Verify schedule rules exist and have correct time windows
- Check server time synchronization (if server time is wrong, schedule checks will fail)

---

## API Reference

### Jellyfin User Policy Fields
When syncing to Jellyfin, these fields are commonly updated:

```javascript
{
  "IsDisabled": false,              // Account enabled/disabled
  "SimultaneousStreamLimit": 2,     // Max concurrent streams
  "IsAdministrator": false,          // Admin flag
  "EnableMediaPlayback": true,       // Allow playback
  "IsHidden": false,                 // Hidden user
  "EnableContentDeletion": false,    // Can delete content
  "EnableSync": false,               // Can sync
  "EnableLiveTvAccess": false,       // Live TV access
  ... other policy flags
}
```

See Jellyfin API documentation for full Policy object schema.

---

## Best Practices

1. **Always check Jellyfin connectivity** before making policy changes
2. **Use audit logs** to verify that changes were applied: Check `policy_audit` table
3. **Test changes** by attempting playback immediately after policy update
4. **Monitor logs** for Jellyfin sync errors (non-blocking warnings are okay)
5. **Document custom policies**: Device whitelist and access schedules are JellySSO-specific

---

## Implementation Details

### Where Policies Are Enforced

| Policy | Where Enforced | Jellyfin Role |
|--------|----------------|---------------|
| Account Enable/Disable | Jellyfin (via IsDisabled) + JellySSO (blocks auth) | Enforces IsDisabled |
| Stream Limit | Jellyfin (via SimultaneousStreamLimit) | Enforces limit natively |
| Device Whitelist | JellySSO playback check | Not involved |
| Access Schedule | JellySSO playback check | Not involved |

---

## Recent Changes (Latest)

### 2025-03-19: Improved Jellyfin Synchronization
- Added explicit logging for device whitelist and access schedule changes
- Updated error handling to be non-blocking (local changes succeed even if Jellyfin sync fails)
- Improved response messages to indicate Jellyfin synchronization status
- Added warnings (not errors) when Jellyfin sync fails for JellySSO-specific policies
