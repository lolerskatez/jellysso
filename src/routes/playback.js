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

module.exports = router;
