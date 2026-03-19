# Phase 2 Quick Start Guide

## 🚀 Testing Phase 2: Invites & User Management

All Phase 2 core features are now live. Here's how to test them.

---

## View 1: Create Invites

### Create Single Invite (30-day expiry)
```bash
curl -X POST http://localhost:3000/api/invites \
  -H "Content-Type: application/json" \
  -d '{
    "signupProfileId": "free-trial",
    "expiryDays": 30
  }'
```

**Response:**
```json
{
  "success": true,
  "invites": [
    {
      "id": "uuid",
      "code": "JELLY-XXXX-XXXX",
      "signupProfileId": "free-trial",
      "createdAt": "2026-03-19T...",
      "expiresAt": "2026-04-19T...",
      "status": "pending"
    }
  ]
}
```

### Bulk Create 100 Invites
```bash
curl -X POST http://localhost:3000/api/invites \
  -H "Content-Type: application/json" \
  -d '{
    "signupProfileId": "premium",
    "count": 100,
    "expiryDays": 60
  }'
```

---

## View 2: Create Signup Profiles

### Create "Student" Profile
```bash
curl -X POST http://localhost:3000/api/signup-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Student Plan",
    "description": "Limited access for students",
    "jellyfinTier": "basic",
    "jellyfinLibraryAccess": ["movies", "tv"],
    "jellyfinPlaybackLimits": {
      "maxConcurrentStreams": 1,
      "maxBitrate": "1080p"
    }
  }'
```

### List All Profiles
```bash
curl http://localhost:3000/api/signup-profiles
```

### Update Profile
```bash
curl -X PUT http://localhost:3000/api/signup-profiles/{profileId} \
  -H "Content-Type: application/json" \
  -d '{
    "jellyfinPlaybackLimits": {
      "maxConcurrentStreams": 2,
      "maxBitrate": "2160p"
    }
  }'
```

---

## View 3: Test Signup Flow

### Get Invite Code
```bash
# From create invite response, get: JELLY-XXXX-XXXX
INVITE_CODE="JELLY-XXXX-XXXX"
```

### Test in Browser
Open URL in your browser:
```
http://localhost:3000/signup?invite=JELLY-XXXX-XXXX
```

**What you'll see:**
1. Invite validation (automatic)
2. Profile details displayed
3. Username field
4. Email field (optional)
5. Password field with strength indicator
6. Submit button

**Test Flow:**
1. Enter username: `testuser1`
2. Enter password: `TestPassword123!`
3. Confirm password same
4. Click "Create Account"
5. Get redirected to login page

### Login with New Account
```
Username: testuser1
Password: TestPassword123!
```

---

## View 4: Manage User Expiry

### Set User Expiry (30 days)
```bash
# First, get USER_ID from new user
ADMIN_TOKEN="your-admin-jwt-token"
USER_ID="jellyfin-user-id"

# Set expiry to 30 days from now
curl -X POST http://localhost:3000/api/users/{USER_ID}/expiry \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "expiresAt": "2026-04-19T00:00:00Z",
    "reason": "auto_from_invite"
  }'
```

### Get User Expiry Status
```bash
curl http://localhost:3000/api/users/expiry/stats \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

Response:
```json
{
  "success": true,
  "stats": {
    "totalWithExpiry": 5,
    "active": 4,
    "expired": 0,
    "expiringWithin7Days": 1
  }
}
```

### Clear User Expiry
```bash
curl -X DELETE http://localhost:3000/api/users/{USER_ID}/expiry \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

## View 5: Admin Actions

### Get Invite Statistics
```bash
curl http://localhost:3000/api/invites/stats
```

Response:
```json
{
  "success": true,
  "stats": {
    "total": 150,
    "pending": 120,
    "accepted": 25,
    "expired": 3,
    "revoked": 2
  }
}
```

### Revoke an Invite
```bash
curl -X DELETE http://localhost:3000/api/invites/JELLY-XXXX-XXXX \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

### Manually Trigger Expiry Warnings
```bash
curl -X POST http://localhost:3000/api/users/expiry/send-warnings \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

### Bulk Cleanup Old Users
```bash
curl -X POST http://localhost:3000/api/users/expiry/cleanup \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "olderThanDays": 90
  }'
```

Response:
```json
{
  "success": true,
  "message": "Deleted 5 users",
  "deletedCount": 5
}
```

---

## 🗂️ Default Signup Profiles

These are auto-created on first run:

### 1. Free Trial
- 30-day trial  
- 1 concurrent stream
- 1080p max
- Movies & TV only

### 2. Premium
- No expiry
- 4 concurrent streams
- 4K max
- All libraries

### 3. Family
- No expiry
- Unlimited streams
- All libraries
- No limits

---

## 📊 Monitoring

### View Database Directly
```bash
# List all active invites
SELECT * FROM invites WHERE status = 'pending' ORDER BY createdAt DESC LIMIT 20;

# List all profiles
SELECT id, name, jellyfinTier, isActive FROM signup_profiles ORDER BY name;

# List users with expiry
SELECT id, username, expiresAt FROM users WHERE expiresAt IS NOT NULL ORDER BY expiresAt;

# View lifecycle events for a user
SELECT * FROM user_lifecycle_events WHERE userId = '{USER_ID}' ORDER BY eventDate DESC;
```

---

## 🔧 Troubleshooting

### Invite Code Won't Validate
✓ Check: `SELECT * FROM invites WHERE code = 'JELLY-...'`  
✓ Verify: status = 'pending' and expiresAt IS NULL or >= now()  
✓ Try: Regenerate new invite

### Signup Form Not Loading
✓ Check invite code in URL (copy-paste from API response)  
✓ Check browser console for errors  
✓ Try: Different browser/incognito mode

### User Not Created
✓ Check: Auth endpoint `/api/auth/signup` for errors  
✓ Verify: Profile exists and invite is valid  
✓ Check: Jellyfin is reachable

### Expiry Daemon Not Running
✓ Check: Server logs contain "User expiry daemon started"  
✓ Try: Restart server  
✓ Manually trigger: `POST /api/users/expiry/send-warnings`

---

## 📝 Automated Testing Script

```bash
#!/bin/bash

# Create profile
PROFILE=$(curl -s -X POST http://localhost:3000/api/signup-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Profile '$(date +%s)'",
    "jellyfinTier": "basic"
  }' | jq -r '.profile.id')

echo "✓ Profile created: $PROFILE"

# Create 5 invites
for i in {1..5}; do
  INVITE=$(curl -s -X POST http://localhost:3000/api/invites \
    -H "Content-Type: application/json" \
    -d '{
      "signupProfileId": "'$PROFILE'",
      "expiryDays": 30
    }' | jq -r '.invites[0].code')
  
  echo "  ✓ Invite $i: $INVITE"
done

# Get stats
echo ""
echo "📊 Stats:"
curl -s http://localhost:3000/api/invites/stats | jq '.stats'
```

---

## 🎯 Next Steps

1. **Test Signups** - Create invites, share links, sign up
2. **Test Expiry** - Set user expiry, wait for warnings (or manually trigger)
3. **Test Bulk Actions** - Create 100+ invites, test cleanup
4. **Test Admin APIs** - Revoke, update profiles, view stats

---

## 📚 Commands Reference

| Action | Command |
|--------|---------|
| Create invite | `POST /api/invites` |
| List invites | `GET /api/invites` |
| Validate invite | `GET /api/invites/:code` |
| Revoke invite | `DELETE /api/invites/:code` |
| Create profile | `POST /api/signup-profiles` |
| List profiles | `GET /api/signup-profiles` |
| Update profile | `PUT /api/signup-profiles/:id` |
| Set expiry | `POST /api/users/:id/expiry` |
| Get expiry stats | `GET /api/users/expiry/stats` |
| Clear expiry | `DELETE /api/users/:id/expiry` |

---

**Ready to test? Start with: `POST /api/invites` to generate your first invite!** 🚀
