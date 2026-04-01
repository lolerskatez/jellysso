/**
 * JellyfinPinWatcher
 *
 * Watches the Jellyfin data/config directory for password-reset PIN files.
 * When Jellyfin creates a `passwordreset_<userId>.json` file (after a user
 * clicks "Forgot Password" on the Jellyfin login screen), this service reads
 * the file, looks up the user's contact methods, and sends the PIN (or a
 * JellySSO-hosted reset link that consumes the PIN automatically) to the user.
 *
 * PIN file format (Jellyfin 10.x):
 *   { "UserId": "...", "UserName": "...", "Pin": "...", "ExpirationDate": "..." }
 *
 * Configuration (stored in DB settings table):
 *   jellyfin_config_dir  — absolute path to the Jellyfin data directory
 *   pin_reset_mode       — "pin" | "link" (default: "link")
 *                          pin  → send the raw PIN to the user
 *                          link → send a JellySSO URL that auto-applies the PIN
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const DatabaseManager = require('../models/DatabaseManager');
const NotificationManager = require('../models/NotificationManager');
const SetupManager = require('../models/SetupManager');

const PIN_FILE_GLOB = /^passwordreset_(.+)\.json$/i;
const POLL_INTERVAL_MS = 5000; // 5-second poll (fs.watch is unreliable across platforms)
const PROCESSED_SET = new Set(); // track files already handled this session

class JellyfinPinWatcher {
  static instance = null;
  static _pollTimer = null;
  static _configDir = null;

  static getInstance() {
    if (!JellyfinPinWatcher.instance) {
      JellyfinPinWatcher.instance = new JellyfinPinWatcher();
    }
    return JellyfinPinWatcher.instance;
  }

  /**
   * Start watching if a config dir is configured.
   * Safe to call multiple times — idempotent.
   */
  static async start() {
    if (JellyfinPinWatcher._pollTimer) return; // already running

    const configDir = await DatabaseManager.getSetting('jellyfin_config_dir');
    if (!configDir) {
      // Not configured — skip silently
      return;
    }

    const resolved = path.resolve(configDir);
    if (!fs.existsSync(resolved)) {
      logger.warn(`JellyfinPinWatcher: configured directory does not exist: ${resolved}`);
      return;
    }

    JellyfinPinWatcher._configDir = resolved;
    JellyfinPinWatcher._pollTimer = setInterval(
      () => JellyfinPinWatcher._poll().catch(e => logger.error('PinWatcher poll error:', e.message)),
      POLL_INTERVAL_MS
    );

    logger.info(`JellyfinPinWatcher: watching ${resolved} for PIN files (every ${POLL_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop the watcher.
   */
  static stop() {
    if (JellyfinPinWatcher._pollTimer) {
      clearInterval(JellyfinPinWatcher._pollTimer);
      JellyfinPinWatcher._pollTimer = null;
      logger.info('JellyfinPinWatcher: stopped');
    }
  }

  /**
   * Restart — re-reads the config dir setting (e.g. after admin changes it).
   */
  static async restart() {
    JellyfinPinWatcher.stop();
    PROCESSED_SET.clear();
    JellyfinPinWatcher._configDir = null;
    await JellyfinPinWatcher.start();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  static async _poll() {
    const dir = JellyfinPinWatcher._configDir;
    if (!dir) return;

    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      logger.warn(`JellyfinPinWatcher: cannot read directory ${dir}: ${e.message}`);
      return;
    }

    for (const file of files) {
      if (!PIN_FILE_GLOB.test(file)) continue;
      const fullPath = path.join(dir, file);
      if (PROCESSED_SET.has(fullPath)) continue;

      try {
        await JellyfinPinWatcher._handlePinFile(fullPath);
        PROCESSED_SET.add(fullPath);
        // Delete the PIN file after processing so Jellyfin doesn't re-process it
        try { fs.unlinkSync(fullPath); } catch (_) { /* non-fatal */ }
      } catch (err) {
        logger.error(`JellyfinPinWatcher: error handling ${file}: ${err.message}`);
        // Mark as processed anyway to prevent infinite retries on corrupt files
        PROCESSED_SET.add(fullPath);
      }
    }
  }

  static async _handlePinFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      logger.warn(`JellyfinPinWatcher: invalid JSON in ${filePath}`);
      return;
    }

    const { UserId, UserName, Pin, ExpirationDate } = data;
    if (!Pin || !UserName) {
      logger.warn(`JellyfinPinWatcher: PIN file missing required fields: ${filePath}`);
      return;
    }

    logger.info(`JellyfinPinWatcher: processing PIN reset for user ${UserName} (${UserId || 'id unknown'})`);

    // Determine reset mode
    const mode = (await DatabaseManager.getSetting('pin_reset_mode')) || 'link';

    // Build message content
    let subject, body;
    const serverName = SetupManager.getConfig().serverName || 'Jellyfin';
    const expiryStr = ExpirationDate
      ? new Date(ExpirationDate).toLocaleString()
      : 'soon';

    if (mode === 'link') {
      // Build a JellySSO URL that auto-applies the PIN
      const baseUrl = process.env.PUBLIC_URL ||
        (() => { try { return SetupManager.getConfig().webAppPublicUrl; } catch { return ''; } })() ||
        `http://localhost:${process.env.PORT || 3000}`;

      // Encode for safe URL transmission
      const encodedPin = Buffer.from(JSON.stringify({ pin: Pin, username: UserName, userId: UserId }))
        .toString('base64url');
      const resetUrl = `${baseUrl}/auth/pin-reset?data=${encodedPin}`;

      subject = `Reset your ${serverName} password`;
      body = `# Password Reset\n\nA password reset was requested for **${UserName}** on ${serverName}.\n\nClick the link below to set a new password:\n\n${resetUrl}\n\n**This link expires: ${expiryStr}**\n\nIf you did not request this, ignore this message.`;
    } else {
      // Raw PIN mode
      subject = `Your ${serverName} password reset PIN`;
      body = `# Password Reset PIN\n\nA password reset was requested for **${UserName}** on ${serverName}.\n\nYour reset PIN is: **${Pin}**\n\nEnter this PIN on the Jellyfin login screen.\n\n**Expires: ${expiryStr}**\n\nIf you did not request this, ignore this message.`;
    }

    // Find user's contact methods and send notification
    await JellyfinPinWatcher._notifyUser(UserId, UserName, subject, body);
  }

  static async _notifyUser(userId, username, subject, body) {
    try {
      const nm = NotificationManager.getInstance();

      // Try to send via all available channels
      const sent = await nm.sendToUser(userId || username, {
        subject,
        body,
        type: 'PASSWORD_RESET'
      });

      if (!sent) {
        logger.warn(`JellyfinPinWatcher: no contact methods found for user ${username} — PIN reset notification not sent`);
      }
    } catch (err) {
      logger.error(`JellyfinPinWatcher: notification failed for ${username}: ${err.message}`);
    }
  }
}

module.exports = JellyfinPinWatcher;
