/**
 * SessionEnforcementService
 *
 * Polls Jellyfin's active sessions API on a configurable interval and
 * terminates (stops playback on) sessions that exceed a user's
 * `maxConcurrentStreams` tier limit.
 *
 * Enforcement strategy: when a user exceeds their limit, the oldest active
 * playback sessions (by LastActivityDate) are stopped until the count
 * is within the limit.
 *
 * Configuration (DB settings):
 *   session_enforcement_enabled  — 'true' | 'false' (default: 'false')
 *   session_enforcement_interval — poll interval in seconds (default: 60)
 */

const logger = require('../utils/logger');
const DatabaseManager = require('../models/DatabaseManager');
const SetupManager = require('../models/SetupManager');
const PolicyManager = require('../models/PolicyManager');
const JellyfinAPI = require('../models/JellyfinAPI');

let _timer = null;

async function _getSettings() {
  const [enabled, intervalSecs] = await Promise.all([
    DatabaseManager.getSetting('session_enforcement_enabled'),
    DatabaseManager.getSetting('session_enforcement_interval')
  ]);
  return {
    enabled: enabled === 'true',
    intervalMs: Math.max(30, parseInt(intervalSecs) || 60) * 1000
  };
}

/**
 * Run one enforcement pass:
 * 1. Fetch all active playback sessions from Jellyfin.
 * 2. Group by userId.
 * 3. For each user with more sessions than their tier allows, stop the excess oldest sessions.
 */
async function _enforce() {
  try {
    const config = SetupManager.getConfig();
    if (!config.jellyfinUrl || !config.apiKey) return;

    const jellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);

    // Fetch all currently-playing sessions
    let sessions;
    try {
      sessions = await jellyfin.getActiveSessions(null, true); // playingOnly=true
    } catch (err) {
      logger.warn('SessionEnforcement: could not fetch Jellyfin sessions:', err.message);
      return;
    }

    if (!sessions || sessions.length === 0) return;

    // Group playing sessions by userId
    const byUser = new Map();
    for (const s of sessions) {
      if (!s.userId) continue;
      if (!byUser.has(s.userId)) byUser.set(s.userId, []);
      byUser.get(s.userId).push(s);
    }

    for (const [userId, userSessions] of byUser) {
      // Fetch user's policy to get stream limit
      let policy;
      try {
        policy = await PolicyManager.getUserPolicyWithDetails(userId);
      } catch {
        policy = null;
      }

      const limit = policy?.maxConcurrentStreams ?? 999;

      if (limit >= 999 || userSessions.length <= limit) continue;

      // Sort by LastActivityDate ascending (oldest first) so we stop the oldest streams
      const sorted = [...userSessions].sort((a, b) => {
        const da = new Date(a.lastActivityDate || 0);
        const db_ = new Date(b.lastActivityDate || 0);
        return da - db_;
      });

      const excess = sorted.slice(0, userSessions.length - limit);

      for (const session of excess) {
        try {
          await jellyfin.stopPlayback(session.sessionId);
          logger.info(`SessionEnforcement: stopped session ${session.sessionId} for user ${session.userName} (${userSessions.length}/${limit} streams)`);
        } catch (err) {
          logger.warn(`SessionEnforcement: could not stop session ${session.sessionId}:`, err.message);
        }
      }
    }
  } catch (err) {
    logger.error('SessionEnforcement: unexpected error in enforcement pass:', err.message);
  }
}

async function start() {
  const { enabled, intervalMs } = await _getSettings();
  if (!enabled) {
    logger.info('SessionEnforcementService: disabled via settings — not started.');
    return;
  }

  if (_timer) clearInterval(_timer);
  _timer = setInterval(_enforce, intervalMs);

  logger.info(`SessionEnforcementService: started (interval=${intervalMs / 1000}s)`);
  // Run immediately on start to catch any violations from before restart
  _enforce();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('SessionEnforcementService: stopped.');
  }
}

async function restart() {
  stop();
  await start();
}

module.exports = { start, stop, restart };
