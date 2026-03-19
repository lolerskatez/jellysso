/**
 * NotificationManager
 * Handles Email and Discord notifications for users
 * Supports configurable delivery methods with queue system
 */

const nodemailer = require('nodemailer');
const axios = require('axios');
const logger = require('../utils/logger');
const SetupManager = require('./SetupManager');
const UserProfileManager = require('./UserProfileManager');

class NotificationManager {
  static instance = null;
  static emailTransporter = null;
  static notificationQueue = [];
  static isProcessing = false;

  /**
   * Get or create singleton instance
   */
  static getInstance() {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
      NotificationManager.instance.initializeTransporter();
      NotificationManager.instance.startQueueProcessor();
    }
    return NotificationManager.instance;
  }

  /**
   * Initialize email transporter from configuration
   */
  async initializeTransporter() {
    try {
      const config = SetupManager.getConfig();
      const emailConfig = config.email || {};

      if (!emailConfig.enabled) {
        logger.info('Email notifications disabled in config');
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
        logger.info('Email transporter initialized successfully');
      } else if (emailConfig.provider === 'sendgrid') {
        // SendGrid is handled directly in send method
        logger.info('SendGrid email provider configured');
      }
    } catch (err) {
      logger.warn('Failed to initialize email transporter:', err.message);
    }
  }

  /**
   * Start processing notification queue
   */
  startQueueProcessor() {
    setInterval(() => {
      if (!NotificationManager.isProcessing && NotificationManager.notificationQueue.length > 0) {
        NotificationManager.isProcessing = true;
        const notification = NotificationManager.notificationQueue.shift();
        
        this.processNotification(notification)
          .catch(err => logger.error('Queue processor error:', err.message))
          .finally(() => {
            NotificationManager.isProcessing = false;
          });
      }
    }, 1000);
  }

  /**
   * Process a single notification from queue
   */
  async processNotification(notification) {
    try {
      const { type, userId, subject, message, data } = notification;

      // Get user profile (may have email/discord/telegram)
      const profile = await UserProfileManager.getProfile(userId).catch(() => null);

      if (!profile) {
        logger.warn(`Profile not found for user ${userId}`);
        return;
      }

      // Send via configured channels
      const results = [];

      if (notification.channels.includes('email') && profile.email) {
        results.push(
          this.sendEmail(profile.email, subject, message, data)
            .catch(err => logger.error(`Email send failed for ${userId}:`, err.message))
        );
      }

      if (notification.channels.includes('discord') && profile.discord_id) {
        results.push(
          this.sendDiscordDM(profile.discord_id, message, data)
            .catch(err => logger.error(`Discord send failed for ${userId}:`, err.message))
        );
      }

      if (notification.channels.includes('telegram') && profile.telegram_id) {
        results.push(
          this.sendTelegramDM(profile.telegram_id, message)
            .catch(err => logger.error(`Telegram send failed for ${userId}:`, err.message))
        );
      }

      await Promise.allSettled(results);
      logger.info(`Notification processed for user ${userId}`);
    } catch (err) {
      logger.error('Notification processing error:', err.message);
    }
  }

  /**
   * Queue a notification for later delivery
   */
  async queueNotification(userId, options = {}) {
    const {
      channels = ['email'],
      subject = 'JellySSO Notification',
      message = '',
      data = {}
    } = options;

    NotificationManager.notificationQueue.push({
      userId,
      channels,
      subject,
      message,
      data,
      timestamp: new Date()
    });

    logger.info(`Notification queued for user ${userId}: ${subject}`);
  }

  /**
   * Send email notification
   */
  async sendEmail(emailAddress, subject, message, data = {}) {
    try {
      const config = SetupManager.getConfig();
      const emailConfig = config.email || {};

      if (!emailConfig.enabled) {
        throw new Error('Email notifications not configured');
      }

      if (emailConfig.provider === 'sendgrid') {
        return await this.sendViaSendGridAPI(emailAddress, subject, message);
      } else if (NotificationManager.emailTransporter) {
        return await NotificationManager.emailTransporter.sendMail({
          from: emailConfig.smtpFrom || 'noreply@jellysso.local',
          to: emailAddress,
          subject: subject,
          html: this.generateEmailHTML(subject, message, data),
          text: message
        });
      } else {
        throw new Error('Email transporter not available');
      }
    } catch (err) {
      logger.error('Email send error:', err.message);
      throw err;
    }
  }

  /**
   * Send via SendGrid API
   */
  async sendViaSendGridAPI(emailAddress, subject, message) {
    const config = SetupManager.getConfig();
    const apiKey = config.email?.sendgridApiKey;

    if (!apiKey) {
      throw new Error('SendGrid API key not configured');
    }

    try {
      const response = await axios.post('https://api.sendgrid.com/v3/mail/send', {
        personalizations: [{ to: [{ email: emailAddress }] }],
        from: { email: config.email?.sendgridFrom || 'noreply@jellysso.local' },
        subject: subject,
        content: [
          {
            type: 'text/html',
            value: this.generateEmailHTML(subject, message, {})
          }
        ]
      }, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info(`Email sent via SendGrid to ${emailAddress}`);
      return response.data;
    } catch (err) {
      logger.error('SendGrid error:', err.message);
      throw err;
    }
  }

  /**
   * Send Discord DM
   */
  async sendDiscordDM(discordId, message, data = {}) {
    const config = SetupManager.getConfig();
    const discordConfig = config.discord || {};

    if (!discordConfig.enabled || !discordConfig.botToken) {
      throw new Error('Discord not configured');
    }

    try {
      // Discord bot would need to be implemented
      // For now, this is a placeholder
      logger.info(`Discord notification would be sent to ${discordId}: ${message}`);
      return { success: true };
    } catch (err) {
      logger.error('Discord send error:', err.message);
      throw err;
    }
  }

  /**
   * Send Telegram DM
   */
  async sendTelegramDM(telegramId, message) {
    const config = SetupManager.getConfig();
    const telegramConfig = config.telegram || {};

    if (!telegramConfig.enabled || !telegramConfig.botToken) {
      throw new Error('Telegram not configured');
    }

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
        {
          chat_id: telegramId,
          text: message,
          parse_mode: 'MarkdownV2'
        }
      );

      logger.info(`Telegram notification sent to ${telegramId}`);
      return response.data;
    } catch (err) {
      logger.error('Telegram send error:', err.message);
      throw err;
    }
  }

  /**
   * Generate HTML email template
   */
  generateEmailHTML(subject, message, data = {}) {
    const appName = SetupManager.getConfig().appName || 'JellySSO';
    const appUrl = SetupManager.getConfig().appUrl || 'https://jellysso.local';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0066cc; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background: #f9f9f9; padding: 20px; border-left: 4px solid #0066cc; }
          .footer { font-size: 12px; color: #666; text-align: center; margin-top: 20px; }
          .button { background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>${subject}</h2>
          </div>
          <div class="content">
            ${message}
          </div>
          <div class="footer">
            <p>${appName} - Do not reply to this email</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Predefined notification templates
   */
  static TEMPLATES = {
    PASSWORD_RESET: {
      subject: 'Password Reset Link',
      generateMessage: (data) => `
        <p>Hello,</p>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <p><a href="${data.resetLink}" class="button">Reset Password</a></p>
        <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>
      `
    },
    ACCOUNT_EXPIRY_WARNING: {
      subject: 'Your Account Will Expire Soon',
      generateMessage: (data) => `
        <p>Hello,</p>
        <p>Your account will expire on <strong>${data.expiryDate}</strong> (in ${data.daysRemaining} days).</p>
        <p>To continue using the service, please contact the administrator.</p>
      `
    },
    ACCOUNT_DISABLED_NOTIFICATION: {
      subject: 'Your Account Has Been Disabled',
      generateMessage: (data) => `
        <p>Hello,</p>
        <p>Your account has been disabled by an administrator.</p>
        <p>Reason: ${data.reason || 'Not specified'}</p>
        <p>Contact the administrator if you believe this is in error.</p>
      `
    },
    ADMIN_ANNOUNCEMENT: {
      subject: (data) => data.subject || 'Important Announcement',
      generateMessage: (data) => `
        <p>${data.message}</p>
      `
    }
  };
}

module.exports = NotificationManager;
