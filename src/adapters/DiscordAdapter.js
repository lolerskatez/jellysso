/**
 * DiscordAdapter - Handle Discord DM notifications and verification
 * 
 * Handles:
 * - Sending DMs to users
 * - User verification flow via /verify command
 * - Bot client management
 * - Error handling and reconnection
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const SetupManager = require('./SetupManager');
const DatabaseManager = require('./DatabaseManager');

class DiscordAdapter {
  static instance = null;
  
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.verificationCodes = {}; // In-memory, should be in DB for production
    this.retryCount = 0;
    this.maxRetries = 5;
  }

  static getInstance() {
    if (!DiscordAdapter.instance) {
      DiscordAdapter.instance = new DiscordAdapter();
    }
    return DiscordAdapter.instance;
  }

  /**
   * Initialize Discord bot client
   */
  async initialize(botToken, serverId = null) {
    try {
      if (!botToken) {
        logger.warn('Discord bot token not provided');
        return false;
      }

      let Client, GatewayIntentBits;
      try {
        ({ Client, GatewayIntentBits } = require('discord.js'));
      } catch {
        logger.warn('discord.js is not installed — Discord notifications disabled. Run: npm install discord.js');
        return false;
      }

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent
        ]
      });

      this.setupEventHandlers();
      await this.client.login(botToken);

      this.isConnected = true;
      this.retryCount = 0;
      logger.info('Discord bot initialized successfully');
      return true;
    } catch (err) {
      logger.error('Discord bot initialization error:', err.message);
      return false;
    }
  }

  /**
   * Setup Discord event handlers
   */
  setupEventHandlers() {
    this.client.on('ready', () => {
      logger.info(`Discord bot ready as ${this.client.user.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Handle verification command
      if (message.content.startsWith('/verify')) {
        await this.handleVerificationCommand(message);
      }
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error.message);
      this.handleDisconnection();
    });

    this.client.on('disconnect', () => {
      logger.warn('Discord bot disconnected');
      this.handleDisconnection();
    });
  }

  /**
   * Handle /verify command from user
   */
  async handleVerificationCommand(message) {
    try {
      const args = message.content.split(' ');
      const code = args[1];

      if (!code) {
        await message.reply('Usage: `/verify <code>`');
        return;
      }

      // Validate code format
      if (!/^[A-Z0-9]{12}$/.test(code)) {
        await message.reply('❌ Invalid verification code format');
        return;
      }

      // Check if code exists and is valid
      const verification = this.verificationCodes[code];
      if (!verification) {
        await message.reply('❌ Verification code not found or expired');
        return;
      }

      // Check if code is expired (10 minutes)
      if (Date.now() - verification.createdAt > 600000) {
        delete this.verificationCodes[code];
        await message.reply('❌ Verification code expired');
        return;
      }

      // Link user Discord ID to JellySSO user
      await this.linkUserDiscordAccount(verification.userId, message.author.id);
      
      // Cleanup code
      delete this.verificationCodes[code];

      // Confirm to user
      await message.reply('✅ Your Discord account has been linked successfully!');
      logger.info(`Discord account linked for user ${verification.userId}`);
    } catch (err) {
      logger.error('Discord verification error:', err.message);
      await message.reply('❌ An error occurred during verification');
    }
  }

  /**
   * Link Discord user ID to JellySSO user
   */
  async linkUserDiscordAccount(userId, discordUserId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      
      db.run(
        `UPDATE user_notification_preferences 
         SET discord_user_id = ?, discord_verified = 1
         WHERE user_id = ?`,
        [discordUserId, userId],
        function(err) {
          if (err) return reject(err);
          
          // If no rows affected, insert new preference record
          if (this.changes === 0) {
            db.run(
              `INSERT INTO user_notification_preferences 
               (id, user_id, discord_user_id, discord_verified, discord_enabled)
               VALUES (?, ?, ?, 1, 1)`,
              [`prefs_${userId}_${Date.now()}`, userId, discordUserId],
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
   * Send DM to user
   */
  async send(discordUserId, message) {
    try {
      if (!this.isConnected || !this.client) {
        throw new Error('Discord client not connected');
      }

      const user = await this.client.users.fetch(discordUserId);
      if (!user) {
        throw new Error(`Discord user ${discordUserId} not found`);
      }

      // Create embed for rich message formatting
      const embed = {
        title: message.title,
        description: message.body,
        color: 0x0d47a1,
        timestamp: new Date().toISOString()
      };

      const dmChannel = await user.createDM();
      await dmChannel.send({ embeds: [embed] });

      logger.info(`Discord DM sent to ${discordUserId}`);
      return { success: true, discordId: discordUserId };
    } catch (err) {
      logger.error('Discord send error:', err.message);
      throw err;
    }
  }

  /**
   * Test Discord connection
   */
  async testConnection() {
    try {
      if (!this.client || !this.isConnected) {
        return { success: false, message: 'Bot not connected' };
      }

      return {
        success: true,
        botTag: this.client.user.tag,
        status: this.client.status
      };
    } catch (err) {
      logger.error('Discord test error:', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Handle bot disconnection with retry
   */
  handleDisconnection() {
    this.isConnected = false;

    if (this.retryCount < this.maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
      this.retryCount++;
      
      logger.info(`Discord reconnection attempt ${this.retryCount} in ${backoffMs}ms`);
      
      setTimeout(() => {
        const config = SetupManager.getConfig();
        if (config.discord?.botToken) {
          this.initialize(config.discord.botToken);
        }
      }, backoffMs);
    } else {
      logger.error('Discord bot max retry attempts exceeded');
    }
  }

  /**
   * Disconnect bot gracefully
   */
  async disconnect() {
    try {
      if (this.client) {
        await this.client.destroy();
        this.isConnected = false;
        logger.info('Discord bot disconnected');
      }
    } catch (err) {
      logger.error('Discord disconnect error:', err.message);
    }
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      connected: this.isConnected,
      botTag: this.client?.user?.tag || 'Not connected',
      status: this.client?.status || 'DISCONNECTED',
      pendingVerifications: Object.keys(this.verificationCodes).length
    };
  }
}

module.exports = DiscordAdapter;
