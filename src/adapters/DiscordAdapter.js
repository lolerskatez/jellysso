/**
 * DiscordAdapter - Handle Discord DM notifications, slash commands, role management
 *
 * Features:
 * - Sending DMs to users
 * - Slash-command based account linking (/link <code>)
 * - Server role assignment/removal on account lifecycle events
 * - Admin /inv slash command to generate invite links
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
    this.retryCount = 0;
    this.maxRetries = 5;
    this._serverId = null;
    this._roleId = null;
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

      let Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder;
      try {
        ({ Client, GatewayIntentBits, REST, Routes } = require('discord.js'));
        ({ SlashCommandBuilder } = require('discord.js'));
      } catch {
        logger.warn('discord.js is not installed — Discord notifications disabled. Run: npm install discord.js');
        return false;
      }

      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent
        ]
      });

      this._serverId = serverId || await DatabaseManager.getSetting('discord_server_id').catch(() => null);
      this._roleId   = await DatabaseManager.getSetting('discord_role_id').catch(() => null);

      this.setupEventHandlers();
      await this.client.login(botToken);

      // Register slash commands after login
      this._registerSlashCommands(botToken, REST, Routes, SlashCommandBuilder).catch(err =>
        logger.warn('Discord slash command registration failed:', err.message)
      );

      this.isConnected = true;
      this.retryCount = 0;
      logger.info('Discord bot initialized successfully');
      return true;
    } catch (err) {
      logger.error('Discord bot initialization error:', err.message);
      return false;
    }
  }

  async _registerSlashCommands(botToken, REST, Routes, SlashCommandBuilder) {
    const commands = [
      new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Discord account to JellySSO')
        .addStringOption(opt =>
          opt.setName('code').setDescription('Verification code from your account settings').setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('lang')
        .setDescription('Set your preferred language for bot messages (stub — coming soon)')
        .addStringOption(opt =>
          opt.setName('code').setDescription('Language code, e.g. en, de, fr').setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('inv')
        .setDescription('(Admin) Generate an invite link for a user')
        .addUserOption(opt =>
          opt.setName('user').setDescription('Discord user to invite').setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('email').setDescription('Email address to send invite to').setRequired(false)
        )
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(botToken);
    const appId = this.client.application?.id || this.client.user?.id;
    if (!appId) return;

    if (this._serverId) {
      // Guild-scoped (instant propagation during development)
      await rest.put(Routes.applicationGuildCommands(appId, this._serverId), { body: commands });
    } else {
      // Global (may take ~1h to propagate)
      await rest.put(Routes.applicationCommands(appId), { body: commands });
    }
    logger.info('Discord slash commands registered');
  }

  /**
   * Setup Discord event handlers
   */
  setupEventHandlers() {
    this.client.on('ready', () => {
      logger.info(`Discord bot ready as ${this.client.user.tag}`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      try {
        if (interaction.commandName === 'link') {
          await this._handleLinkCommand(interaction);
        } else if (interaction.commandName === 'lang') {
          await this._handleLangCommand(interaction);
        } else if (interaction.commandName === 'inv') {
          await this._handleInvCommand(interaction);
        }
      } catch (err) {
        logger.error('Discord interaction error:', err.message);
        const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => {});
        } else {
          await interaction.reply(msg).catch(() => {});
        }
      }
    });

    // Keep legacy text-command support for /verify as a fallback
    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (message.content.startsWith('/verify') || message.content.startsWith('/link')) {
        const code = message.content.split(' ')[1];
        if (code) await this._processLinkCode(message.author.id, code, message);
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

  async _handleLinkCommand(interaction) {
    const code = interaction.options.getString('code');
    if (!code || !/^[A-Z0-9]{12}$/.test(code)) {
      return interaction.reply({ content: '❌ Invalid verification code format. Codes are 12 characters (A-Z, 0-9).', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    await this._processLinkCode(interaction.user.id, code, null, interaction);
  }

  async _processLinkCode(discordUserId, code, message = null, interaction = null) {
    const reply = async (text) => {
      if (interaction) return interaction.editReply(text);
      if (message) return message.reply(text);
    };

    const verification = await DatabaseManager.queryOne(
      `SELECT * FROM discord_verification_codes WHERE code = ? AND expires_at > datetime('now')`,
      [code]
    );
    if (!verification) {
      return reply('❌ Verification code not found or expired. Generate a new one in your account settings.');
    }

    await this.linkUserDiscordAccount(verification.user_id, discordUserId);

    await DatabaseManager.run('DELETE FROM discord_verification_codes WHERE code = ?', [code]);

    // Apply server role if configured
    await this.applyRole(discordUserId).catch(err => logger.warn('Role apply failed:', err.message));

    await reply('✅ Your Discord account has been linked successfully! You will now receive notifications here.');
    logger.info(`Discord account linked for user ${verification.user_id}`);
  }

  async _handleLangCommand(interaction) {
    const code = interaction.options.getString('code') || 'en';
    // Language preference stored for future i18n support
    const userId = await this._getJellyfinUserIdByDiscord(interaction.user.id);
    if (userId) {
      await DatabaseManager.run(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
        [`user_lang_${userId}`, code]
      ).catch(() => {});
    }
    await interaction.reply({ content: `🌐 Language preference set to \`${code}\`. (Full i18n support coming soon.)`, ephemeral: true });
  }

  async _handleInvCommand(interaction) {
    // Only guild admins may use this command
    const member = interaction.member;
    if (!member?.permissions?.has('Administrator')) {
      return interaction.reply({ content: '❌ This command requires Administrator permissions.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Lazy-require to avoid circular deps at module load time
      const InviteManager = require('./InviteManager');
      const inviteManager = InviteManager.getInstance ? InviteManager.getInstance() : new InviteManager();

      // Use default signup profile
      const profiles = await DatabaseManager.query(
        `SELECT id FROM signup_profiles WHERE isActive = 1 ORDER BY createdAt ASC LIMIT 1`
      );
      if (!profiles.length) {
        return interaction.editReply('❌ No active signup profiles found. Create one in the admin panel first.');
      }

      const invite = await inviteManager.createInvite({
        signupProfileId: profiles[0].id,
        createdBy: `discord:${interaction.user.id}`,
        maxUses: 1
      });

      const config = SetupManager.getConfig();
      const baseUrl = config.webAppPublicUrl || `http://localhost:${process.env.PORT || 3000}`;
      const inviteUrl = `${baseUrl}/signup?invite=${invite.code}`;

      // Try to DM the target user if specified
      const targetUser = interaction.options.getUser('user');
      if (targetUser) {
        try {
          const dmChannel = await targetUser.createDM();
          await dmChannel.send(`🎉 You've been invited to JellySSO!\n\n${inviteUrl}\n\n*This invite expires in 7 days and can only be used once.*`);
          return interaction.editReply(`✅ Invite sent to ${targetUser.tag} via DM.\n\nLink: ${inviteUrl}`);
        } catch {
          return interaction.editReply(`⚠️ Could not DM ${targetUser.tag} (DMs may be disabled).\n\nLink: \`${inviteUrl}\``);
        }
      }

      return interaction.editReply(`✅ Invite created!\n\nLink: \`${inviteUrl}\``);
    } catch (err) {
      logger.error('Discord /inv error:', err.message);
      return interaction.editReply('❌ Failed to create invite: ' + err.message);
    }
  }

  async _getJellyfinUserIdByDiscord(discordUserId) {
    const row = await DatabaseManager.queryOne(
      `SELECT user_id FROM user_notification_preferences WHERE discord_user_id = ?`,
      [discordUserId]
    ).catch(() => null);
    return row?.user_id || null;
  }

  /**
   * Link Discord user ID to JellySSO user
   */
  async linkUserDiscordAccount(userId, discordUserId) {
    const affected = await DatabaseManager.run(
      `UPDATE user_notification_preferences 
       SET discord_user_id = ?, discord_verified = 1
       WHERE user_id = ?`,
      [discordUserId, userId]
    );

    if (!affected || affected.changes === 0) {
      await DatabaseManager.run(
        `INSERT INTO user_notification_preferences 
         (id, user_id, discord_user_id, discord_verified, discord_enabled)
         VALUES (?, ?, ?, 1, 1)`,
        [`prefs_${userId}_${Date.now()}`, userId, discordUserId]
      );
    }
    return true;
  }

  /**
   * Generate verification code for user
   */
  async generateVerificationCode(userId) {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase().substring(0, 12);
    const expiresAt = new Date(Date.now() + 600000).toISOString();

    await DatabaseManager.run('DELETE FROM discord_verification_codes WHERE user_id = ?', [userId]);
    await DatabaseManager.run(
      `INSERT INTO discord_verification_codes (code, user_id, expires_at) VALUES (?, ?, ?)`,
      [code, userId, expiresAt]
    );

    return code;
  }

  // ============================================================================
  // Role management
  // ============================================================================

  /**
   * Assign the configured member role to a Discord user in the server.
   * @param {string} discordUserId
   */
  async applyRole(discordUserId) {
    if (!this.isConnected || !this.client) return { success: false, reason: 'not connected' };
    const roleId = this._roleId || await DatabaseManager.getSetting('discord_role_id').catch(() => null);
    const serverId = this._serverId || await DatabaseManager.getSetting('discord_server_id').catch(() => null);
    if (!roleId || !serverId) return { success: false, reason: 'role or server not configured' };

    try {
      const guild = await this.client.guilds.fetch(serverId);
      const member = await guild.members.fetch(discordUserId);
      await member.roles.add(roleId);
      logger.info(`Discord: applied role ${roleId} to user ${discordUserId}`);
      return { success: true };
    } catch (err) {
      logger.warn(`Discord: applyRole failed for ${discordUserId}: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Remove the configured member role from a Discord user.
   * @param {string} discordUserId
   */
  async removeRole(discordUserId) {
    if (!this.isConnected || !this.client) return { success: false, reason: 'not connected' };
    const roleId = this._roleId || await DatabaseManager.getSetting('discord_role_id').catch(() => null);
    const serverId = this._serverId || await DatabaseManager.getSetting('discord_server_id').catch(() => null);
    if (!roleId || !serverId) return { success: false, reason: 'role or server not configured' };

    try {
      const guild = await this.client.guilds.fetch(serverId);
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) return { success: true }; // user left server — nothing to remove
      await member.roles.remove(roleId);
      logger.info(`Discord: removed role ${roleId} from user ${discordUserId}`);
      return { success: true };
    } catch (err) {
      logger.warn(`Discord: removeRole failed for ${discordUserId}: ${err.message}`);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Update the cached role ID (called when admin changes the setting).
   */
  setRoleId(roleId) {
    this._roleId = roleId || null;
  }

  // ============================================================================
  // Messaging
  // ============================================================================

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
          this.initialize(config.discord.botToken, this._serverId);
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
      status: this.client?.status || 'DISCONNECTED'
    };
  }
}

module.exports = DiscordAdapter;


class DiscordAdapter {
  static instance = null;
  
  constructor() {
    this.client = null;
    this.isConnected = false;
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
      const verification = await DatabaseManager.queryOne(
        `SELECT * FROM discord_verification_codes
         WHERE code = ? AND expires_at > datetime('now')`,
        [code]
      );
      if (!verification) {
        await message.reply('\u274c Verification code not found or expired');
        return;
      }

      // Link user Discord ID to JellySSO user
      await this.linkUserDiscordAccount(verification.user_id, message.author.id);
      
      // Cleanup code
      await DatabaseManager.query(
        'DELETE FROM discord_verification_codes WHERE code = ?',
        [code]
      );

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
    const affected = await DatabaseManager.query(
      `UPDATE user_notification_preferences 
       SET discord_user_id = ?, discord_verified = 1
       WHERE user_id = ?`,
      [discordUserId, userId]
    );
    
    // If no rows affected, insert new preference record
    if (!affected || affected.changes === 0) {
      await DatabaseManager.query(
        `INSERT INTO user_notification_preferences 
         (id, user_id, discord_user_id, discord_verified, discord_enabled)
         VALUES (?, ?, ?, 1, 1)`,
        [`prefs_${userId}_${Date.now()}`, userId, discordUserId]
      );
    }
    return true;
  }

  /**
   * Generate verification code for user
   */
  async generateVerificationCode(userId) {
    const code = crypto.randomBytes(6).toString('hex').toUpperCase().substring(0, 12);
    const expiresAt = new Date(Date.now() + 600000).toISOString(); // 10 minutes

    // Remove any existing code for this user
    await DatabaseManager.query(
      'DELETE FROM discord_verification_codes WHERE user_id = ?',
      [userId]
    );
    // Insert new code
    await DatabaseManager.query(
      `INSERT INTO discord_verification_codes (code, user_id, expires_at)
       VALUES (?, ?, ?)`,
      [code, userId, expiresAt]
    );

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
