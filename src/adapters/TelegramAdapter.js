/**
 * TelegramAdapter - Handle Telegram bot notifications and verification
 * 
 * Handles:
 * - Sending messages to users
 * - User verification flow via /verify command
 * - Webhook/polling for bot updates
 * - Error handling and retries
 */

const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const logger = require('../utils/logger');
const SetupManager = require('./SetupManager');
const DatabaseManager = require('./DatabaseManager');

class TelegramAdapter {
  static instance = null;

  constructor() {
    this.bot = null;
    this.isConnected = false;
    this.verificationCodes = {}; // In-memory, should be in DB for production
  }

  static getInstance() {
    if (!TelegramAdapter.instance) {
      TelegramAdapter.instance = new TelegramAdapter();
    }
    return TelegramAdapter.instance;
  }

  /**
   * Initialize Telegram bot
   */
  async initialize(botToken) {
    try {
      if (!botToken) {
        logger.warn('Telegram bot token not provided');
        return false;
      }

      this.bot = new Telegraf(botToken);

      // Setup command handlers
      this.setupCommandHandlers();

      // Test bot connection
      const me = await this.bot.telegram.getMe();
      logger.info(`Telegram bot initialized as @${me.username}`);

      this.isConnected = true;
      return true;
    } catch (err) {
      logger.error('Telegram bot initialization error:', err.message);
      return false;
    }
  }

  /**
   * Setup Telegram command handlers
   */
  setupCommandHandlers() {
    // Handle /start command
    this.bot.start(async (ctx) => {
      await ctx.reply(
        '👋 Welcome to JellySSO Bot!\n\n' +
        'To link your Telegram account with JellySSO, use:\n' +
        '`/verify YOUR_CODE_HERE`\n\n' +
        'You can find your verification code in JellySSO Account Settings.',
        { parse_mode: 'Markdown' }
      );
    });

    // Handle /verify command
    this.bot.command('verify', async (ctx) => {
      try {
        const args = ctx.message.text.split(' ');
        const code = args[1];

        if (!code) {
          await ctx.reply('Usage: `/verify <code>`', { parse_mode: 'Markdown' });
          return;
        }

        // Validate code format
        if (!/^[A-Z0-9]{12}$/.test(code)) {
          await ctx.reply('❌ Invalid verification code format');
          return;
        }

        // Check if code exists and is valid
        const verification = this.verificationCodes[code];
        if (!verification) {
          await ctx.reply('❌ Verification code not found or expired');
          return;
        }

        // Check if code is expired (10 minutes)
        if (Date.now() - verification.createdAt > 600000) {
          delete this.verificationCodes[code];
          await ctx.reply('❌ Verification code expired');
          return;
        }

        // Link user Telegram ID to JellySSO user
        await this.linkUserTelegramAccount(verification.userId, ctx.chat.id);

        // Cleanup code
        delete this.verificationCodes[code];

        // Confirm to user
        await ctx.reply(
          '✅ Your Telegram account has been linked successfully!\n' +
          'You will now receive notifications here.'
        );

        logger.info(`Telegram account linked for user ${verification.userId}`);
      } catch (err) {
        logger.error('Telegram verification error:', err.message);
        await ctx.reply('❌ An error occurred during verification');
      }
    });

    // Handle /help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🆘 JellySSO Telegram Bot Help\n\n' +
        '/start - Welcome message\n' +
        '/verify <code> - Link your Telegram account\n' +
        '/help - This help message',
        { parse_mode: 'Markdown' }
      );
    });
  }

  /**
   * Link Telegram user to JellySSO user
   */
  async linkUserTelegramAccount(userId, telegramChatId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;

      db.run(
        `UPDATE user_notification_preferences 
         SET telegram_chat_id = ?, telegram_verified = 1, telegram_enabled = 1
         WHERE user_id = ?`,
        [telegramChatId, userId],
        function(err) {
          if (err) return reject(err);

          // If no rows affected, insert new preference record
          if (this.changes === 0) {
            db.run(
              `INSERT INTO user_notification_preferences 
               (id, user_id, telegram_chat_id, telegram_verified, telegram_enabled)
               VALUES (?, ?, ?, 1, 1)`,
              [`prefs_${userId}_${Date.now()}`, userId, telegramChatId],
              (insertErr) => {
                if (insertErr) return reject(insertErr);
                resolve(true);
              }
            );
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  /**
   * Generate verification code for user
   */
  generateVerificationCode(userId) {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase().substring(0, 12);

    this.verificationCodes[code] = {
      userId,
      createdAt: Date.now()
    };

    // Auto-cleanup after 10 minutes
    setTimeout(() => {
      delete this.verificationCodes[code];
    }, 600000);

    return code;
  }

  /**
   * Send message to user
   */
  async send(telegramChatId, message) {
    try {
      if (!this.isConnected || !this.bot) {
        throw new Error('Telegram bot not connected');
      }

      const text = `\n*${message.title}*\n\n${message.body}`;

      const sentMessage = await this.bot.telegram.sendMessage(telegramChatId, text, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      logger.info(`Telegram message sent to chat ${telegramChatId}`);
      return { success: true, messageId: sentMessage.message_id };
    } catch (err) {
      logger.error('Telegram send error:', err.message);
      throw err;
    }
  }

  /**
   * Start polling for updates (alternative to webhooks)
   */
  async startPolling(options = {}) {
    try {
      if (!this.bot) {
        logger.error('Telegram bot not initialized');
        return;
      }

      const pollingOptions = {
        timeout: 30,
        allowed_updates: ['message'],
        ...options
      };

      await this.bot.launch({ polling: pollingOptions });
      logger.info('Telegram bot polling started');

      // Graceful stop on signals
      process.once('SIGINT', () => {
        this.bot.stop('SIGINT');
      });
      process.once('SIGTERM', () => {
        this.bot.stop('SIGTERM');
      });
    } catch (err) {
      logger.error('Telegram polling error:', err.message);
      throw err;
    }
  }

  /**
   * Setup webhook for Telegram updates
   * (Alternative to polling for high-volume scenarios)
   */
  async setupWebhook(webhookUrl) {
    try {
      if (!this.bot) {
        logger.error('Telegram bot not initialized');
        return false;
      }

      await this.bot.telegram.setWebhook(webhookUrl);
      logger.info(`Telegram webhook set to ${webhookUrl}`);
      return true;
    } catch (err) {
      logger.error('Telegram webhook setup error:', err.message);
      return false;
    }
  }

  /**
   * Handle webhook update (express middleware compatible)
   */
  getWebhookMiddleware() {
    if (!this.bot) {
      throw new Error('Telegram bot not initialized');
    }
    return this.bot.webhookCallback('/telegram');
  }

  /**
   * Test Telegram connection
   */
  async testConnection() {
    try {
      if (!this.bot) {
        return { success: false, message: 'Bot not initialized' };
      }

      const me = await this.bot.telegram.getMe();
      return {
        success: true,
        botId: me.id,
        botUsername: me.username,
        botName: me.first_name
      };
    } catch (err) {
      logger.error('Telegram test error:', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Disconnect bot gracefully
   */
  async disconnect() {
    try {
      if (this.bot) {
        await this.bot.stop();
        this.isConnected = false;
        logger.info('Telegram bot disconnected');
      }
    } catch (err) {
      logger.error('Telegram disconnect error:', err.message);
    }
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      botInitialized: !!this.bot,
      pendingVerifications: Object.keys(this.verificationCodes).length
    };
  }

  /**
   * Send message to multiple users (batch)
   */
  async sendBatch(chatIds, message) {
    const results = {
      succeeded: [],
      failed: []
    };

    for (const chatId of chatIds) {
      try {
        await this.send(chatId, message);
        results.succeeded.push(chatId);
      } catch (err) {
        logger.warn(`Failed to send to ${chatId}:`, err.message);
        results.failed.push({ chatId, error: err.message });
      }
    }

    return results;
  }
}

module.exports = TelegramAdapter;
