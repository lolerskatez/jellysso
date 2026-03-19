# JellySSO vs JFA-Go: Comprehensive Assessment & Recommendations

**Date:** March 19, 2026  
**Prepared For:** JellySSO Development Team  
**Purpose:** Evaluate current JellySSO capabilities against JFA-Go and recommend enhancements

---

## Executive Summary

**JellySSO Status:** Mature platform with excellent architecture, comprehensive user management, and robust security infrastructure.

**Key Finding:** JellySSO has already implemented ~70% of JFA-Go's core features, but lacks several Polish & UX features that make JFA-Go popular. The recommendations focus on user-facing features, notification systems, and convenience enhancements that would elevate JellySSO from "functional" to "best-in-class."

---

## Part 1: Current JellySSO Codebase Assessment

### Architecture Strengths ✅

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Core Framework** | Excellent | Node.js/Express, clean MVC pattern, strong separation of concerns |
| **Database Layer** | Robust | SQLite with WAL mode, proper indexes, foreign key constraints |
| **Security** | Enterprise-Grade | CSRF protection, rate limiting, helmet.js, session rotation, audit logging |
| **Scalability** | Good | Session pooling, caching layers (LRU), distributed cache support |
| **API Design** | RESTful | Clean endpoint structure, proper HTTP status codes, standardized responses |
| **Testing** | Comprehensive | 36+ unit tests, integration tests, benchmarking suite |
| **Deployment** | Production-Ready | Docker support, environment configuration, health checks |

### Authentication & Authorization  ✅

**Current Capabilities:**
- ✓ Jellyfin native authentication
- ✓ OIDC/SSO integration with group-based admin mapping
- ✓ QuickConnect device pairing
- ✓ Session management (24-hour timeout, database-backed)
- ✓ CSRF protection with token validation
- ✓ Account lockout on failed login attempts
- ✓ Full audit trail of authentication attempts

**Assessment:** Excellent coverage. Comparable or superior to JFA-Go.

### User Management System ✅

**Current Capabilities:**
- ✓ CRUD operations for Jellyfin users
- ✓ Search and filtering with pagination
- ✓ User profile extension (email, custom fields)
- ✓ Bulk user operations (enable/disable/delete/tier changes)
- ✓ Activity tracking per user
- ✓ Admin permission enforcement
- ✓ User expiry with scheduled cleanup

**Assessment:** Well-implemented. Meets or exceeds JFA-Go's user management.

### Invite System ✅

**Current Capabilities:**
- ✓ InviteManager with token generation (JELLY-XXXX-XXXX format)
- ✓ SignupProfileManager for pre-configured tiers/settings
- ✓ Signup page with profile-based pre-fill
- ✓ Invite tracking and analytics
- ✓ Expiry enforcement (time or usage-based)
- ✓ Bulk invite generation
- ✓ Admin invite management UI

**Assessment:** Core functionality complete. Matches JFA-Go's invite system.

### Policy Management ✅

**Current Capabilities:**
- ✓ Tier-based streaming limits (Free/Standard/Premium/Family)
- ✓ Device whitelisting
- ✓ Concurrent stream limits
- ✓ Access scheduling (time-based windows)
- ✓ Account expiry enforcement
- ✓ Detailed policy audit logs
- ✓ Admin dashboard

**Assessment:** Superior to JFA-Go in depth and flexibility.

### Password Management ✅

**Current Capabilities:**
- ✓ Password reset via email
- ✓ Reset token with expiry (1 hour)
- ✓ Password strength indicator
- ✓ Rate limiting on reset requests
- ✓ Full audit logging
- ✓ Forgot password modal UI

**Assessment:** Excellent implementation. Comparable to JFA-Go.

### Notification System ⚠️ (Partial)

**Current Capabilities:**
- ✓ Email infrastructure (Nodemailer)
- ✓ Announcement system
- ✓ User contact fields (email tracked)
- ✓ Audit logging to file/database

**Missing/Incomplete:**
- ✗ Discord integration (not implemented)
- ✗ Telegram integration (not implemented)
- ✗ Matrix integration (not implemented)
- ✗ Automated event notifications (only manual announcements)
- ✗ User notification preferences
- ✗ Scheduled notification delivery

**Assessment:** Foundation exists, but integration is minimal.

---

## Part 2: JFA-Go Feature Analysis

### What Makes JFA-Go Popular

**1. User-Centric Features**
- **"My Account" Page**: Users can self-manage contact info, password, see account status
- **Referral System**: Users can invite friends (limited invites), gamified
- **User Notifications**: Proactive communication (expiry warnings, status changes)

**2. Contact & Communication**
- **Multi-channel Support**: Email, Discord, Telegram, Matrix 
- **Event-driven Notifications**: Post account state changes, expiry warnings
- **User Preferences**: Control how/when they're contacted

**3. Admin Convenience**
- **Customizable Messages**: All user-facing text editable (Markdown-supported)
- **Integration Hub**: Ombi/Jellyseerr sync, webhook support
- **Advanced Reporting**: User activity logs, import history

**4. Polish & UX**
- **Responsive Design**: Works great on mobile
- **Dark Mode**: Better for late-night admin work
- **Guided Setup Wizard**: Initial configuration is straightforward
- **Help Text Everywhere**: Every feature has documentation

---

## Part 3: Gap Analysis - Features to Implement

### High Priority (3-4 weeks)

#### 1. **Multi-Channel Notifications** ⭐⭐⭐
**Why:** JFA-Go's killer feature. Sets expectations for user engagement.

**Scope:**
- [ ] Discord bot integration (server/DM messaging)
- [ ] Telegram bot integration
- [ ] Matrix bot integration (optional, lower priority)
- [ ] User preference settings (opt-in/opt-out per channel)
- [ ] Scheduled delivery queue (prevent spam)

**Estimated Impact:** High - Makes system feel modern and responsive

**Implementation Path:**
1. Create `NotificationChannelManager` base class
2. Implement `DiscordNotificationAdapter`
3. Implement `TelegramNotificationAdapter`
4. Add user settings page for notification preferences
5. Hook into existing event system (invites, expiry, etc.)

**Effort:** 200-250 lines of core code + integrations

---

#### 2. **"My Account" User Page** ⭐⭐⭐
**Why:** Self-service reduces admin burden. Expected feature in modern apps.

**Current State:** Users can only see account info in "Membership" page  
**Desired State:** Full self-service: password change, contact update, account status, billing info

**Scope:**
```
/account (authenticated users only)
├── Account Information
│   ├── User ID, created date
│   ├── Account status (enabled/disabled/expiry date)
│   ├── Account type (Local vs SSO)
│   └── Download/export my data
├── Security
│   ├── Change password
│   ├── Active sessions (list and terminate)
│   ├── Login history (last 10 logins)
│   └── 2FA settings (if implemented)
├── Contact & Preferences
│   ├── Email address (edit)
│   ├── Phone number (for SMS, future)
│   ├── Notification preferences
│   │   ├── Email: ☑ Enabled
│   │   ├── Discord: ☐ Disabled
│   │   └── Telegram: ☐ Disabled
│   └── Bulk notification settings (all on/off)
└── Advanced
    ├── API keys (if using API)
    ├── Connected apps (SSO logins)
    └── Account deletion request
```

**Impact:** Makes system feel complete. Users gain autonomy.

**Effort:** 300-350 lines of code + UI

---

#### 3. **User Referral System** ⭐⭐
**Why:** Organic growth mechanism. Fun for users. Reduces admin invite load.

**Scope:**
- [ ] Each user gets N referral invites (e.g., 2-3)
- [ ] Can be customized per signup profile
- [ ] Tracking: who referred whom
- [ ] Incentives: bonus invites, badges, etc. (future)

**Implementation:**
```sql
ALTER TABLE invites ADD COLUMN referrer_user_id TEXT;
ALTER TABLE invites ADD COLUMN referrer_usage_remaining INT;
```

**Database Extension:**
- `invites.referrer_user_id` - Track which user generated invite
- `invites.referrer_usage_remaining` - How many times this user's referral can be used
- `user_profiles.referral_limit` - Total invites user has

**Impact:** Medium - Nice-to-have, but improves user retention

**Effort:** 150-200 lines of code

---

### Medium Priority (2-3 weeks)

#### 4. **Event-Driven Notification System** ⭐⭐
**Why:** Currently no automated notifications sent to users.

**Events to Capture:**
- [ ] Account created (welcome email)
- [ ] Account expiring in 7 days (reminder)
- [ ] Account disabled (notification)
- [ ] Account deleted (notification)
- [ ] Password reset requested (confirmation)
- [ ] Suspicious activity detected (security alert)
- [ ] Admin announcement published (broadcast)

**Implementation:**
```javascript
// EventEmitter pattern
emitter.on('user:created', (user, inviteData) => {
  NotificationManager.sendWelcome(user);
});

emitter.on('user:expiring_soon', (user, daysRemaining) => {
  NotificationManager.notifyExpiry(user, daysRemaining);
});
```

**Impact:** High - Significantly improves user experience

**Effort:** 250-300 lines of infrastructure code

---

#### 5. **Customizable Message Templates** ⭐⭐
**Why:** JFA-Go's strength. Admins can customize all user-facing text.

**Scope:**
- [ ] Message template management (admin page)
- [ ] Markdown support
- [ ] Variable interpolation (e.g., `{{userName}}`, `{{expiryDate}}`)
- [ ] Per-message customization: invite page, reset email, announcements, etc.

**Database Schema:**
```sql
CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,           -- 'invite_page', 'reset_email', etc.
  title TEXT,
  content TEXT,              -- Markdown-supported
  is_html BOOLEAN,
  variables JSON,            -- Available variables
  created_at DATETIME,
  updated_at DATETIME
);
```

**Impact:** Medium - Popular with admins who want to brand the experience

**Effort:** 200-250 lines of code + UI

---

#### 6. **Ombi/Jellyseerr Integration** ⭐
**Why:** Users often use both. Syncing solves the "duplicate account" problem.

**Scope:**
- [ ] Auto-sync username/password on user creation
- [ ] Sync contact details (email) bidirectionally
- [ ] Webhook support (Jellyseerr → JellySSO)

**Implementation:**
```javascript
// On new user created in JellySSO
JellyseerrAPI.createUser({
  username: jellySSO_user.username,
  email: jellySSO_user.email,
  // Password managed separately
});
```

**Impact:** Medium - High value for users with multiple services

**Effort:** 150-200 lines of code

---

### Lower Priority (1-2 weeks)

#### 7. **Enhanced Audit & Reporting**
**Why:** Admins love visibility. Currently have audit logs, but reporting is limited.

**Scope:**
- [ ] Admin dashboard with charts (user growth, invites used)
- [ ] Export audit logs (CSV)
- [ ] User activity timeline (last login, last stream, etc.)
- [ ] Invite analytics (conversion rate, time-to-accept)

**Impact:** Low-Medium - Nice-to-have for analytics

**Effort:** 150-200 lines of code

---

#### 8. **Dark Mode & UI Polish**
**Why:** JFA-Go has dark mode. Users expect it.

**Scope:**
- [ ] Dark theme CSS (Tailwind dark mode)
- [ ] Theme toggle in settings
- [ ] Auto-detect system preference

**Impact:** Low - Visual polish

**Effort:** 100-150 lines of CSS/JS

---

## Part 4: Feature Comparison Matrix

| Feature | JellySSO | JFA-Go | Gap | Priority |
|---------|----------|--------|-----|----------|
| **User Authentication** | ✅ Excellent | ✅ Good | None | - |
| **OIDC/SSO** | ✅ Yes | ✅ Yes | None | - |
| **User Management** | ✅ Excellent | ✅ Good | None | - |
| **Invite System** | ✅ Implemented | ✅ Implemented | None | - |
| **Signup Profiles** | ✅ Yes | ✅ (Profiles) | Minor | - |
| **Policy Management** | ✅ Superior | ⚠️ Limited | N/A | - |
| **Password Reset** | ✅ Yes | ✅ Yes | None | - |
| **Email Notifications** | ⚠️ Infrastructure only | ✅ Full events | **High** | High |
| **Discord Integration** | ❌ No | ✅ Yes | **High** | High |
| **Telegram Integration** | ❌ No | ✅ Yes | **Medium** | Medium |
| **Matrix Integration** | ❌ No | ✅ Yes | **Medium** | Medium |
| **"My Account" Page** | ⚠️ Partial (Membership) | ✅ Full | **High** | High |
| **User Referrals** | ❌ No | ✅ Yes | **Medium** | Medium |
| **Customizable Messages** | ❌ No | ✅ Yes | **Medium** | Medium |
| **Event Notifications** | ❌ No | ✅ Yes | **High** | High |
| **Ombi/Jellyseerr Sync** | ❌ No | ✅ Yes | **Medium** | Medium |
| **User Preferences** | ⚠️ Partial | ✅ Yes | **Medium** | Medium |
| **Dark Mode** | ❌ No | ✅ Yes | **Low** | Low |
| **Activity Logs** | ✅ Yes | ✅ Yes | None | - |
| **Bulk Operations** | ✅ Yes | ✅ Yes | None | - |
| **User Expiry** | ✅ Yes | ✅ Yes | None | - |

---

## Part 5: Detailed Recommendations

### Recommended Implementation Order

**Phase 1 (Weeks 1-2): High-Impact User Engagement**
1. Event-driven notification system (foundation)
2. Multi-channel notifications (Discord, Telegram)
3. "My Account" page enhancements

**Phase 2 (Weeks 3-4): User Self-Service & Convenience**
4. Customizable message templates
5. User referral system
6. Notification preferences page

**Phase 3 (Weeks 5-6): Admin Features & Polish**
7. Ombi/Jellyseerr integration
8. Enhanced audit reporting
9. Dark mode

### Quick Wins (Can Do First)
- ✅ Add "My Account" page with password change + contact management
- ✅ Implement Discord bot notifications (users love Discord)
- ✅ Event-driven email for account creation/expiry

### Architectural Considerations

**Notification Queue System**
```javascript
// Prevent notification spam
const notificationQueue = new PQueue({
  concurrency: 5,
  interval: 1000, // Throttle to 5 per second
  carryoverConcurrencyCount: true
});

// Queue all notifications
await notificationQueue.add(() => 
  NotificationManager.send(user, event, message)
);
```

**Event System Enhancement**
```javascript
// EventEmitter-based pattern already in place?
class NotificationEventEmitter extends EventEmitter {
  registerHandler(event, channel, handler) {
    this.on(event, (data) => this.routeNotification(data, channel, handler));
  }
}
```

---

## Part 6: Competitive Advantage Analysis

### JellySSO Strengths Over JFA-Go
1. **Policy Management** - More sophisticated tier/device controls
2. **Architecture** - Cleaner Node.js stack vs Go monolith
3. **Scalability** - Better positioned for large deployments
4. **OIDC Support** - Native OIDC provider, not just client
5. **Modern Stack** - Easier to extend and customize

### Areas to Address
1. **User Notifications** - JFA-Go has better event-driven system
2. **User Autonomy** - "My Account" page and self-service features
3. **Customization** - Message templates and preferences
4. **Integration** - Currently limited to Jellyfin; jfa-go integrates with Ombi/JellySeerr
5. **Documentation** - JFA-Go has better wiki/guides

---

## Part 7: Cost-Benefit Analysis

| Feature | Implementation Cost | User Value | Admin Value | Recommended? |
|---------|-----------------|-----------|------------|--------------|
| Multi-channel notifications | Medium (200 LOC) | Very High | High | ✅ YES |
| "My Account" page | Medium (300 LOC) | Very High | Medium | ✅ YES |
| Event notifications | Medium (250 LOC) | Very High | High | ✅ YES |
| Customizable messages | Medium (200 LOC) | Medium | Very High | ✅ YES |
| User referrals | Low (150 LOC) | High | Low | ⚠️ MAYBE |
| Ombi integration | Medium (150 LOC) | High | Medium | ✅ YES |
| Dark mode | Low (100 LOC) | Medium | Low | ⚠️ NICE-TO-HAVE |

---

## Part 8: Implementation Notes

### Don't Copy, Improve Upon
- JFA-Go's notification system is good; JellySSO should be better
- Build with rate limiting, preference handling, and retry logic
- Consider timezone support (users in different zones)
- Support notification scheduling (digest emails vs real-time)

### Technical Debt to Address First
- [ ] Review test coverage (ensure >80%)
- [ ] Performance test with 10K+ users
- [ ] Document all APIs (Swagger?)
- [ ] Security audit (especially notification integrations)

---

## Conclusion

**JellySSO is architecturally superior to JFA-Go.** The main gaps are user-facing convenience features and notification systems. Implementing the 8 recommendations would make JellySSO the best-in-class solution for Jellyfin SSO management.

**Estimated Total Effort:** 6-8 weeks for all features  
**Recommended Scope for MVP:** Top 3 features (2-3 weeks)

---

## Next Steps

1. **Review this assessment** - Confirm priorities and scope
2. **Meet with team** - Discuss which recommendations to prioritize
3. **Create detailed specs** - Define acceptance criteria for each feature
4. **Allocate resources** - Assign team members to features
5. **Begin Phase 1** - Start with notification system & "My Account" page

