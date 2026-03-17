const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');

// Middleware: Require authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

// Middleware: Require admin access
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.Policy && req.session.user.Policy.IsAdministrator) {
    next();
  } else {
    res.status(403).json({ success: false, message: 'Admin access required' });
  }
};

/**
 * PHASE 2: ADMIN-LEVEL PLAYBACK CONTROL
 * Allow administrators to view and control ALL playback sessions system-wide
 */

/**
 * GET /admin/api/playback/sessions
 * Get all active playback sessions across all users (admin only)
 * Optional query params:
 *   - userId: Filter by specific user
 *   - deviceName: Filter by device name
 */
router.get('/playback/sessions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, deviceName } = req.query;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get all active sessions (admin can see all)
    let allSessions = await jellyfin.getActiveSessions();

    // Apply optional filters
    if (userId) {
      allSessions = allSessions.filter(s => s.userId === userId);
    }

    if (deviceName) {
      allSessions = allSessions.filter(s => 
        s.deviceName.toLowerCase().includes(deviceName.toLowerCase())
      );
    }

    // Log the activity
    await AuditLogger.log('ADMIN_PLAYBACK_VIEW_SESSIONS', req.session.user?.Id, 'admin:playback:sessions', 
      { sessionCount: allSessions.length, filters: { userId, deviceName } }, 'success', req.ip);

    res.json({
      success: true,
      sessions: allSessions,
      total: allSessions.length,
      admin: {
        id: req.session.user.Id,
        name: req.session.user.Name
      }
    });
  } catch (error) {
    console.error('Error getting admin playback sessions:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_VIEW_SESSIONS_ERROR', req.session.user?.Id, 'admin:playback:sessions', 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve playback sessions',
      error: error.message
    });
  }
});

/**
 * GET /admin/api/playback/sessions/stats
 * Get playback statistics and summary across all users
 */
router.get('/playback/sessions/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    const allSessions = await jellyfin.getActiveSessions();

    // Calculate statistics
    const stats = {
      totalSessions: allSessions.length,
      activeSessions: allSessions.filter(s => s.playbackState?.isPlaying).length,
      pausedSessions: allSessions.filter(s => s.playbackState?.isPaused).length,
      uniqueUsers: new Set(allSessions.map(s => s.userId)).size,
      uniqueDevices: new Set(allSessions.map(s => s.deviceId)).size,
      contentTypes: {},
      deviceNames: {}
    };

    // Count content types
    allSessions.forEach(session => {
      if (session.nowPlayingItem?.type) {
        stats.contentTypes[session.nowPlayingItem.type] = 
          (stats.contentTypes[session.nowPlayingItem.type] || 0) + 1;
      }
      if (session.deviceName) {
        stats.deviceNames[session.deviceName] = 
          (stats.deviceNames[session.deviceName] || 0) + 1;
      }
    });

    await AuditLogger.log('ADMIN_PLAYBACK_VIEW_STATS', req.session.user?.Id, 'admin:playback:stats', 
      { stats }, 'success', req.ip);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting playback stats:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve playback statistics'
    });
  }
});

/**
 * POST /admin/api/playback/:sessionId/pause
 * Pause playback on ANY session (admin override)
 */
router.post('/playback/:sessionId/pause', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session details
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('ADMIN_PLAYBACK_PAUSE_NOT_FOUND', req.session.user?.Id, `admin:playback:${sessionId}`, 
        { reason: 'Session not found' }, 'failure', req.ip);
      
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Pause playback
    await jellyfin.pausePlayback(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_PAUSED', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { sessionId, userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: `Paused playback on ${session.deviceName} (${session.userName})`,
      sessionId
    });
  } catch (error) {
    console.error('Error pausing playback:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_PAUSE_ERROR', req.session.user?.Id, `admin:playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/api/playback/:sessionId/resume
 * Resume playback on ANY session (admin override)
 */
router.post('/playback/:sessionId/resume', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session details
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('ADMIN_PLAYBACK_RESUME_NOT_FOUND', req.session.user?.Id, `admin:playback:${sessionId}`, 
        { reason: 'Session not found' }, 'failure', req.ip);
      
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Resume playback
    await jellyfin.resumePlayback(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_RESUMED', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { sessionId, userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: `Resumed playback on ${session.deviceName} (${session.userName})`,
      sessionId
    });
  } catch (error) {
    console.error('Error resuming playback:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_RESUME_ERROR', req.session.user?.Id, `admin:playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/api/playback/:sessionId/stop
 * Stop playback on ANY session (admin override)
 * Useful for maintenance or policy enforcement
 */
router.post('/playback/:sessionId/stop', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason } = req.body;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session details
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('ADMIN_PLAYBACK_STOP_NOT_FOUND', req.session.user?.Id, `admin:playback:${sessionId}`, 
        { reason: 'Session not found' }, 'failure', req.ip);
      
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Stop playback
    await jellyfin.stopPlayback(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_STOPPED', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { sessionId, userName: session.userName, deviceName: session.deviceName, adminReason: reason }, 'success', req.ip);

    res.json({
      success: true,
      message: `Stopped playback on ${session.deviceName} (${session.userName})`,
      sessionId
    });
  } catch (error) {
    console.error('Error stopping playback:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_STOP_ERROR', req.session.user?.Id, `admin:playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/api/playback/stop-all
 * Force stop all playback sessions (emergency/maintenance)
 */
router.post('/playback/stop-all', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { reason } = req.body;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get all sessions
    const allSessions = await jellyfin.getActiveSessions();

    if (allSessions.length === 0) {
      res.json({
        success: true,
        message: 'No active sessions to stop',
        stopped: 0
      });
      return;
    }

    // Stop all sessions
    let stopped = 0;
    const errors = [];

    for (const session of allSessions) {
      try {
        await jellyfin.stopPlayback(session.sessionId);
        stopped++;
      } catch (error) {
        errors.push({
          sessionId: session.sessionId,
          error: error.message
        });
      }
    }

    // Log the bulk operation
    await AuditLogger.log('ADMIN_PLAYBACK_STOP_ALL', req.session.user?.Id, 'admin:playback:stop-all', 
      { stopped, tried: allSessions.length, errors: errors.length, reason }, 'success', req.ip);

    res.json({
      success: true,
      message: `Stopped ${stopped} playback sessions`,
      stopped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error stopping all playback:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_STOP_ALL_ERROR', req.session.user?.Id, 'admin:playback:stop-all', 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /admin/api/playback/user/:userId/sessions
 * Get all playback sessions for a specific user
 */
router.get('/playback/user/:userId/sessions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get all sessions and filter by user
    const allSessions = await jellyfin.getActiveSessions(userId);

    await AuditLogger.log('ADMIN_PLAYBACK_USER_SESSIONS', req.session.user?.Id, `admin:playback:user:${userId}`, 
      { sessionCount: allSessions.length }, 'success', req.ip);

    res.json({
      success: true,
      sessions: allSessions,
      userId,
      total: allSessions.length
    });
  } catch (error) {
    console.error('Error getting user playback sessions:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PHASE 3: ADVANCED ADMIN FEATURES
 * Admin-level subtitle/audio selection, queue management
 */

/**
 * GET /admin/playback/:sessionId/tracks
 * Get available audio and subtitle tracks for any session
 */
router.get('/playback/:sessionId/tracks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    const tracks = await jellyfin.getAvailableTracks(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_VIEW_TRACKS', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { audioTracks: tracks.audioTracks.length, subtitleTracks: tracks.subtitleTracks.length }, 'success', req.ip);

    res.json({
      success: true,
      tracks
    });
  } catch (error) {
    console.error('Error getting available tracks:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/playback/:sessionId/audio/:trackIndex
 * Admin: Change audio track on any session
 */
router.post('/playback/:sessionId/audio/:trackIndex', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId, trackIndex } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session info for audit logging
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    await jellyfin.setAudioTrack(sessionId, parseInt(trackIndex));

    await AuditLogger.log('ADMIN_PLAYBACK_AUDIO_CHANGED', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { trackIndex, userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: `Audio track changed to ${trackIndex} on ${session.deviceName}`
    });
  } catch (error) {
    console.error('Error changing audio track:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_AUDIO_ERROR', req.session.user?.Id, `admin:playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/playback/:sessionId/subtitles/:trackIndex
 * Admin: Change subtitle track on any session (-1 to disable)
 */
router.post('/playback/:sessionId/subtitles/:trackIndex', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId, trackIndex } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session info for audit logging
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    await jellyfin.setSubtitleTrack(sessionId, parseInt(trackIndex));

    await AuditLogger.log('ADMIN_PLAYBACK_SUBTITLES_CHANGED', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { trackIndex, userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: trackIndex === '-1' ? `Subtitles disabled on ${session.deviceName}` : `Subtitle track changed to ${trackIndex} on ${session.deviceName}`
    });
  } catch (error) {
    console.error('Error changing subtitle track:', error.message);
    
    await AuditLogger.log('ADMIN_PLAYBACK_SUBTITLES_ERROR', req.session.user?.Id, `admin:playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/playback/:sessionId/skip/next
 * Admin: Skip to next item on any session
 */
router.post('/playback/:sessionId/skip/next', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session info for audit logging
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    await jellyfin.skipNext(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_SKIP_NEXT', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: `Skipped to next on ${session.deviceName}`
    });
  } catch (error) {
    console.error('Error skipping to next:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /admin/playback/:sessionId/skip/previous
 * Admin: Skip to previous item on any session
 */
router.post('/playback/:sessionId/skip/previous', requireAuth, requireAdmin, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get session info for audit logging
    const allSessions = await jellyfin.getActiveSessions();
    const session = allSessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    await jellyfin.skipPrevious(sessionId);

    await AuditLogger.log('ADMIN_PLAYBACK_SKIP_PREVIOUS', req.session.user?.Id, `admin:playback:${sessionId}`, 
      { userName: session.userName, deviceName: session.deviceName }, 'success', req.ip);

    res.json({
      success: true,
      message: `Skipped to previous on ${session.deviceName}`
    });
  } catch (error) {
    console.error('Error skipping to previous:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
