/**
 * TelegramAdapter - Handle Telegram bot notifications and verification
 * 
 * Handles:
 * - Sending messages to users
 * - User verification flow via /verify command
 * - Webhook/polling for bot updates
 * - Error handling and retries
 */

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

      let Telegraf;
      try {
        ({ Telegraf } = require('telegraf'));
      } catch {
        logger.warn('telegraf is not installed — Telegram notifications disabled. Run: npm install telegraf');
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
    // Handle /start command — welcome and show current link status
    this.bot.start(async (ctx) => {
      const chatId = ctx.chat.id;
      // Check if this Telegram chat is already linked
      const existing = await DatabaseManager.queryOne(
        `SELECT user_id FROM user_notification_preferences WHERE telegram_chat_id = ? AND telegram_verified = 1`,
        [String(chatId)]
      ).catch(() => null);

      if (existing) {
        await ctx.reply(
          '✅ Your Telegram account is already linked to JellySSO.\n\n' +
          'You will receive notifications here. Use `/help` for available commands.',
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply(
          '👋 *Welcome to JellySSO Bot!*\n\n' +
          'To link your Telegram account, use:\n' +
          '`/link YOUR_CODE_HERE`\n\n' +
          'You can find your verification code in JellySSO Account Settings → Contact Methods.',
          { parse_mode: 'Markdown' }
        );
      }
    });

    // /link <code> — primary linking command
    this.bot.command('link', async (ctx) => {
      await this._handleLinkCommand(ctx);
    });

    // /pin <code> — alias for /link (matches Discord /pin convention)
    this.bot.command('pin', async (ctx) => {
      await this._handleLinkCommand(ctx);
    });

    // /verify <code> — legacy alias kept for backwards compatibility
    this.bot.command('verify', async (ctx) => {
      await this._handleLinkCommand(ctx);
    });

    // /lang <code> — set preferred language (stored for future i18n)
    this.bot.command('lang', async (ctx) => {
      const args = ctx.message.text.split(' ');
      const code = (args[1] || 'en').toLowerCase().slice(0, 5);
      const chatId = ctx.chat.id;
      const linked = await DatabaseManager.queryOne(
        `SELECT user_id FROM user_notification_preferences WHERE telegram_chat_id = ?`,
        [String(chatId)]
      ).catch(() => null);
      if (linked) {
        await DatabaseManager.run(
          `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
          [`user_lang_${linked.user_id}`, code]
        ).catch(() => {});
      }
      await ctx.reply(`🌐 Language preference set to \`${code}\`. (Full i18n support coming soon.)`, { parse_mode: 'Markdown' });
    });

    // Handle /help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🆘 *JellySSO Telegram Bot Help*\n\n' +
        '/start — Welcome & link status\n' +
        '/link \\<code\\> — Link your Telegram account\n' +
        '/pin \\<code\\> — Alias for /link\n' +
        '/lang \\<code\\> — Set language (e.g. en, de, fr)\n' +
        '/help — This help message',
        { parse_mode: 'MarkdownV2' }
      );
    });
  }

  /**
   * Shared handler for /link, /pin, /verify commands
   */
  async _handleLinkCommand(ctx) {
    try {
      const args = ctx.message.text.split(' ');
      const code = args[1];

      if (!code) {
        await ctx.reply(
          'Usage: `/link <code>`\n\nGet your code from Account Settings → Contact Methods.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (!/^[A-Z0-9]{12}$/.test(code)) {
        await ctx.reply('❌ Invalid verification code format. Codes are 12 characters (A–Z, 0–9).');
        return;
      }

      // Check DB-stored codes (used by ContactMethodManager)
      const dbRow = await DatabaseManager.queryOne(
        `SELECT user_id FROM telegram_verification_codes WHERE code = ? AND expires_at > datetime('now')`,
        [code]
      ).catch(() => null);

      if (dbRow) {
        await this.linkUserTelegramAccount(dbRow.user_id, ctx.chat.id);
        await DatabaseManager.run('DELETE FROM telegram_verification_codes WHERE code = ?', [code]).catch(() => {});
        await ctx.reply('✅ Your Telegram account has been linked successfully!\nYou will now receive notifications here.');
        logger.info(`Telegram account linked for user ${dbRow.user_id} (via DB code)`);
        return;
      }

      // Fallback: in-memory codes
      const verification = this.verificationCodes[code];
      if (!verification) {
        await ctx.reply('❌ Verification code not found or expired. Generate a new one in Account Settings.');
        return;
      }

      if (Date.now() - verification.createdAt > 600000) {
        delete this.verificationCodes[code];
        await ctx.reply('❌ Verification code expired. Please generate a new one.');
        return;
      }

      await this.linkUserTelegramAccount(verification.userId, ctx.chat.id);
      delete this.verificationCodes[code];

      await ctx.reply('✅ Your Telegram account has been linked successfully!\nYou will now receive notifications here.');
      logger.info(`Telegram account linked for user ${verification.userId}`);
    } catch (err) {
      logger.error('Telegram link error:', err.message);
      await ctx.reply('❌ An error occurred during verification. Please try again.');
    }
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
