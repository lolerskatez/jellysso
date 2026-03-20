const crypto = require('crypto');
const DatabaseManager = require('./DatabaseManager');

/**
 * MessageTemplateManager - Manages customizable message templates for notifications
 * Supports Markdown, variable interpolation, and default templates
 */
class MessageTemplateManager {
  static instance = null;

  constructor() {
    this.db = DatabaseManager.getInstance().db;
    this.initializeDefaultTemplates();
  }

  static getInstance() {
    if (!MessageTemplateManager.instance) {
      MessageTemplateManager.instance = new MessageTemplateManager();
    }
    return MessageTemplateManager.instance;
  }

  /**
   * Initialize default templates on startup
   */
  initializeDefaultTemplates() {
    const defaults = [
      {
        key: 'account_created',
        title: 'Welcome to Jellyfin',
        subject: 'Welcome to {{serverName}}!',
        body: `# Welcome, {{userName}}!

Your account has been created successfully. You can now log in to Jellyfin and start enjoying your media library.

**Account Details:**
- Username: {{userName}}
- Email: {{email}}
- Account Created: {{createdDate}}
- Tier: {{tier}}

**Next Steps:**
1. Visit [{{serverUrl}}](/login)
2. Log in with your credentials
3. Start watching!

If you have any questions, don't hesitate to contact support.`,
        format: 'markdown',
        variables: ['userName', 'email', 'createdDate', 'tier', 'serverName', 'serverUrl']
      },
      {
        key: 'password_reset_requested',
        title: 'Password Reset Request',
        subject: 'Reset your {{serverName}} password',
        body: `# Password Reset Request

Someone requested a password reset for your account. If this was you, click the link below to reset your password:

[Reset Password]({{resetLink}})

**This link expires in 1 hour.**

If you did not request this reset, you can safely ignore this email.

---
*This is an automated message. Do not reply to this email.*`,
        format: 'markdown',
        variables: ['serverName', 'resetLink']
      },
      {
        key: 'user_expiring_soon',
        title: 'Account Expiring Soon',
        subject: 'Your {{serverName}} account expires in {{daysRemaining}} days',
        body: `# Account Expiring Soon

Your {{serverName}} account will expire on **{{expiryDate}}** ({{daysRemaining}} days remaining).

After this date, your account will be disabled and you will no longer be able to access the service.

**Account:** {{userName}}

If you need to renew your access, please contact the administrator.`,
        format: 'markdown',
        variables: ['serverName', 'expiryDate', 'daysRemaining', 'userName']
      },
      {
        key: 'user_account_disabled',
        title: 'Account Disabled',
        subject: 'Your {{serverName}} account has been disabled',
        body: `# Account Disabled

Your {{serverName}} account (**{{userName}}**) has been disabled.

You will no longer be able to access the service.

**Reason:** {{reason}}

If you believe this is a mistake, please contact the administrator.`,
        format: 'markdown',
        variables: ['serverName', 'userName', 'reason']
      },
      {
        key: 'user_account_deleted',
        title: 'Account Deleted',
        subject: 'Your {{serverName}} account has been deleted',
        body: `# Account Deleted

Your {{serverName}} account (**{{userName}}**) has been permanently deleted.

All associated data and watch history has been removed.

---
*This is an automated message. Do not reply to this email.*`,
        format: 'markdown',
        variables: ['serverName', 'userName']
      },
      {
        key: 'invite_accepted',
        title: 'Invite Accepted',
        subject: 'Invite Code {{inviteCode}} was accepted',
        body: `# Invite Accepted

The invite code **{{inviteCode}}** was accepted by **{{userName}}**.

**Invite Details:**
- Profile: {{profileName}}
- Accepted: {{acceptedDate}}
- Email: {{email}}

Log in to the admin panel to manage this user.`,
        format: 'markdown',
        variables: ['inviteCode', 'userName', 'profileName', 'acceptedDate', 'email']
      },
      {
        key: 'admin_announcement',
        title: 'Announcement',
        subject: 'Announcement from {{serverName}}',
        body: `# {{title}}

{{content}}

---
*This is a message from the {{serverName}} administrator.*`,
        format: 'markdown',
        variables: ['serverName', 'title', 'content']
      },
      {
        key: 'invite_send',
        title: 'Invite Sent',
        subject: "You've been invited to {{serverName}}",
        body: `# You've Been Invited!

You have been invited to join **{{serverName}}**.

Click the link below to create your account:

{{inviteUrl}}

{{#if expiresAt}}This invite expires on **{{expiresAt}}**.{{/if}}

If you didn't request this, you can safely ignore this message.`,
        format: 'markdown',
        variables: ['serverName', 'inviteUrl', 'expiresAt']
      },
      {
        key: 'discord_verification',
        title: 'Verify Your Discord Account',
        subject: 'Verify your Discord account for {{serverName}}',
        body: `# Verify Your Discord Account

To link your Discord account with {{serverName}}, send the following command in your Discord server:

\`\`\`
/verify {{verificationCode}}
\`\`\`

This code expires in 10 minutes.`,
        format: 'markdown',
        variables: ['serverName', 'verificationCode']
      },
      {
        key: 'telegram_verification',
        title: 'Verify Your Telegram Account',
        subject: 'Verify your Telegram account for {{serverName}}',
        body: `# Verify Your Telegram Account

To link your Telegram account with {{serverName}}, send this command to the bot:

\`\`\`
/verify {{verificationCode}}
\`\`\`

This code expires in 10 minutes.`,
        format: 'markdown',
        variables: ['serverName', 'verificationCode']
      }
    ];

    // Create default templates if they don't exist
    defaults.forEach(template => {
      this.db.get(
        'SELECT id FROM message_templates WHERE key = ?',
        [template.key],
        (err, row) => {
          if (!row && !err) {
            const id = crypto.randomUUID();
            this.db.run(
              `INSERT INTO message_templates (id, key, title, subject, body, format, variables, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
              [id, template.key, template.title, template.subject, template.body, template.format, JSON.stringify(template.variables)],
              (insertErr) => {
                if (insertErr) {
                  console.error(`Error creating default template ${template.key}:`, insertErr.message);
                }
              }
            );
          }
        }
      );
    });
  }

  /**
   * Get template by key
   */
  getTemplate(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM message_templates WHERE key = ? AND is_active = 1',
        [key],
        (err, row) => {
          if (err) return reject(err);
          if (!row) {
            return reject(new Error(`Template not found: ${key}`));
          }

          const template = this.parseTemplateRow(row);
          resolve(template);
        }
      );
    });
  }

  /**
   * Get all templates
   */
  getAllTemplates() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM message_templates ORDER BY key',
        (err, rows) => {
          if (err) return reject(err);
          const templates = rows?.map(row => this.parseTemplateRow(row)) || [];
          resolve(templates);
        }
      );
    });
  }

  /**
   * Create or update a template
   */
  upsertTemplate(key, data, userId = null) {
    return new Promise((resolve, reject) => {
      const id = data.id || crypto.randomUUID();

      this.db.run(
        `INSERT OR REPLACE INTO message_templates 
         (id, key, title, subject, body, format, variables, is_active, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          id,
          key,
          data.title,
          data.subject,
          data.body,
          data.format || 'markdown',
          JSON.stringify(data.variables || []),
          data.is_active !== false ? 1 : 0,
          userId
        ],
        (err) => {
          if (err) return reject(err);
          resolve({ id, ...data });
        }
      );
    });
  }

  /**
   * Delete a template
   */
  deleteTemplate(key) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM message_templates WHERE key = ?',
        [key],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  /**
   * Toggle template active status
   */
  toggleTemplateActive(key, isActive) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE message_templates SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
        [isActive ? 1 : 0, key],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  /**
   * Render template with variable interpolation
   * Supports: {{variableName}} syntax
   * 
   * @param {Object} template - Template object from database
   * @param {Object} variables - Object with variable values
   * @returns {Object} Rendered template with subject and body
   */
  renderTemplate(template, variables = {}) {
    const render = (text) => {
      if (!text) return text;

      // Replace {{variableName}} with values
      // Escape special regex characters in variable values
      return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        const value = variables[varName.trim()];
        if (value === undefined || value === null) {
          console.warn(`Template variable not provided: ${varName}`);
          return match; // Leave unchanged if not provided
        }
        return String(value);
      });
    };

    return {
      subject: render(template.subject),
      body: render(template.body),
      format: template.format,
      title: template.title
    };
  }

  /**
   * Helper to parse template row from database
   */
  parseTemplateRow(row) {
    return {
      id: row.id,
      key: row.key,
      title: row.title,
      subject: row.subject,
      body: row.body,
      format: row.format,
      variables: row.variables ? JSON.parse(row.variables) : [],
      is_active: !!row.is_active,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Render template - convenience method combining getTemplate + renderTemplate
   */
  async render(key, variables = {}) {
    const template = await this.getTemplate(key);
    return this.renderTemplate(template, variables);
  }

  /**
   * Check if template exists
   */
  exists(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT id FROM message_templates WHERE key = ?',
        [key],
        (err, row) => {
          if (err) return reject(err);
          resolve(!!row);
        }
      );
    });
  }
}

module.exports = MessageTemplateManager;
