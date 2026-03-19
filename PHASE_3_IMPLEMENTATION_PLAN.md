# Phase 3: High-Priority Features Implementation Plan

**Date:** March 19, 2026  
**Status:** Ready for Implementation  
**Estimated Timeline:** 4-5 weeks (160-200 development hours)  
**Priority:** CRITICAL - Core user experience enhancements

---

## Implementation Overview

This phase implements 4 interconnected systems that work together:

```
Message Templates ──────┐
                        ├──→ Event System ──→ Notification Manager ──→ Multi-Channel Adapters
User Profile/Settings ──┤                                                  ├── Discord
                        ├──→ "My Account" Page                             ├── Telegram
                        │                                                  └── Email (enhanced)
Database Schemas ───────┐
```

---

## Dependency Chain & Implementation Order

### Foundation First (Week 1-2)
1. **Message Template System** - All notifications use this
2. **Event System Enhancement** - Central hub for all events
3. **Notification Queue System** - Prevents spam, manages retries
4. **Database Schema Updates** - Add all new columns/tables

### Services Next (Week 2-3)
5. **Notification Manager Rewrite** - Route to multiple channels
6. **Discord Adapter** - Bot integration
7. **Telegram Adapter** - Bot integration
8. **Email Adapter Enhancements** - Use templates

### User Features (Week 3-4)
9. **"My Account" Page** - Full self-service UI
10. **User Notification Preferences** - Let users control channels

### Integration & Testing (Week 4-5)
11. **Event Hooks** - Wire up all triggers
12. **Comprehensive Testing** - Unit + integration tests
13. **Documentation** - API docs + admin guide

---

## Detailed Task Breakdown

### TASK 1: Message Template System
**Effort:** 40-50 LOC  
**Files to Create:** 
- `src/models/MessageTemplateManager.js`

**Files to Modify:**
- `src/models/DatabaseManager.js` (add table)

**What It Does:**
```javascript
const template = await MessageTemplateManager.getTemplate('account_created');
const message = template.render({
  userName: 'john_doe',
  email: 'john@example.com',
  createdDate: '2026-03-19'
});
// Output: Rendered HTML/text with variables interpolated
```

**Database Schema:**
```sql
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,          -- 'account_created', 'user_expiring_soon', etc.
  title TEXT NOT NULL,                -- Display name
  subject TEXT,                       -- For email subject lines
  body TEXT NOT NULL,                 -- Markdown-supported content
  format TEXT DEFAULT 'markdown',     -- 'markdown' or 'html'
  variables JSON,                     -- Available variables for this template
  is_active BOOLEAN DEFAULT 1,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);
```

**Default Templates to Create:**
- `account_created` - Welcome email
- `password_reset_requested` - Reset link email
- `user_expiring_soon` - Pre-expiry warning
- `user_account_disabled` - Account disabled notification
- `user_account_deleted` - Account deleted notification
- `admin_announcement` - Custom admin message
- `verify_contact` - Contact verification (Discord/Telegram)

---

### TASK 2: Event System Enhancement
**Effort:** 60-80 LOC  
**Files to Create:**
- `src/utils/NotificationEventEmitter.js`

**What It Does:**
```javascript
const emitter = NotificationEventEmitter.getInstance();

// Register handlers for events
emitter.on('user:created', async (userData) => {
  await NotificationManager.sendWelcome(userData.id);
  await NotificationManager.notifyAdmins('new_user', userData);
});

emitter.on('user:expiring_soon', async (userData) => {
  await NotificationManager.notifyExpiry(userData.id);
});

// Trigger events from business logic
emitter.emit('user:created', { id: userId, username, email });
```

**Events to Define:**
- `user:created` - New user account created
- `user:enabled` - User account enabled
- `user:disabled` - User account disabled
- `user:deleted` - User account deleted
- `user:expiring_soon` - Account expiring in N days
- `user:expired` - Account passed expiry date
- `password:reset_requested` - User requested password reset
- `password:reset_confirmed` - Password successfully reset
- `invite:created` - New invite generated
- `invite:accepted` - User accepted invite
- `invite:expired` - Invite code expired
- `announcement:published` - Admin published announcement
- `security:suspicious_activity` - Potential security issue detected

---

### TASK 3: Notification Queue System
**Effort:** 50-70 LOC  
**Files to Create:**
- `src/utils/NotificationQueue.js`

**What It Does:**
```javascript
const queue = NotificationQueue.getInstance();

// All notifications go through queue
// - Prevents spam (rate limited)
// - Handles retries on failure
// - Deduplicates similar notifications
// - Logs all delivery attempts

await queue.enqueue({
  userId: 'user123',
  channels: ['email', 'discord'],
  templateKey: 'account_created',
  variables: { userName: 'john' },
  priority: 'normal',
  retryCount: 3
});
```

**Database Schema:**
```sql
CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  channels JSON NOT NULL,             -- ['email', 'discord', 'telegram']
  variables JSON,
  status TEXT DEFAULT 'pending',      -- 'pending', 'sent', 'failed', 'skipped'
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  priority TEXT DEFAULT 'normal',     -- 'high', 'normal', 'low'
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

### TASK 4: Database Schema Updates
**Files to Modify:**
- `src/models/DatabaseManager.js`

**New Tables/Columns:**

```sql
-- User notification preferences
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE NOT NULL,
  email_enabled BOOLEAN DEFAULT 1,
  discord_enabled BOOLEAN DEFAULT 0,
  discord_user_id TEXT,              -- Discord user ID for DM
  telegram_enabled BOOLEAN DEFAULT 0,
  telegram_chat_id TEXT,             -- Telegram chat ID for bot
  matrix_enabled BOOLEAN DEFAULT 0,
  matrix_user_id TEXT,               -- @user:matrix.domain
  notification_digest BOOLEAN DEFAULT 0,  -- Combine notifications?
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Bot tokens for integrations
CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  service_name TEXT UNIQUE NOT NULL, -- 'discord', 'telegram', 'matrix'
  config JSON NOT NULL,              -- Encrypted config
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notification delivery log
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  template_key TEXT,
  channel TEXT,                      -- 'email', 'discord', 'telegram'
  status TEXT,                       -- 'sent', 'failed'
  error_message TEXT,
  delivered_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

### TASK 5: Notification Manager Rewrite
**Effort:** 150-200 LOC  
**Files to Create:**
- `src/models/NotificationChannelAdapter.js` (base class)
- `src/adapters/EmailAdapter.js`
- `src/adapters/DiscordAdapter.js`
- `src/adapters/TelegramAdapter.js`

**Files to Modify:**
- `src/models/NotificationManager.js` (completely rewrite)

**Architecture:**
```javascript
// Base adapter class
class NotificationChannelAdapter {
  async send(userPreferences, message) {
    // Override in subclasses
  }
  
  async verify(userPreferences) {
    // Verify credentials are valid
  }
}

// Manager routes to correct adapter
class NotificationManager {
  async send(userId, templateKey, variables) {
    const template = await MessageTemplateManager.getTemplate(templateKey);
    const message = template.render(variables);
    const prefs = await getUserPreferences(userId);
    
    const channels = [];
    if (prefs.email_enabled) channels.push('email');
    if (prefs.discord_enabled) channels.push('discord');
    if (prefs.telegram_enabled) channels.push('telegram');
    
    for (const channel of channels) {
      const adapter = this.getAdapter(channel);
      await NotificationQueue.enqueue({
        userId,
        templateKey,
        channel,
        variables,
        adapter
      });
    }
  }
}
```

---

### TASK 6: Discord Adapter
**Effort:** 80-120 LOC  
**External Dependency:** `discord.js` package

**What It Does:**
```javascript
const Discord = require('discord.js');

class DiscordAdapter extends NotificationChannelAdapter {
  async initialize(botToken, serverId) {
    this.client = new Discord.Client();
    await this.client.login(botToken);
    this.serverId = serverId;
  }
  
  async send(userPrefs, message) {
    // Get user by ID
    const user = await this.client.users.fetch(userPrefs.discord_user_id);
    
    // Send DM
    return await user.send({
      content: message.body,
      embeds: [{
        title: message.title,
        description: message.body,
        color: 0x0099ff,
        timestamp: new Date()
      }]
    });
  }
  
  async verifyCredentials() {
    // Test connection
    return await this.client.user != null;
  }
}
```

**User Setup Flow:**
1. User goes to `/account#discord`
2. Click "Connect Discord"
3. Presented with special Discord command: `/verify 123456` 
4. User runs command in Discord server
5. Bot captures message → registers user ID
6. Shows "Connected!" in settings

---

### TASK 7: Telegram Adapter
**Effort:** 80-120 LOC  
**External Dependency:** `telegraf` package

**What It Does:**
```javascript
const { Telegraf } = require('telegraf');

class TelegramAdapter extends NotificationChannelAdapter {
  async initialize(botToken) {
    this.bot = new Telegraf(botToken);
    this.setupCommandHandlers();
  }
  
  setupCommandHandlers() {
    this.bot.command('verify', async (ctx) => {
      const code = ctx.message.text.split(' ')[1];
      // Link user ID to this chat ID
      await this.registerUser(code, ctx.chat.id);
      ctx.reply('✅ Connected! You will now receive notifications.');
    });
  }
  
  async send(userPrefs, message) {
    return await this.bot.telegram.sendMessage(
      userPrefs.telegram_chat_id,
      this.formatMessage(message)
    );
  }
}
```

---

### TASK 8: "My Account" Page
**Effort:** 200-250 LOC  
**Files to Create:**
- `src/routes/me.js` (expand existing)
- `views/account.ejs` (new)
- `public/js/account.js` (new)

**UI Sections:**
```
    Account Settings
├── Account Information
│   ├── Username (display only)
│   ├── User ID (display only)
│   ├── Created Date
│   ├── Account Status (enabled/disabled/expiry warning)
│   └── Account Type (Local vs SSO)
├── Security
│   ├── Change Password
│   │   ├── Current password required
│   │   ├── New password (strength indicator)
│   │   └── Confirm password
│   ├── Active Sessions
│   │   ├── List of devices/locations
│   │   └── Terminate session (logout from device)
│   └── Login History (last 10 logins with IP, timestamp)
├── Contact & Notifications
│   ├── Email Address
│   │   ├── Current email display
│   │   ├── Edit email (with verification)
│   │   └── Verify email button
│   ├── Notification Channels
│   │   ├── Email: [Toggle] 
│   │   ├── Discord: [Connect] (if configured by admin)
│   │   ├── Telegram: [Connect] (if configured by admin)
│   │   └── Matrix: [Connect] (if configured by admin)
│   └── Notification Preferences
│       ├── Real-time notifications
│       ├── Digest emails (daily/weekly)
│       └── Event selection (account status, security alerts, announcements)
└── Advanced
    ├── Export My Data (GDPR)
    ├── Connected Apps (OAuth logins)
    └── Delete Account (with confirmation)
```

**API Endpoints:**
```
GET  /api/me                                    - Get current user info
PUT  /api/me/password                           - Change password
PUT  /api/me/email                              - Update email
POST /api/me/email/verify-code                  - Verify new email
GET  /api/me/sessions                           - List active sessions
POST /api/me/sessions/:sessionId/terminate      - Logout from device
GET  /api/me/login-history                      - Last 10 logins
GET  /api/me/notifications/preferences          - Get notification settings
PUT  /api/me/notifications/preferences          - Update preferences
POST /api/me/notifications/verify-discord       - Link Discord account
POST /api/me/notifications/verify-telegram      - Link Telegram account
POST /api/me/notifications/verify-matrix        - Link Matrix account
POST /api/me/export                             - Initiate data export
POST /api/me/delete                             - Request account deletion
```

---

### TASK 9: User Notification Preferences UI
**Effort:** 100-120 LOC  
**Files to Modify:**
- `views/account.ejs` (add section)
- `public/js/account.js` (add handlers)

**Features:**
- Toggle channels on/off (if configured by admin)
- Set notification digest preference
- Choose which events trigger notifications
- Quick links to verify accounts (Discord, Telegram)
- Test notification button (send test message)

---

### TASK 10: Event Hooks Integration
**Effort:** 120-150 LOC  
**Files to Modify:**
- `src/routes/auth.js` - Hook signup/login events
- `src/routes/users.js` - Hook user creation
- `src/models/UserExpiryManager.js` - Hook expiry events
- `src/models/PasswordResetManager.js` - Hook reset events
- `src/routes/invites.js` - Hook invite events
- `src/routes/announcements.js` - Hook announcement events

**Example Integration:**
```javascript
// In auth.js - on successful signup
const emitter = NotificationEventEmitter.getInstance();
emitter.emit('user:created', {
  id: newUser.id,
  username: newUser.username,
  email: userProfile.email,
  createdAt: new Date(),
  inviteCode: inviteCode // optional
});

// Handler automatically sends welcome email + Discord/Telegram if connected
```

---

## Database Migration Script

**File:** `scripts/migrate-notifications.js`

```javascript
// Add all new tables and columns for notification system
// Run on startup if not already migrated

const migrations = [
  'CREATE TABLE message_templates...',
  'CREATE TABLE user_notification_preferences...',
  'CREATE TABLE integration_configs...',
  'CREATE TABLE notification_logs...',
  'CREATE TABLE notification_queue...'
];

migrations.forEach(sql => db.run(sql));
```

---

## Configuration Required

**Environment Variables:**
```bash
# Discord Bot
DISCORD_BOT_TOKEN=xxxxxxxxxxx
DISCORD_SERVER_ID=xxxxxxxxxxx

# Telegram Bot
TELEGRAM_BOT_TOKEN=xxxxxxxxxxx

# Matrix (optional)
MATRIX_HOMESERVER=https://matrix.example.com
MATRIX_DEVICE_ID=xxxxx

# Email (existing)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=noreply@example.com
EMAIL_PASSWORD=xxxxx
```

**Admin Configuration UI:**
- New admin page: `/admin/integrations`
- Configure Discord bot token/server
- Configure Telegram bot token
- Enable/disable each channel
- Test connections

---

## Testing Strategy

### Unit Tests (50+ test cases)
- [ ] MessageTemplateManager (CRUD, variables)
- [ ] NotificationQueue (enqueue, dequeue, retry)
- [ ] Each channel adapter (send, verify)
- [ ] Event system (emit, listen)

### Integration Tests
- [ ] End-to-end user creation → welcome email
- [ ] Password reset flow with notifications
- [ ] Multi-channel delivery (email + Discord)
- [ ] Preference enforcement (if Discord disabled, only email)

### Manual Testing Checklist
- [ ] Send test notification from admin panel
- [ ] Link Discord account and verify
- [ ] Receive notification on Discord
- [ ] Change notification preferences
- [ ] Receive digest email
- [ ] Test retry on failure (kill connection mid-send)

---

## Rollout Strategy

### Phase 3.1 (Week 1-2)
- Deploy message template system
- Deploy event system + queue
- Deploy database migrations
- Deploy notification manager refactor

### Phase 3.2 (Week 2-3)
- Deploy Discord adapter
- Deploy Telegram adapter
- Launch "My Account" page (without new integrations at first)
- Soft-launch: email notifications only

### Phase 3.3 (Week 3-4)
- Enable Discord/Telegram integrations
- User preferences page
- Admin integration config UI
- Event hooks wired up

---

## Estimated Line Count by Component

| Component | LOC | Complexity |
|-----------|-----|-----------|
| MessageTemplateManager | 200 | Medium |
| NotificationEventEmitter | 100 | Low-Medium |
| NotificationQueue | 150 | Medium |
| Database migrations | 200 | Low |
| NotificationManager refactor | 250 | High |
| Discord Adapter | 150 | Medium |
| Telegram Adapter | 150 | Medium |
| "My Account" page (backend) | 300 | High |
| "My Account" page (frontend) | 400 | Medium |
| Notification prefs (backend) | 150 | Medium |
| Notification prefs (frontend) | 200 | Low-Medium |
| Event hooks integration | 200 | Medium |
| Tests | 500+ | High |
| **TOTAL** | **3000+** | **High** |

---

## Success Criteria

- ✅ All message templates created with default content
- ✅ Events emit when expected (user create, expiry, etc.)
- ✅ Notifications queue, retry, and log delivery
- ✅ Discord bot connects and sends messages
- ✅ Telegram bot connects and sends messages
- ✅ "My Account" page works without new integrations
- ✅ Users can link Discord/Telegram accounts
- ✅ Users receive notifications on linked channels
- ✅ Preferences enforce channel selection
- ✅ All critical paths tested (80%+ coverage)
- ✅ Documentation complete

---

## Known Challenges & Solutions

| Challenge | Solution |
|-----------|----------|
| Discord bot goes offline | Implement auto-reconnect with exponential backoff |
| Telegram rate limits | Queue with intelligent throttling |
| User makes typo linking account | Provide clear error message, retry UI |
| Notification spam | Deduplication + cooldown periods |
| Private Discord servers | Fall back to email if unable to send DM |
| Language support | Message templates support i18n keys |

