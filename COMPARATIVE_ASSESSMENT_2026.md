# JellySSO vs JFA-Go: Comprehensive Comparative Assessment

**Date:** March 19, 2026  
**Assessment Updated:** Current Analysis  
**Scope:** User Management, Invite System, Admin UI, and System Settings

---

## Executive Summary

**JellySSO's Position:** A mature, production-ready platform with **superior architecture** compared to JFA-Go. JellySSO has already implemented ~75% of JFA-Go's feature set but with deeper technical sophistication and better security practices.

**Key Differences:**
- **JellySSO:** Focused on enterprise security, policy-based streaming limits, robust OIDC integration
- **JFA-Go:** Focused on user experience polish, third-party service integrations (Discord/Telegram/Matrix), lightweight approach

**Recommendation:** Instead of adopting JFA-Go's entire approach, selectively adopt its **user-facing convenience features** while maintaining JellySSO's superior architecture.

---

## Part 1: User Management Comparison

### JellySSO Current Implementation ✅

**Strengths:**
- **Bulk Operations:** Efficient SQL-based bulk enable/disable/delete
- **Audit Logging:** Complete tracking with IP addresses and timestamps
- **Search & Filtering:** Advanced pagination with search support
- **Tier Integration:** Native support for tier-based access control
- **Session-Based Context:** Leverages Jellyfin native user context

**Implementation Details:**
```javascript
// /src/routes/users.js - Efficient bulk operations
router.post('/bulk-action', async (req, res) => {
  // Delete/Enable/Disable multiple users atomically
  // Full audit trail captured
  // Tier-based profile application
});
```

**Gaps vs JFA-Go:**
- ❌ No "user labels" (custom categorization)
- ❌ No "referral system" (users inviting friends)
- ❌ Limited user-facing profile info
- ❌ No bulk "send announcement" feature

### JFA-Go's User Management Approach 📊

**Strengths:**
- **User Labels:** Tag users for organization (e.g., "Family", "Friends", "Founders")
- **Referral System:** Allow users to generate limited invites
- **User Display Details:** Show users their own expiry date, contact methods
- **Metadata Storage:** Flexible JSON fields for custom user data
- **Multi-Contact Methods:** Email, Discord, Telegram, Matrix unified handling

**Implementation Pattern:**
```go
// JFA-Go: users.go
type respUser struct {
    ID              string    `json:"id"`
    Name            string    `json:"name"`
    Email           string    `json:"email"`
    LastActive      time.Time `json:"last_active"`
    Expiry          time.Time `json:"expiry"`
    DiscordID       string    `json:"discord_id"`
    TelegramID      string    `json:"telegram_id"`
    MatrixID        string    `json:"matrix_id"`
    Label           string    `json:"label"`
    CustomReferral  string    `json:"custom_referral_template"`
    Disabled        bool      `json:"disabled"`
}
```

---

## Part 2: Invite System Comparison

### JellySSO Invite System ✅

**Current Features:**
- ✓ JELLY-XXXX-XXXX format codes
- ✓ Expiry (time or usage-based)
- ✓ Profile association
- ✓ Bulk generation (up to 1000)
- ✓ Tracking table with analytics
- ✓ Status tracking (pending/accepted)
- ✓ Usage counting

**Database Schema:**
```sql
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  signupProfileId TEXT,
  createdBy TEXT,
  expiresAt DATETIME,
  acceptedBy TEXT,
  status TEXT,
  usageCount INTEGER,
  metadata JSON
);
```

**Gaps vs JFA-Go:**
- ❌ No "pre-send to email" feature
- ❌ No "send via Discord" integration
- ❌ No invite analytics dashboard
- ❌ No "editable label" for tracking invites (e.g., "Spring2026", "Friends")
- ❌ No password enforcement for signups via invite

### JFA-Go Invite System 📊

**Superior Features:**
- ✓ **Pre-send to email/Discord:** Admin can send invites directly
- ✓ **Password Requirements:** Per-invite password strength enforcement
- ✓ **Editable Labels:** Label invites for tracking ("Founders", "Q1 Batch", etc.)
- ✓ **Invite Analytics:** Dashboard showing usage trends
- ✓ **SentTo Tracking:** Track which users the invite was sent to
- ✓ **Multiple Use Limits:** Set remaining uses, track per-invite
- ✓ **User Expiry Per Invite:** Set different expiry policies per invite

**API Pattern:**
```go
// api-invites.go: GenerateInvite()
type inviteDTO struct {
    Code          string    `json:"code"`
    ValidTill     time.Time `json:"valid_till"`
    Created       time.Time `json:"created"`
    Profile       string    `json:"profile"`
    Label         string    `json:"label"`          // NEW: Editable label
    UsedBy        map[string]time.Time `json:"used_by"` // Usage tracking
    RemainingUses int       `json:"remaining_uses"`  // NEW: Live counter
}

// Pre-send capability
func (s *jfService) SendInvite(code, email, discordID string) error { ... }
```

---

## Part 3: Admin UI Comparison

### JellySSO Admin Interface ✅

**Current Implementation:**
- Dashboard with policy overview
- User management with search/filter
- Invite generation modal
- Audit log viewer
- Settings configuration
- Policy editor

**Architecture:**
```typescript
// src/public/js/admin-*.js
// Traditional form-based UI
// REST API endpoints
// Server-rendered templates
```

**Gaps vs JFA-Go:**
- ❌ No tabbed interface for organization
- ❌ Limited user detail expansion
- ❌ No bulk announcement feature
- ❌ No invite batch operation UI
- ❌ No "activity timeline" for users

### JFA-Go Admin UI 📊

**Superior UX Features:**
- ✓ **Tabbed Organization:** Separate tabs for Invites, Accounts, Settings, Activity
- ✓ **User Detail Expansion:** Click-to-expand user rows with full details
- ✓ **Bulk Announcements:** Send markdown announcements to multiple users
- ✓ **Batch Invite Operations:** Edit multiple invites at once
- ✓ **Activity Timeline:** User-centric view of all events
- ✓ **Advanced Search:** Filter by multiple criteria
- ✓ **Invite Summary Cards:** Visual overview of invite stats
- ✓ **Responsive Tables:** Better mobile experience

**Frontend Architecture:**
```typescript
// ts/modules/accounts.ts: accountsList class
class accountsList {
  private users: respUser[];
  private filtered: respUser[];
  
  // Shows username, email, contact methods, last active
  // Click to expand full details including custom fields
  // Bulk actions: delete, enable/disable, apply settings, send announcement
}
```

---

## Part 4: System Settings Comparison

### JellySSO Settings ✅

**Current Implementation:**
- Configuration via environment variables
- Database-backed settings
- Runtime modifiable settings
- Settings validation

**Supported Settings:**
```javascript
// config/settings.js
- Jellyfin URL & authentication
- OIDC provider configuration
- Email SMTP settings
- Session timeout
- Rate limiting parameters
- Policy defaults
```

### JFA-Go Settings 📊

**Superior Configuration Approach:**
- ✓ **Dynamic UI Settings Panel:** No restart required for changes
- ✓ **Setting Dependencies:** Show/hide settings based on others
- ✓ **Categorized UI:** Organize settings by type
- ✓ **Advanced Toggle:** Hide complex settings by default
- ✓ **Persistence Layer:** Database-backed with hot-reload
- ✓ **Setting Groups:** Email, Discord, Ombi, Jellyseerr, etc.
- ✓ **Description/Help Text:** Inline documentation
- ✓ **Backup/Restore:** Full settings backup capability

**Configuration Pattern:**
```go
// config.go: Dynamic settings structure
type Settings struct {
    Jellyfin  JellyfinSettings
    UI        UISettings
    Email     EmailSettings
    Discord   DiscordSettings
    Ombi      OmbiSettings
    // ... with versioning and migrations
}

// Admin UI dynamically generates form from settings schema
```

---

## Part 5: Notification & Contact Method Integration

### JellySSO Current State ⚠️

**What Works:**
- Email infrastructure (Nodemailer)
- User email storage
- Password reset emails
- Announcement system

**Missing:**
- ❌ Discord contact method
- ❌ Telegram contact method
- ❌ Matrix contact method
- ❌ Automated notifications on user events
- ❌ Notification preferences

### JFA-Go Approach 📊

**Multi-Channel Contact System:**

1. **Discord Integration:**
   - Collect Discord ID during signup
   - Send invites via Discord DMs
   - Manage Discord roles (link to Jellyfin admin status)
   - Send account expiry notifications

2. **Telegram Integration:**
   - Collect Telegram ID during signup
   - Send password resets via Telegram
   - Account status notifications
   - Group notifications

3. **Matrix Integration:**
   - E2E encrypted contact method
   - Room-based notifications
   - Privacy-focused alternative

4. **Notification Triggers:**
   - User signup confirmation
   - Account expiry (with configurable reminders)
   - Account disabled/enabled
   - Password reset request
   - Invite accepted
   - Admin announcements

**Implementation:**
```go
// models.go: Unified contact management
type emailAddress struct {
    Addr       string
    Verified   bool
}
type DiscordUser struct {
    ID         string
    Role       string  // Admin role mapping
}
type TelegramUser struct {
    ID         string
    ChatID     string
}
type MatrixUser struct {
    UserID     string
    RoomID     string
}
```

---

## Part 6: Advanced Features Comparison

### Third-Party Integrations

| Feature | JellySSO | JFA-Go | Priority |
|---------|----------|--------|----------|
| Ombi/Jellyseerr Sync | ❌ Not implemented | ✅ Yes - sync username/password | Medium |
| Discord Role Management | ❌ No | ✅ Yes - roles mirror admin status | High |
| Activity Import | ⚠️ Partial | ✅ Full Jellyfin activity tracking | Medium |
| User Cache Optimization | ✅ LRU cache | ✅ Periodic refresh | Low |

### User Experience Features

| Feature | JellySSO | JFA-Go | Priority |
|---------|----------|--------|----------|
| User Referral System | ❌ No | ✅ Yes - limited share invites | Medium |
| Account Info Page | ❌ No | ✅ Yes - shows expiry, contact methods | High |
| Announcement System | ✅ Yes | ✅ Yes - with Markdown | Same |
| Bulk Actions UI | ✅ Basic | ✅ Advanced | Low |
| Invite Pre-send | ❌ No | ✅ Yes | High |
| Password Reset via "Forgot" | ✅ Yes | ✅ Yes | Same |

### Admin Convenience

| Feature | JellySSO | JFA-Go | Priority |
|---------|----------|--------|----------|
| User Labels | ❌ No | ✅ Yes | High |
| Activity Audit Log | ✅ Yes | ✅ Yes | Same |
| Bulk Email Send | ❌ No | ✅ Yes | Medium |
| Settings UI Panel | ✅ No restart | ✅ Better UX | Low |
| Backup/Restore | ✅ Docker volume | ✅ UI button | Low |

---

## Part 7: Security Comparison

### JellySSO Security ✅ **SUPERIOR**

**Advantages:**
- ✓ OIDC with group-based admin mapping (more secure)
- ✓ Policy-based access control (finer-grained)
- ✓ Account lockout with progressive backoff
- ✓ Rate limiting per endpoint
- ✓ CSRF protection with proper token lifecycle
- ✓ Session rotation on login
- ✓ Helmet.js security headers
- ✓ Request ID tracing for audit trail
- ✓ AES-256-GCM encryption for sensitive data

### JFA-Go Security ✅ **ADEQUATE**

**Approach:**
- Basic admin access control (allow_all vs admin_only)
- Session-based auth
- Email/Discord/Telegram verification
- Limited rate limiting
- Simpler audit trail

**Assessment:** JFA-Go prioritizes UX over security; JellySSO has better defaults.

---

## Part 8: Architecture Comparison

### JellySSO Architecture ✅ **SUPERIOR**

**Strengths:**
- **Node.js/Express:** Fast, event-driven, JavaScript ecosystem
- **SQLite with WAL:** Excellent for single-server deployments
- **Manager Pattern:** Consistent, testable code
- **Middleware Chain:** Clean separation of concerns
- **Comprehensive Testing:** 36+ unit tests, integration tests
- **Stateful Session Storage:** Database-backed, scalable
- **Plugin Architecture:** Hook-based extensibility

**Code Quality:**
```javascript
// DatabaseManager - abstraction layer
// AuditLogger - structured logging
// PolicyManager - business logic
// RBACManager - role-based access
// InviteManager - encapsulated invite logic
```

### JFA-Go Architecture 🟡 **ADEQUATE**

**Strengths:**
- **Go:** Fast compiled binary, concurrent processing
- **BadgerHold:** Embedded KV store
- **Command-line Friendly:** Easy scripting/automation
- **Self-contained:** Single binary deployment

**Weaknesses:**
- No strict separation of concerns (large API files)
- Monolithic API structure (api-*.go files are 1000+ lines each)
- Less modular frontend (TypeScript modules, but tightly coupled)

---

## Recommendations Summary

### 🎯 HIGH PRIORITY (Implement Now)

1. **Add Multi-Contact Methods** - Discord, Telegram, Matrix
   - **Impact:** Allows users to receive notifications in their preferred channel
   - **Effort:** Medium (requires new models, verification flows, notification system)
   - **Timeline:** 2-3 weeks
   - **JFA-Go Reference:** discord.go, telegram.go, matrix.go

2. **Enhance Invite System with Pre-send**
   - Add email/Discord pre-send capability
   - Add editable invite labels for organization
   - Add invite analytics/dashboard
   - **Impact:** Admins can distribute invites faster
   - **Effort:** Medium
   - **Timeline:** 1-2 weeks

3. **Add User "My Account" Page**
   - Show account expiry, contact methods
   - Allow users to change contact info
   - Show referral link (if enabled)
   - **Impact:** Users have transparency on their account
   - **Effort:** Medium
   - **Timeline:** 1 week

4. **Implement User Labels System**
   - Allow admins to tag users (e.g., "Family", "Friends", "Founders")
   - Use for filtering and bulk operations
   - **Impact:** Better user organization
   - **Effort:** Low
   - **Timeline:** 3-4 days

### 🟡 MEDIUM PRIORITY (Plan for Next Phase)

5. **Automated Event Notifications**
   - Send notifications on: user expiry (with reminders), account disabled, new invite used, etc.
   - Multi-channel (email/Discord/Telegram/Matrix)
   - **Impact:** Users stay informed without manual admin work
   - **Effort:** Medium-High
   - **Timeline:** 3-4 weeks

6. **Enhanced Admin UI**
   - Tabbed interface (Invites, Accounts, Settings, Activity)
   - Bulk announcement feature
   - User detail expansion modal
   - **Impact:** Better admin UX, faster operations
   - **Effort:** Low-Medium (mainly frontend)
   - **Timeline:** 2 weeks

7. **Third-Party Service Integration**
   - Ombi/Jellyseerr sync (username/password)
   - Discord role management based on admin status
   - **Impact:** Unified account management
   - **Effort:** Medium (if Ombi API is well-documented)
   - **Timeline:** 3-4 weeks

### 🟢 LOW PRIORITY (Nice-to-Have)

8. **User Referral System**
   - Allow users to generate limited invite codes to share
   - Does not require JFA-Go level integration
   - **Impact:** Community-driven growth
   - **Effort:** Low
   - **Timeline:** 1 week

9. **Settings UI Improvements**
   - Dynamic dependency-based showing/hiding
   - Better categorization
   - Reference documentation
   - **Impact:** Better UX for configuration
   - **Effort:** Low
   - **Timeline:** 1 week

10. **Activity Timeline View**
    - User-centric view of all events affecting them
    - Admin view of all system events
    - **Impact:** Better troubleshooting and audit trail
    - **Effort:** Low-Medium
    - **Timeline:** 1 week

---

## Implementation Strategy

### Phase 1: Foundation (Weeks 1-3)
1. Add multi-contact methods (Discord, Telegram, Matrix)
2. Implement user verification flow for new contact methods
3. Add notification system infrastructure

### Phase 2: Invite Enhancement (Weeks 4-5)
1. Add pre-send capabilities
2. Add invite labels and analytics
3. Update invite UI

### Phase 3: User Experience (Weeks 6-7)
1. Implement "My Account" page
2. Add user labels system
3. Enhance admin UI with tabs and bulk operations

### Phase 4: Integration & Polish (Weeks 8-10)
1. Third-party service integrations
2. Automated notifications
3. User referral system
4. Performance optimization

---

## Risk Assessment

### Risks of Adopting JFA-Go Wholesale
- ❌ Language migration (Go) would require full rewrite
- ❌ Lose Node.js ecosystem advantages
- ❌ Lose existing infrastructure (Docker, tests, auth integrations)
- ❌ JFA-Go has "active-ish" maintenance status
- ❌ Different architecture learning curve

### Risks of Recommended Approach
- ✅ Selective adoption maintains system coherence
- ✅ Incremental implementation reduces risk
- ✅ Preserves JellySSO's superior security
- ✅ Leverages existing team expertise

---

## Conclusion

**JellySSO is architecturally superior to JFA-Go**. Rather than adopting JFA-Go's entire system, we recommend:

1. **Keep JellySSO's architecture** - It's more secure and better designed
2. **Adopt JFA-Go's user-facing features** - Selectively implement the convenience features that make users and admins happier
3. **Maintain our development pace** - Implement features incrementally without full rewrites

**Expected Outcome:** A system that combines:
- JellySSO's **enterprise-grade security and architecture**
- JFA-Go's **user experience polish and convenience features**
- Our **superior policy management and streaming controls**

This positions JellySSO as the **best-in-class** Jellyfin user management solution outperforming both standalone implementations.

---

## Questions for Your Review

Before proceeding with implementation, please clarify:

1. **Contact Method Priority:** Which channels matter most? (Discord > Telegram > Matrix?)
2. **Timeline Flexibility:** Can we spread implementation over multiple months?
3. **Feature Scope:** Are third-party integrations important? (Ombi/Jellyseerr)
4. **User Referral:** Do you want users to be able to generate their own limited invites?
5. **Maintenance:** Who will own the notification system (ops vs dev)?

---

**Status:** Ready for Implementation Review  
**Next Step:** Await approval to begin Phase 1 implementation
