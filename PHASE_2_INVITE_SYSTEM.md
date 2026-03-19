# Phase 2: User Invite System Implementation Plan

**Status:** 🚀 Starting NOW  
**Scope:** Complete user lifecycle management with invites, profiles, and expiry  
**Est. Duration:** 4-5 weeks  
**Complexity:** Medium-High

---

## Overview

Phase 2 extends JellySSO with **powerful invite controls** and **user lifecycle management**. Admins can now:
- Create shareable invite links with custom expiry
- Define signup profiles (pre-configured Jellyfin tier, settings)
- Track invite usage and acceptance
- Enforce user expiry (auto-disable after date)
- Bulk clean up expired users

---

## Phase 2 Architecture

```
┌─────────────────────────────────────────────┐
│         Admin Creates Invite(s)             │
│  - Select signup profile                    │
│  - Set expiry (optional)                    │
│  - Generate shareable link                  │
└────────┬────────────────────────────────────┘
         │
         ├─► NotificationManager sends email/Discord
         │
┌────────▼─────────────────────────────────────┐
│     User Receives Invite Link                │
│   (email or copy-paste from admin panel)     │
└────────┬─────────────────────────────────────┘
         │
         ├─► Clicks link → /signup?invite=TOKEN
         │
┌────────▼─────────────────────────────────────┐
│   Signup Page (Pre-filled from Profile)      │
│  - Username field                            │
│  - Password setup                            │
│  - (Jellyfin tier pre-selected)              │
└────────┬─────────────────────────────────────┘
         │
         ├─► Validate invite + profile
         │
┌────────▼─────────────────────────────────────┐
│   Create User Account                        │
│  - Create in JellySSO + Jellyfin             │
│  - Apply signup profile (tier/settings)      │
│  - Mark user with expiry date (if set)       │
│  - Log audit event                           │
└────────┬─────────────────────────────────────┘
         │
         ├─► Auto-clean up on invite expiry date
         │
┌────────▼─────────────────────────────────────┐
│   User Lifecycle Management                  │
│  - Monitor user expiry date daily            │
│  - Send pre-expiry warning (7 days before)   │
│  - Auto-disable on expiry date               │
│  - Bulk cleanup (delete old disabled users)  │
└─────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 2.1: Core Invite System (Week 1)
- [ ] InviteManager (token generation, validation, acceptance)
- [ ] SignupProfileManager (presets/profiles)
- [ ] Invite API endpoints (create, list, revoke, track)
- [ ] Signup UI (public page for accepting invites)

### Phase 2.2: User Lifecycle (Week 2)
- [ ] User expiry field in database
- [ ] Expiry enforcement daemon (daily checks)
- [ ] Pre-expiry notifications (via NotificationManager)
- [ ] Bulk cleanup utilities

### Phase 2.3: Admin Panel Integration (Week 3)
- [ ] Admin UI for creating invites
- [ ] Admin UI for managing signup profiles
- [ ] Admin UI for viewing invite usage/stats
- [ ] Admin UI for managing user expiry

### Phase 2.4: Testing & Polish (Week 4)
- [ ] End-to-end testing
- [ ] Load testing (1000s of invites)
- [ ] Edge case handling
- [ ] Documentation updates

---

## Database Schema

### New Tables

#### `invites`
```sql
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  signupProfileId TEXT NOT NULL,
  createdBy TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  expiresAt DATETIME,
  acceptedBy TEXT,
  acceptedAt DATETIME,
  status TEXT DEFAULT 'pending',  -- pending, accepted, expired, revoked
  FOREIGN KEY (signupProfileId) REFERENCES signup_profiles(id),
  FOREIGN KEY (createdBy) REFERENCES users(id),
  FOREIGN KEY (acceptedBy) REFERENCES users(id)
);
```

#### `signup_profiles`
```sql
CREATE TABLE signup_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  jellefinTier TEXT,
  jellefinLibraryAccess JSON,
  jellefinPlaybackLimits JSON,
  customFields JSON,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME,
  isActive BOOLEAN DEFAULT 1
);
```

#### `user_expiry` (new column in users table)
```sql
ALTER TABLE users ADD COLUMN expiresAt DATETIME;
```

#### `user_lifecycle_events`
```sql
CREATE TABLE user_lifecycle_events (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  eventType TEXT,  -- created, expires_soon, expired, disabled
  eventDate DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata JSON,
  FOREIGN KEY (userId) REFERENCES users(id)
);
```

---

## Core Components to Build

### 1. InviteManager
**File:** `src/models/InviteManager.js`

**Responsibilities:**
- Generate unique invite codes (6-12 char, human-readable)
- Create invites with signup profiles
- Validate invite before signup
- Track acceptance
- Auto-expire invites
- Revoke invites

**Key Methods:**
```javascript
InviteManager.getInstance()
  .generateInvite(signupProfileId, createdBy, expiresAt)
  .validateInvite(code)  // throws if invalid/expired/revoked
  .acceptInvite(code, userId)
  .revokeInvite(code)
  .getInviteStats()  // count created, accepted, expired, etc
  .cleanupExpiredInvites()
```

### 2. SignupProfileManager
**File:** `src/models/SignupProfileManager.js`

**Responsibilities:**
- CRUD operations for signup profiles
- Pre-configured Jellyfin tier settings
- Library access templates
- Playback limit presets
- Default profiles (free tier, premium tier, etc)

**Key Methods:**
```javascript
SignupProfileManager.getInstance()
  .createProfile(name, config)
  .updateProfile(id, config)
  .deleteProfile(id)
  .getProfile(id)
  .listProfiles()
  .applyProfileToUser(userId, profileId)
```

### 3. UserExpiryManager
**File:** `src/models/UserExpiryManager.js`

**Responsibilities:**
- Set user expiry dates
- Daily check for expiring users
- Send pre-expiry notifications
- Auto-disable on expiry
- Bulk cleanup (delete old disabled users)

**Key Methods:**
```javascript
UserExpiryManager.getInstance()
  .setUserExpiry(userId, expiresAt)
  .sendExpiryWarnings()  // called daily
  .disableExpiredUsers()  // called daily
  .bulkCleanup(olderThanDays)
```

### 4. API Routes

#### Invite Routes (`/api/invites`)
```
GET    /api/invites                    - List all invites (admin)
POST   /api/invites                    - Create invite (admin)
PUT    /api/invites/:code              - Update invite (admin)
DELETE /api/invites/:code              - Revoke invite (admin)
POST   /api/invites/:code/track        - Track usage (public)
GET    /api/invites/validate/:code     - Validate invite (public)
```

#### Signup Profile Routes (`/api/signup-profiles`)
```
GET    /api/signup-profiles            - List profiles (admin)
POST   /api/signup-profiles            - Create profile (admin)
PUT    /api/signup-profiles/:id        - Update profile (admin)
DELETE /api/signup-profiles/:id        - Delete profile (admin)
GET    /api/signup-profiles/:id        - Get profile details (public)
```

#### User Lifecycle Routes (`/api/users/lifecycle`)
```
GET    /api/users/lifecycle            - List user lifecycle (admin)
POST   /api/users/:id/expiry           - Set user expiry (admin)
DELETE /api/users/:id/expiry           - Clear user expiry (admin)
POST   /api/users/lifecycle/cleanup    - Bulk cleanup (admin)
```

### 5. UI Components

#### Signup Page (`/signup?invite=CODE`)
```
- Public page (no auth required)
- Auto-populate tier from profile
- Username + password fields
- Optional custom fields from profile
- Accept Terms + Privacy
- Submit → Create user
```

#### Admin Invite Panel
```
- Create new invite(s)
- Select signup profile
- Set custom expiry (optional)
- Bulk generate (10, 100, 1000 invites)
- Copy/share links
- View usage stats
- Revoke invites
- Recently accepted tracking
```

#### Admin Profile Panel
```
- Create new signup profiles
- Edit tier + permissions
- Duplicate existing profile
- View usage (how many signups)
- Preview what user will see
```

---

## Implementation Sequence

### Step 1: Database Schema
```bash
# Auto-create on app startup (like we do for other tables)
- invites table
- signup_profiles table
- user_lifecycle_events table
- Alter users table to add expiresAt
```

### Step 2: Core Managers
1. InviteManager (token generation, lifecycle)
2. SignupProfileManager (CRUD, presets)
3. UserExpiryManager (expiry tracking, notifications)

### Step 3: API Routes
1. Invite management endpoints
2. Signup profile endpoints
3. User lifecycle endpoints
4. Public signup validation endpoint

### Step 4: Signup Flow
1. Create public `/signup` page
2. Validate invite code on page load
3. Auto-populate profile settings
4. User creation on submit
5. Redirect to login on success

### Step 5: Admin UI
1. Invite creation panel
2. Invite tracking/stats
3. Signup profile manager
4. User expiry settings

### Step 6: Automation
1. Daily expiry check daemon
2. Pre-expiry notifications (7 days before)
3. Auto-disable on expiry
4. Cleanup schedule

---

## Default Signup Profiles

Recommend starting with these presets:

### Profile 1: "Free Trial"
```json
{
  "name": "Free Trial",
  "description": "1-month trial account",
  "jellefinTier": "basic",
  "jellefinLibraryAccess": ["movies", "tv"],
  "jellefinPlaybackLimits": {
    "maxConcurrentStreams": 1,
    "maxBitrate": "1080p"
  }
}
```

### Profile 2: "Premium"
```json
{
  "name": "Premium",
  "description": "Full access account",
  "jellefinTier": "premium",
  "jellefinLibraryAccess": ["movies", "tv", "music"],
  "jellefinPlaybackLimits": {
    "maxConcurrentStreams": 4,
    "maxBitrate": "4K"
  }
}
```

### Profile 3: "Family"
```json
{
  "name": "Family",
  "description": "Family plan - 3 users",
  "jellefinTier": "family",
  "jellefinLibraryAccess": ["all"],
  "jellefinPlaybackLimits": null
}
```

---

## Integration with Phase 1

### Reusing Phase 1 Components:
- ✅ **NotificationManager** - Send invite emails + expiry warnings
- ✅ **AuditLogger** - Log all invite actions
- ✅ **DatabaseManager** - Auto-create new tables
- ✅ **PolicyManager** - Apply profile policies to users

### New NotificationManager Templates:
- `INVITE_CREATED` - Admin creates invite
- `INVITE_ACCEPTED` - User accepts invite
- `USER_EXPIRES_SOON` - User has 7 days left
- `USER_EXPIRED` - Auto disable notification

---

## Success Criteria

Phase 2 is complete when:

- ✅ Admins can create shareable invite links
- ✅ Invites can have custom expiry dates
- ✅ Users can sign up via invite link
- ✅ Signup auto-configures Jellyfin tier from profile
- ✅ Users can be set with expiry dates
- ✅ System auto-notifies before expiry
- ✅ System auto-disables expired users
- ✅ Admin can view invite stats and usage
- ✅ Full audit logging of all actions
- ✅ E2E tests pass for full workflow
- ✅ Load test with 10K invites
- ✅ Documentation complete

---

## Ready to Start?

**Next action:** Confirm if you want to proceed with implementation:

1. ✅ Start with InviteManager
2. ✅ Then SignupProfileManager
3. ✅ Then UserExpiryManager
4. ✅ Then API routes
5. ✅ Then UI components
6. ✅ Then integration + testing

**ETA:** 4-5 weeks for full completion

**Should I begin?** 🚀

