/**
 * NotificationManager
 * Enhanced multi-channel notification system with templates, queues, and adapters
 * 
 * Features:
 * - Template-based messages with variable interpolation
 * - Multi-channel delivery (email, Discord, Telegram, Matrix)
 * - User preference enforcement
 * - Queue management with retries
 * - Complete delivery logging
 */

const nodemailer = require('nodemailer');
const axios = require('axios');
const logger = require('../utils/logger');
const SetupManager = require('./SetupManager');
const UserProfileManager = require('./UserProfileManager');
const MessageTemplateManager = require('./MessageTemplateManager');
const NotificationQueue = require('../utils/NotificationQueue');
const NotificationEventEmitter = require('../utils/NotificationEventEmitter');
const DatabaseManager = require('./DatabaseManager');

class NotificationManager {
  static instance = null;
  static emailTransporter = null;
  static isProcessing = false;
  static processingInterval = null;
  static adapters = {};

  /**
   * Get or create singleton instance
   */
  static getInstance() {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
      NotificationManager.instance.initialize();
    }
    return NotificationManager.instance;
  }

  /**
   * Initialize notification system
   */
  async initialize() {
    try {
      logger.info('Initializing NotificationManager...');
      
      // Initialize email transporter
      await this.initializeEmailTransporter();
      
      // Initialize adapters
      await this.initializeAdapters();
      
      // Start queue processor
      this.startQueueProcessor();
      
      // Setup event handlers
      this.setupEventHandlers();
      
      logger.info('NotificationManager initialized successfully');
    } catch (err) {
      logger.error('NotificationManager initialization error:', err.message);
    }
  }

  /**
   * Initialize email transporter
   */
  async initializeEmailTransporter() {
    try {
      const config = SetupManager.getConfig();
      const emailConfig = config.email || {};

      if (!emailConfig.enabled) {
        logger.info('Email notifications disabled');
        return;
      }

      if (emailConfig.provider === 'smtp') {
        NotificationManager.emailTransporter = nodemailer.createTransport({
          host: emailConfig.smtpHost,
          port: emailConfig.smtpPort,
          secure: emailConfig.smtpSecure === true,
          auth: emailConfig.smtpAuth ? {
            user: emailConfig.smtpAuth.user,
            pass: emailConfig.smtpAuth.pass
          } : undefined
        });

        // Test connection
        await NotificationManager.emailTransporter.verify();
        logger.info('Email transporter ready');
      }
    } catch (err) {
      logger.warn('Email transporter initialization failed:', err.message);
    }
  }

  /**
   * Initialize channel adapters (Discord, Telegram, Matrix)
   */
  async initializeAdapters() {
    // Adapters will be initialized on-demand when needed
    // This allows system to work even if a service is down
    logger.info('Adapters ready for initialization');
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    const emitter = NotificationEventEmitter.getInstance();

    // User lifecycle events
    emitter.on(NotificationEventEmitter.EVENTS.USER_CREATED, async (data) => {
      await this.sendWelcome(data.id, data.email);
    });

    emitter.on(NotificationEventEmitter.EVENTS.USER_DISABLED, async (data) => {
      await this.notifyUserDisabled(data.id, data.reason);
    });

    emitter.on(NotificationEventEmitter.EVENTS.USER_DELETED, async (data) => {
      await this.notifyUserDeleted(data.id);
    });

    // Expiry events
    emitter.on(NotificationEventEmitter.EVENTS.USER_EXPIRING_SOON, async (data) => {
      await this.notifyAccountExpiringSoon(data.id, data.daysRemaining);
    });

    // Password reset events
    emitter.on(NotificationEventEmitter.EVENTS.PASSWORD_RESET_REQUESTED, async (data) => {
      await this.notifyPasswordResetRequest(data.id, data.resetLink);
    });

    // Invite events
    emitter.on(NotificationEventEmitter.EVENTS.INVITE_ACCEPTED, async (data) => {
      await this.notifyInviteAccepted(data.id, data.user);
    });

    // Announcement events
    emitter.on(NotificationEventEmitter.EVENTS.ANNOUNCEMENT_PUBLISHED, async (data) => {
      // Send to all users - implementation in separate method
    });

    logger.info('Event handlers registered');
  }

  /**
   * Start processing notification queue
   */
  startQueueProcessor() {
    if (NotificationManager.processingInterval) {
      clearInterval(NotificationManager.processingInterval);
    }

    NotificationManager.processingInterval = setInterval(async () => {
      if (NotificationManager.isProcessing) return;

      await this.processNextInQueue();
    }, 500); // Process every 500ms

    logger.info('Notification queue processor started');
  }

  /**
   * Process next notification in queue
   */
  async processNextInQueue() {
    try {
      const queue = NotificationQueue.getInstance();
      const entry = await queue.getNextPending();

      if (!entry) return; // No pending notifications

      NotificationManager.isProcessing = true;

      try {
        // Get user preferences
        const prefs = await this.getUserPreferences(entry.user_id);
        const profile = await UserProfileManager.getProfile(entry.user_id).catch(() => null);

        if (!profile || !profile.email) {
          await queue.updateStatus(entry.id, 'failed', 'User profile or email not found');
          return;
        }

        // Filter channels based on user preferences and system config
        const availableChannels = this.getAvailableChannels();
        const userChannels = entry.channels.filter(ch => {
          // Check if channel is enabled in system config
          if (!availableChannels.includes(ch)) return false;
          
          // Check user preference
          const prefKey = `${ch}_enabled`;
          return prefs[prefKey] !== false;
        });

        if (userChannels.length === 0) {
          await queue.updateStatus(entry.id, 'skipped', 'No channels available for user');
          return;
        }

        // Render template
        const template = await MessageTemplateManager.getInstance().getTemplate(entry.template_key);
        const rendered = MessageTemplateManager.getInstance().renderTemplate(template, entry.variables);

        // Send to each channel
        const results = [];
        for (const channel of userChannels) {
          try {
            await this.sendToChannel(channel, entry.user_id, profile, prefs, rendered);
            await queue.logDelivery(entry.user_id, entry.template_key, channel, 'sent');
          } catch (err) {
            logger.warn(`Failed to send ${channel} notification:`, err.message);
            await queue.logDelivery(entry.user_id, entry.template_key, channel, 'failed', err.message);
            results.push(err);
          }
        }

        // Update queue status
        if (results.length === 0) {
          await queue.updateStatus(entry.id, 'sent');
        } else if (entry.retry_count < entry.max_retries) {
          await queue.incrementRetry(entry.id);
          // Will be retried in next cycle
        } else {
          await queue.updateStatus(entry.id, 'failed', 'Max retries exceeded');
        }
      } catch (err) {
        logger.error('Error processing queue entry:', err.message);
        await queue.incrementRetry(entry.id);
        if (entry.retry_count >= entry.max_retries) {
          const queue = NotificationQueue.getInstance();
          await queue.updateStatus(entry.id, 'failed', err.message);
        }
      }
    } catch (err) {
      logger.error('Queue processor error:', err.message);
    } finally {
      NotificationManager.isProcessing = false;
    }
  }

  /**
   * Get available channels based on system configuration
   */
  getAvailableChannels() {
    const channels = ['email']; // Email always available

    const config = SetupManager.getConfig();
    
    if (config.discord?.enabled) channels.push('discord');
    if (config.telegram?.enabled) channels.push('telegram');
    if (config.matrix?.enabled) channels.push('matrix');

    return channels;
  }

  /**
   * Send notification to specific channel
   */
  async sendToChannel(channel, userId, profile, prefs, rendered) {
    switch (channel) {
      case 'email':
        return await this.sendEmailNotification(profile.email, rendered);
      case 'discord':
        return await this.sendDiscordNotification(prefs.discord_user_id, rendered);
      case 'telegram':
        return await this.sendTelegramNotification(prefs.telegram_chat_id, rendered);
      case 'matrix':
        return await this.sendMatrixNotification(prefs.matrix_user_id, rendered);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }

  /**
   * Send email notification
   */
  async sendEmailNotification(email, rendered) {
    if (!NotificationManager.emailTransporter) {
      throw new Error('Email transporter not configured');
    }

    const config = SetupManager.getConfig();
    const emailConfig = config.email || {};

    const html = this.generateEmailHTML(rendered.title, rendered.body, rendered.format);

    return await NotificationManager.emailTransporter.sendMail({
      from: emailConfig.smtpFrom || 'noreply@jellysso.local',
      to: email,
      subject: rendered.subject,
      html: html,
      text: rendered.body
    });
  }

  /**
   * Send Discord notification
   */
  async sendDiscordNotification(discordUserId, rendered) {
    // Discord adapter will be called here when ready
    // For now, placeholder
    if (!discordUserId) {
      throw new Error('Discord user ID not found');
    }
    logger.info(`Discord notification (placeholder): ${rendered.title}`);
    // Will implement with actual Discord.js bot
  }

  /**
   * Send Telegram notification
   */
  async sendTelegramNotification(telegramChatId, rendered) {
    if (!telegramChatId) {
      throw new Error('Telegram chat ID not found');
    }

    const config = SetupManager.getConfig();
    const botToken = config.telegram?.botToken;

    if (!botToken) {
      throw new Error('Telegram bot token not configured');
    }

    const message = `*${rendered.title}*\n\n${rendered.body}`;

    const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: telegramChatId,
      text: message,
      parse_mode: 'Markdown'
    });

    return response.data;
  }

  /**
   * Send Matrix notification
   */
  async sendMatrixNotification(matrixUserId, rendered) {
    if (!matrixUserId) {
      throw new Error('Matrix user ID not found');
    }
    logger.info(`Matrix notification (placeholder): ${rendered.title}`);
    // Will implement with Matrix client library
  }

  /**
   * Send notification using template
   * Main method for sending notifications
   */
  async send(userId, templateKey, variables = {}, options = {}) {
    const {
      channels = ['email'],
      priority = 'normal',
      deduplicateKey = null,
      maxRetries = 3
    } = options;

    try {
      const queue = NotificationQueue.getInstance();
      const entry = await queue.enqueue({
        userId,
        templateKey,
        channels,
        variables,
        priority,
        deduplicateKey,
        maxRetries
      });

      logger.info(`Notification queued: ${templateKey} for user ${userId}`);
      return entry;
    } catch (err) {
      logger.error('Error queuing notification:', err.message);
      throw err;
    }
  }

  /**
   * Helper methods for specific notification types
   */

  async sendWelcome(userId, email) {
    return await this.send(userId, 'account_created', {
      email,
      createdDate: new Date().toLocaleDateString()
    });
  }

  async notifyPasswordResetRequest(userId, resetLink) {
    return await this.send(userId, 'password_reset_requested', { resetLink });
  }

  async notifyAccountExpiringSoon(userId, daysRemaining) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysRemaining);

    return await this.send(userId, 'user_expiring_soon', {
      daysRemaining,
      expiryDate: expiryDate.toLocaleDateString()
    });
  }

  async notifyUserDisabled(userId, reason = null) {
    return await this.send(userId, 'user_account_disabled', { reason: reason || 'Unknown' });
  }

  async notifyUserDeleted(userId) {
    return await this.send(userId, 'user_account_deleted', {});
  }

  async notifyInviteAccepted(adminId, userData) {
    return await this.send(adminId, 'invite_accepted', {
      userName: userData.username,
      email: userData.email || 'N/A',
      acceptedDate: new Date().toLocaleDateString()
    });
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.get(
        'SELECT * FROM user_notification_preferences WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) return reject(err);
          
          // Return defaults if not found
          if (!row) {
            return resolve({
              email_enabled: true,
              discord_enabled: false,
              telegram_enabled: false,
              matrix_enabled: false
            });
          }

          resolve({
            email_enabled: !!row.email_enabled,
            discord_enabled: !!row.discord_enabled,
            discord_user_id: row.discord_user_id,
            discord_verified: !!row.discord_verified,
            telegram_enabled: !!row.telegram_enabled,
            telegram_chat_id: row.telegram_chat_id,
            telegram_verified: !!row.telegram_verified,
            matrix_enabled: !!row.matrix_enabled,
            matrix_user_id: row.matrix_user_id,
            matrix_verified: !!row.matrix_verified,
            notification_digest: !!row.notification_digest
          });
        }
      );
    });
  }

  /**
   * Save/update user notification preferences
   */
  async saveUserPreferences(userId, preferences) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const id = `prefs_${userId}_${Date.now()}`;

      db.run(
        `INSERT OR REPLACE INTO user_notification_preferences 
         (id, user_id, email_enabled, discord_enabled, discord_user_id, discord_verified,
          telegram_enabled, telegram_chat_id, telegram_verified,
          matrix_enabled, matrix_user_id, matrix_verified, notification_digest, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          id,
          userId,
          preferences.email_enabled !== false ? 1 : 0,
          preferences.discord_enabled ? 1 : 0,
          preferences.discord_user_id,
          preferences.discord_verified ? 1 : 0,
          preferences.telegram_enabled ? 1 : 0,
          preferences.telegram_chat_id,
          preferences.telegram_verified ? 1 : 0,
          preferences.matrix_enabled ? 1 : 0,
          preferences.matrix_user_id,
          preferences.matrix_verified ? 1 : 0,
          preferences.notification_digest ? 1 : 0
        ],
        (err) => {
          if (err) return reject(err);
          resolve(true);
        }
      );
    });
  }

  /**
   * Generate HTML email from rendered template
   */
  generateEmailHTML(title, body, format = 'markdown') {
    const appName = SetupManager.getConfig().appName || 'JellySSO';
    const appUrl = SetupManager.getConfig().appUrl || 'http://localhost:3000';

    // Very basic markdown to HTML (full markdown library can be used later)
    let html = body
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(.*?)_/g, '<em>$1</em>')
      .replace(/\`(.*?)\`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0d47a1; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background: #f5f5f5; padding: 20px; }
          .footer { font-size: 12px; color: #999; text-align: center; margin-top: 20px; border-top: 1px solid #ddd; padding-top: 10px; }
          .button { background: #0d47a1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 3px; display: inline-block; }
          a { color: #0d47a1; }
          h1, h2, h3 { color: #0d47a1; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${title}</h2>
          </div>
          <div class="content">
            ${html}
          </div>
          <div class="footer">
            <p><strong>${appName}</strong></p>
            <p><a href="${appUrl}">${appUrl}</a></p>
            <p>Do not reply to this email</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get notification statistics
   */
  async getStats() {
    const queue = NotificationQueue.getInstance();
    return await queue.getStats();
  }
}

module.exports = NotificationManager;
