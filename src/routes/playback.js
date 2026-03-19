const express = require('express');
const router = express.Router();
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * PHASE 1: USER-LEVEL PLAYBACK CONTROL
 * Allow users to view and control their own playback sessions
 */

/**
 * GET /api/user/playback/sessions
 * Get all active playback sessions for the current user
 */
router.get('/user/sessions', requireAuth, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Get all sessions for this user
    const allSessions = await jellyfin.getActiveSessions(req.session.user.Id);

    // Log the activity
    await AuditLogger.log('PLAYBACK_VIEW_SESSIONS', req.session.user?.Id, 'playback:sessions', 
      { sessionCount: allSessions.length }, 'success', req.ip);

    res.json({
      success: true,
      sessions: allSessions,
      user: {
        id: req.session.user.Id,
        name: req.session.user.Name
      }
    });
  } catch (error) {
    console.error('Error getting user playback sessions:', error.message);
    
    await AuditLogger.log('PLAYBACK_VIEW_SESSIONS_ERROR', req.session.user?.Id, 'playback:sessions', 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: 'Failed to retrieve playback sessions',
      error: error.message
    });
  }
});

/**
 * POST /api/user/playback/:sessionId/pause
 * Pause playback on the user's session
 */
router.post('/:sessionId/pause', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const sessionExists = sessions.some(s => s.sessionId === sessionId);

    if (!sessionExists) {
      await AuditLogger.log('PLAYBACK_PAUSE_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only control your own playback sessions'
      });
    }

    // Pause playback
    const result = await jellyfin.pausePlayback(sessionId);

    await AuditLogger.log('PLAYBACK_PAUSED', req.session.user?.Id, `playback:${sessionId}`, 
      { sessionId }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Playback paused',
      sessionId
    });
  } catch (error) {
    console.error('Error pausing playback:', error.message);
    
    await AuditLogger.log('PLAYBACK_PAUSE_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/user/playback/:sessionId/resume
 * Resume playback on the user's session
 */
router.post('/:sessionId/resume', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const sessionExists = sessions.some(s => s.sessionId === sessionId);

    if (!sessionExists) {
      await AuditLogger.log('PLAYBACK_RESUME_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only control your own playback sessions'
      });
    }

    // Resume playback
    const result = await jellyfin.resumePlayback(sessionId);

    await AuditLogger.log('PLAYBACK_RESUMED', req.session.user?.Id, `playback:${sessionId}`, 
      { sessionId }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Playback resumed',
      sessionId
    });
  } catch (error) {
    console.error('Error resuming playback:', error.message);
    
    await AuditLogger.log('PLAYBACK_RESUME_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/user/playback/:sessionId/stop
 * Stop playback on the user's session
 */
router.post('/:sessionId/stop', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const sessionExists = sessions.some(s => s.sessionId === sessionId);

    if (!sessionExists) {
      await AuditLogger.log('PLAYBACK_STOP_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only control your own playback sessions'
      });
    }

    // Stop playback
    const result = await jellyfin.stopPlayback(sessionId);

    await AuditLogger.log('PLAYBACK_STOPPED', req.session.user?.Id, `playback:${sessionId}`, 
      { sessionId }, 'success', req.ip);

    res.json({
      success: true,
      message: 'Playback stopped',
      sessionId
    });
  } catch (error) {
    console.error('Error stopping playback:', error.message);
    
    await AuditLogger.log('PLAYBACK_STOP_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /api/user/playback/:sessionId/seek
 * Seek to a specific time in playback
 * Body: { positionSeconds: number } - Position in seconds
 */
router.post('/:sessionId/seek', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { positionSeconds } = req.body;

    if (typeof positionSeconds !== 'number' || positionSeconds < 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid position. Required: positionSeconds (number >= 0)'
      });
    }

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const sessionExists = sessions.some(s => s.sessionId === sessionId);

    if (!sessionExists) {
      await AuditLogger.log('PLAYBACK_SEEK_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only control your own playback sessions'
      });
    }

    // Convert seconds to Jellyfin ticks (100-nanosecond intervals)
    // 1 second = 10,000,000 ticks
    const positionTicks = positionSeconds * 10000000;

    // Seek to position
    const result = await jellyfin.seekPlayback(sessionId, positionTicks);

    await AuditLogger.log('PLAYBACK_SEEKED', req.session.user?.Id, `playback:${sessionId}`, 
      { sessionId, positionSeconds }, 'success', req.ip);

    res.json({
      success: true,
      message: `Seeked to ${positionSeconds} seconds`,
      sessionId,
      positionSeconds
    });
  } catch (error) {
    console.error('Error seeking playback:', error.message);
    
    await AuditLogger.log('PLAYBACK_SEEK_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/user/playback/:sessionId/details
 * Get detailed information about a specific playback session
 */
router.get('/:sessionId/details', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('PLAYBACK_DETAILS_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only view details for your own sessions'
      });
    }

    res.json({
      success: true,
      session: session
    });
  } catch (error) {
    console.error('Error getting session details:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PHASE 3: ADVANCED PLAYBACK FEATURES
 * Subtitle/Audio track selection, queue management, skip functionality
 */

/**
 * GET /user/:sessionId/tracks
 * Get available audio and subtitle tracks for current playback
 */
router.get('/user/:sessionId/tracks', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('PLAYBACK_TRACKS_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only view tracks for your own sessions'
      });
    }

    const tracks = await jellyfin.getAvailableTracks(sessionId);

    await AuditLogger.log('PLAYBACK_VIEW_TRACKS', req.session.user?.Id, `playback:${sessionId}`, 
      { audioTracks: tracks.audioTracks.length, subtitleTracks: tracks.subtitleTracks.length }, 'success', req.ip);

    res.json({
      success: true,
      tracks
    });
  } catch (error) {
    console.error('Error getting available tracks:', error.message, {
      sessionId: req.params.sessionId,
      userId: req.session.user?.Id,
      error: error
    });
    
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /user/:sessionId/audio/:trackIndex
 * Change audio track
 */
router.post('/user/:sessionId/audio/:trackIndex', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId, trackIndex } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('PLAYBACK_AUDIO_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only change audio for your own sessions'
      });
    }

    await jellyfin.setAudioTrack(sessionId, parseInt(trackIndex));

    await AuditLogger.log('PLAYBACK_AUDIO_CHANGED', req.session.user?.Id, `playback:${sessionId}`, 
      { trackIndex }, 'success', req.ip);

    res.json({
      success: true,
      message: `Audio track changed to ${trackIndex}`
    });
  } catch (error) {
    console.error('Error changing audio track:', error.message);
    
    await AuditLogger.log('PLAYBACK_AUDIO_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /user/:sessionId/subtitles/:trackIndex
 * Change subtitle track (-1 to disable)
 */
router.post('/user/:sessionId/subtitles/:trackIndex', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId, trackIndex } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      await AuditLogger.log('PLAYBACK_SUBTITLES_UNAUTHORIZED', req.session.user?.Id, `playback:${sessionId}`, 
        { reason: 'Session does not belong to user' }, 'failure', req.ip);
      
      return res.status(403).json({
        success: false,
        message: 'You can only change subtitles for your own sessions'
      });
    }

    await jellyfin.setSubtitleTrack(sessionId, parseInt(trackIndex));

    await AuditLogger.log('PLAYBACK_SUBTITLES_CHANGED', req.session.user?.Id, `playback:${sessionId}`, 
      { trackIndex }, 'success', req.ip);

    res.json({
      success: true,
      message: trackIndex === '-1' ? 'Subtitles disabled' : `Subtitle track changed to ${trackIndex}`
    });
  } catch (error) {
    console.error('Error changing subtitle track:', error.message);
    
    await AuditLogger.log('PLAYBACK_SUBTITLES_ERROR', req.session.user?.Id, `playback:${req.params.sessionId}`, 
      { error: error.message }, 'failure', req.ip);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /user/:sessionId/queue
 * Get current queue/playlist information
 */
router.get('/user/:sessionId/queue', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(403).json({
        success: false,
        message: 'You can only view queue for your own sessions'
      });
    }

    const queueInfo = await jellyfin.getPlaylistInfo(sessionId);

    res.json({
      success: true,
      queue: queueInfo
    });
  } catch (error) {
    console.error('Error getting queue info:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /user/:sessionId/skip/next
 * Skip to next item
 */
router.post('/user/:sessionId/skip/next', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(403).json({
        success: false,
        message: 'You can only control your own sessions'
      });
    }

    await jellyfin.skipNext(sessionId);

    await AuditLogger.log('PLAYBACK_SKIP_NEXT', req.session.user?.Id, `playback:${sessionId}`, 
      {}, 'success', req.ip);

    res.json({
      success: true,
      message: 'Skipped to next item'
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
 * POST /user/:sessionId/skip/previous
 * Skip to previous item
 */
router.post('/user/:sessionId/skip/previous', requireAuth, csrfProtection, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const jellyfin = new JellyfinAPI(
      SetupManager.getConfig().jellyfinUrl,
      req.session.accessToken
    );

    // Verify the session belongs to the user
    const sessions = await jellyfin.getActiveSessions(req.session.user.Id);
    const session = sessions.find(s => s.sessionId === sessionId);

    if (!session) {
      return res.status(403).json({
        success: false,
        message: 'You can only control your own sessions'
      });
    }

    await jellyfin.skipPrevious(sessionId);

    await AuditLogger.log('PLAYBACK_SKIP_PREVIOUS', req.session.user?.Id, `playback:${sessionId}`, 
      {}, 'success', req.ip);

    res.json({
      success: true,
      message: 'Skipped to previous item'
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
