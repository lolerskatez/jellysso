# JellySSO vs JFA-Go: Comparative Analysis & Recommendations

**Date:** March 19, 2026  
**Status:** Analysis & Recommendations (No Changes Made Yet)  
**Purpose:** Identify valuable features from JFA-Go that could enhance JellySSO

---

## Executive Summary

JFA-Go is a Go-based user management companion for Jellyfin focused on **user onboarding, account lifecycle management, and communication**. JellySSO is a Node.js-based SSO companion focused on **authentication, authorization, and playback policy enforcement**. These are **complementary, not competing** solutions.

**Key Finding:** JFA-Go excels in user lifecycle management areas where JellySSO has minimal implementation. Both could be stronger together, or JellySSO could adopt some of JFA-Go's user management patterns.

---

## Part 1: Current JellySSO Assessment

### Strengths ✅
1. **Enterprise Security** - Helmet.js, CSRF, rate limiting, account lockout, AES-256 encryption
2. **Solid Architecture** - Modular design, database-backed sessions, comprehensive audit logging
3. **SSO Integration** - Full OIDC provider support (JFA-Go lacks this)
4. **Policy Engine** - Tier-based stream limiting, device whitelisting, access scheduling
5. **Production Ready** - Tested, documented, deployed

### Current Limitations ❌
1. **No Invite System** - No way to send invites to new users; they must already exist in Jellyfin
2. **No User Lifecycle Management** - No account expiry, deletion policies, or automated cleanup
3. **Minimal User Communication** - No email/Discord/Telegram integration for notifications
4. **Limited Account Management** - Users can't self-serve password resets with multiple methods
5. **No Bulk Operations** - Can't manage multiple users at once, apply settings in batch
6. **Basic Admin Dashboard** - Limited UI for managing users at scale
7. **No referral/sharing system** - Users can't invite friends

---

## Part 2: JFA-Go Feature Deep Dive

### 1. Invite System (FLAGSHIP FEATURE)

**What JFA-Go Does:**
- Generates time-limited invite links
- Tracks invite usage (expiry dates, usage limits)
- Applies "profiles" on signup (pre-configured Jellyfin settings)
- Email/Discord/Telegram integration for delivery
- CAPTCHA support
- Customizable invite messages with Markdown

**Why It's Valuable:**
- Solves cold-start problem: you can't get users without manual account creation
- Reduces admin burden: users self-serve account creation
- Customizable profiles mean different user types get different settings on signup
- Examples: Friend invites can have 30-day trial, Family members get specific library access

**Equivalent in JellySSO:**
- ❌ Does NOT exist

---

### 2. Password Reset Methods (4 APPROACHES)

**What JFA-Go Offers:**
1. **PIN via Jellyfin** - User clicks "Forget Password" in Jellyfin, JFA-Go sends PIN via email/Discord
2. **Link via Jellyfin** - Same, but simplifies to click-through link
3. **Internal Reset** - Bypasses Jellyfin PIN, uses JFA-Go-hosted reset form
4. **My Account Page** - Users reset password from "My Account" page without Jellyfin

**Why It's Valuable:**
- Users don't need to remember Jellyfin's confusing PIN flow
- Password requirements can be enforced (uppercase, special chars, etc.)
- Ombi passwords can be synced automatically

**Equivalent in JellySSO:**
- ✅ Basic password change in membership.ejs (current password required)
- ❌ No "forgot password" flow
- ❌ No contact method integration for resets

---

### 3. Contact Methods (Email, Discord, Telegram, Matrix)

**What JFA-Go Does:**
- Collects contact info on signup
- Sends notifications on:
  - Account expiry (before deletion)
  - Account disabled/enabled
  - Password reset links
  - Custom announcements (Markdown)
  - Jellyseerr/Ombi status changes
- Confirmation required for each contact method

**Why It's Valuable:**
- Users stay informed about account status
- Admins can communicate at scale without email lists
- Reduces support burden (notifications prevent surprise locks)

**Equivalent in JellySSO:**
- ❌ No contact method collection
- ❌ No notification system
- ✅ Audit logging tracks actions internally

---

### 4. User Expiry System

**What JFA-Go Offers:**
- Set expiry date on invite (e.g., 30-day trial)
- Automatic account disable/deletion on expiry
- Configurable behavior: disable-only, disable-then-delete, delete-immediately
- Pre-expiry notifications (5 days before, etc.)
- Dashboard shows when accounts expire

**Why It's Valuable:**
- Trial users automatically removed
- Reduces database clutter
- Completes lifecycle for temporary access
- Family members can be given fixed-term access

**Equivalent in JellySSO:**
- ❌ Does NOT exist
- Current approach: manual account deletion only

---

### 5. Bulk User Management

**What JFA-Go Offers:**
- Bulk enable/disable users
- Bulk delete users
- Bulk apply settings/profiles
- Send markdown announcements to multiple users
- Export user lists
- Filter by: enabled/disabled, expiry status, admin status

**Why It's Valuable:**
- Managing 100+ users at once
- Rolling updates (disable old users in bulk)
- Maintenance operations (annual license renewal, cleanup)

**Equivalent in JellySSO:**
- ⚠️ Partial - can create/update individual users
- ❌ No bulk operations
- ✅ Has search/filter in admin users page

---

### 6. "My Account" Page

**What JFA-Go Offers:**
- Unified user self-service portal (`/my/account`)
- Change password
- Update email/contact info
- View account status (expiry date, etc.)
- See referral code (if enabled)
- View personal information

**Why It's Valuable:**
- Reduces support tickets
- Users manage own account details
- Lower admin workload

**Equivalent in JellySSO:**
- ✅ Partial - `membership.ejs` covers some (profile, password change)
- ❌ No account status/expiry information
- ❌ No contact method management

---

### 7. Referral/User Invitation System

**What JFA-Go Offers:**
- Users can share limited invites with friends
- Tracked referral codes
- Can limit number of referrals per user
- Counts invites used via referral

**Why It's Valuable:**
- Viral growth loop (users recruit users)
- Organic expansion without admin involvement
- Tracks which user invited which

**Equivalent in JellySSO:**
- ❌ Does NOT exist

---

### 8. Customizable Messages

**What JFA-Go Offers:**
- Full Markdown support
- Customize text on:
  - Invite page ("Create Account")
  - "My Account" page
  - Success/error messages
  - Notification emails
- HTML email templates

**Why It's Valuable:**
- Brand your own instance
- Communicate terms/rules to users
- Professional appearance

**Equivalent in JellySSO:**
- ⚠️ Partial - hardcoded messages in code/EJS templates
- ❌ No admin UI for message customization
- ❌ No Markdown email support

---

### 9. Integration with Other Services

**What JFA-Go Offers:**
- **Ombi** - Sync usernames/passwords, keep accounts in sync
- **Jellyseerr** - Sync usernames/passwords and contact methods
- **Discord** - Bot integration for account actions
- **Telegram** - Bot integration
- **Matrix** - E2EE support

**Why It's Valuable:**
- Single place to manage ecosystem
- Less friction in your media server setup

**Equivalent in JellySSO:**
- ❌ None currently
- ✅ Can be added via plugin system

---

## Part 3: Architecture Comparison

| Aspect | JellySSO | JFA-Go | Winner |
|--------|----------|--------|--------|
| **Language** | Node.js/JS | Go | Go (faster, single binary) |
| **SSO/OIDC** | ✅ Full support | ❌ Native Jellyfin only | JellySSO |
| **Invite System** | ❌ None | ✅ Robust | JFA-Go |
| **Password Resets** | ⚠️ Basic | ✅ 4 methods | JFA-Go |
| **Notifications** | ❌ None | ✅ Multi-channel | JFA-Go |
| **User Expiry** | ❌ None | ✅ Automatic | JFA-Go |
| **Bulk Operations** | ❌ None | ✅ Supported | JFA-Go |
| **Policy Engine** | ✅ Streaming limits | ❌ None | JellySSO |
| **Audit Logging** | ✅ Comprehensive | ⚠️ Basic | JellySSO |
| **Plugin System** | ✅ Hook-based | ❌ None | JellySSO |
| **Deployment** | Docker/Node | Docker/Binary | Both solid |

---

## Part 4: Feature Recommendations for JellySSO

### MUST-HAVE (High Priority, High Impact)

#### 1. **Invite System** ⭐⭐⭐⭐⭐
**Current State:** None  
**Recommendation:** Implement invite system with:
- Time-limited invite links
- Usage limits (e.g., 1 invite, or 10 uses)
- Profile selection (apply policies on signup)
- Email delivery integration
- Success tracking and analytics

**Why:** Currently, new users must be manually created by admin. Without an invite system, JellySSO cannot support user-initiated onboarding.

**Complexity:** Medium (3-4 weeks)  
**Value:** Very High (removes blocker for growth)

---

#### 2. **User Expiry & Lifecycle** ⭐⭐⭐⭐
**Current State:** Manual deletion only  
**Recommendation:** Add:
- Expiry date per user (especially from invites)
- Configurable expiry action (disable/delete/disable-then-delete)
- Scheduled expiry checks (daily)
- Pre-expiry notifications (5 days before)
- Dashboard showing expiring users

**Why:** Trial users need automatic cleanup. Reduces admin effort and database clutter.

**Complexity:** Medium (2-3 weeks)  
**Value:** High (improves operations)

---

#### 3. **Contact Methods Integration** ⭐⭐⭐⭐
**Current State:** None  
**Recommendation:** Add:
- Email collection on signup/profile
- Discord, Telegram, Matrix support (async queues)
- Contact confirmation flow
- Notification system for: expiry alerts, account status changes, admin announcements
- Markdown message support

**Why:** Users stay informed, reduces support tickets. Key for user lifecycle.

**Complexity:** Medium-High (3-4 weeks with testing)  
**Value:** High (improves UX and reduces support)

---

### SHOULD-HAVE (Medium Priority, Medium Impact)

#### 4. **Bulk User Management** ⭐⭐⭐
**Current State:** Individual user management only  
**Recommendation:**
- Bulk enable/disable
- Bulk apply policies (tier, schedules, etc.)
- Bulk delete
- Send announcements to groups of users
- User export (CSV/JSON)

**Why:** Managing 100+ users becomes tedious with current interface.

**Complexity:** Low (1-2 weeks)  
**Value:** Medium (improves usability)

---

#### 5. **Improved "My Account" Page** ⭐⭐⭐
**Current State:** Partial - `membership.ejs` exists  
**Recommendation:**
- Show account status (enabled/disabled)
- Show expiry date if applicable
- Contact method management
- View personal activity log
- Generate/manage "device passwords" (already done for SSO users, generalize)

**Why:** Better UX, reduces support tickets.

**Complexity:** Low (1-2 weeks)  
**Value:** Medium-High (self-service reduces admin burden)

---

#### 6-7. **Password Reset Methods & "Forgot Password" Flow** ⭐⭐
**Current State:** User-initiated password change requires current password  
**Recommendation:**
- "Forgot Password" button on login
- Link-based reset via email
- Enhanced password policy enforcement
- (This could be simpler than JFA-Go's approach, just email-based)

**Why:** Users locked out can self-recover without admin help.

**Complexity:** Medium (2 weeks)  
**Value:** Medium (improves UX)

---

### NICE-TO-HAVE (Low Priority, Medium Impact)

#### 8. **Referral System** ⭐⭐
**Current State:** None  
**Recommendation:**
- Users can share limited invites with friends
- Track referral codes
- Display remaining referral count on "My Account" page

**Why:** Organic growth, community engagement.

**Complexity:** Low (1 week)  
**Value:** Low (growth accelerator, not core)

---

#### 9. **Third-Party Integrations** ⭐⭐
**Current State:** Plugin system exists  
**Recommendation:**
- Ombi/Jellyseerr sync plugins
- Discord/Telegram bot plugins
- Matrix integration plugin

**Why:** Unified ecosystem management.

**Complexity:** Medium per integration (2 weeks each)  
**Value:** Low-Medium (nice-to-have, depends on user needs)

---

## Part 5: Implementation Approach Options

### Option A: Enhance JellySSO (Recommended)
**Approach:** Add features from JFA-Go directly to JellySSO  
**Pros:**
- Single Node.js codebase (consistent with JellySSO)
- Keeps all SSO features (JFA-Go lacks these)
- Unified admin dashboard
- Leverages existing architecture (plugins, audit logging)

**Cons:**
- Larger codebase
- Requires significant development (6-8 weeks for must-haves)

**Timeline:** 2-3 months for must-haves + should-haves

---

### Option B: Deploy Both in Parallel
**Approach:** Keep JellySSO for SSO/policies, use JFA-Go for invites/lifecycle  
**Pros:**
- No development needed (use JFA-Go as-is)
- Battle-tested code (JFA-Go is mature)
- Can start immediately
- Separate concerns

**Cons:**
- Two admin dashboards to manage
- Duplicate audit logging
- Data sync issues possible
- Higher maintenance/operational burden

**Timeline:** Immediate

---

### Option C: Hybrid Approach
**Approach:** Add invites + expiry + contact methods to JellySSO; use JFA-Go for optional extras  
**Pros:**
- Focuses on critical gaps
- Lighter development effort (4 weeks vs 8 weeks)
- Still single dashboard
- Can add advanced features later

**Cons:**
- Some features built twice if both deployed

**Timeline:** 1-2 months for essentials

---

## Part 6: Risk Assessment

### Risks of Adding Features to JellySSO
1. **Scope Creep** - Invites + expiry + notifications is significant work
2. **Code Quality** - Must maintain current security standards
3. **Testing** - New features need comprehensive test coverage
4. **Documentation** - User + admin docs need updates

### Risks of Parallel Deployment (JellySSO + JFA-Go)
1. **Operator Complexity** - Two systems to maintain
2. **Data Consistency** - User credentials in both systems could go out of sync
3. **Double Admin Work** - Features configured in both places
4. **Deployment Issues** - More failure points in stack

---

## Part 7: Feature Matrix - What's Needed Where

| Feature | JellySSO Current | Recommendation | Priority | Effort |
|---------|------------------|-----------------|----------|--------|
| Invites | ❌ None | Add to JellySSO | MUST | 4 weeks |
| User Expiry | ❌ Manual only | Add to JellySSO | MUST | 3 weeks |
| Notifications | ❌ None | Add to JellySSO | MUST | 3 weeks |
| Bulk User Mgmt | ⚠️ Limited | Enhance JellySSO | SHOULD | 2 weeks |
| Better "My Account" | ⚠️ Partial | Enhance JellySSO | SHOULD | 2 weeks |
| Password Reset | ⚠️ Limited | Add to JellySSO | SHOULD | 2 weeks |
| Referrals | ❌ None | Add to JellySSO | NICE | 1 week |
| Customizable Messages | ⚠️ Hardcoded | Add to JellySSO | NICE | 1 week |

---

## Part 8: Recommended Implementation Plan (If Choosing Option A/C)

### Phase 1: Foundation (Weeks 1-3)
1. Invite system with database schema
2. Basic email delivery
3. Email confirmation flow
4. Integrate with signup form

### Phase 2: Lifecycle (Weeks 4-6)
1. User expiry with scheduler
2. Expiry actions (disable/delete)
3. Pre-expiry notifications
4. Dashboard for expiring users

### Phase 3: Communication (Weeks 7-9)
1. Discord/Telegram bot integration
2. Contact method management
3. Notification templates
4. Admin announcement system

### Phase 4: Enhancements (Weeks 10-12)
1. Bulk operations UI
2. Referral system
3. Message customization UI
4. Integration with Ombi (optional)

---

## Part 9: Code Structure Changes Needed

### New Files to Create
- `src/models/InviteManager.js` - Invite generation, tracking, validation
- `src/models/NotificationManager.js` - Email, Discord, Telegram delivery
- `src/models/UserExpiryManager.js` - Expiry scheduling and enforcement
- `src/routes/invites.js` - Invite endpoints
- `src/routes/notifications.js` - Admin notification endpoints
- `src/services/emailService.js` - Email template + delivery
- `src/services/discordService.js` - Discord bot integration
- `src/services/telegramService.js` - Telegram bot integration
- `views/invites.ejs` - Public invite signup form
- `public/js/invites.js` - Invite page logic
- `public/js/admin-invites.js` - Admin invite management

### Files to Modify
- `src/models/DatabaseManager.js` - Add invites, contact_methods, user_expiry tables
- `src/routes/auth.js` - Integrate invite system into signup
- `src/routes/admin.js` - Add invite/notification management
- `src/models/AuditLogger.js` - Log invite events
- `src/server.js` - Register new routes, initialize schedulers
- `package.json` - Add nodemailer, discord.js, telegraf dependencies

---

## Summary & Next Steps

**JFA-Go is an excellent reference implementation.** The invite system, user expiry, and multi-channel notifications are exactly what JellySSO needs to become a complete user management solution.

**Recommendation:** Implement Option A or C to enhance JellySSO with:
1. ✅ Invite system (blocking feature)
2. ✅ User expiry & lifecycle (operational necessity)
3. ✅ Contact methods & notifications (user experience)
4. ⚠️ Bulk operations & enhanced dashboard (quality of life)

**This will position JellySSO as a comprehensive user/auth management solution**, combining the best of both worlds:
- SSO/OIDC (JellySSO's strength)
- Policy enforcement (JellySSO's strength)
- User onboarding & lifecycle (JFA-Go's strength)
- Professional-grade security (JellySSO's strength)

---

## Questions for Your Review

1. **Are you interested in implementing these features in JellySSO, or prefer to run JFA-Go alongside?**
2. **What's your timeline for new features? (months available)**
3. **Which features are most critical for your use case?**
4. **Do you need Discord/Telegram support, or is email sufficient?**
5. **Should we prioritize single-click deploy improvements first?**

---

**Awaiting your feedback before proposing concrete implementation changes.**
