const axios = require('axios');
const logger = require('../utils/logger');

class JellyfinAPI {
  constructor(baseURL, apiKey = null) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-Emby-Token': apiKey })
      },
      // Connection pooling
      maxContentLength: 50 * 1024 * 1024, // 50MB max
      maxBodyLength: 50 * 1024 * 1024,
    });
  }

  /**
   * Centralized error handler for API calls
   * @param {Error} error - The error object from axios
   * @param {string} context - Context of the operation for better error messages
   * @returns {Error} - Formatted error with appropriate message
   */
  handleApiError(error, context = 'API call') {
    // Network errors
    if (error.code === 'ECONNREFUSED') {
      return new Error(`${context}: Unable to connect to Jellyfin server. Please check the server URL and network connection.`);
    }
    if (error.code === 'ENOTFOUND') {
      return new Error(`${context}: Jellyfin server hostname not found. Please verify the server URL.`);
    }
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return new Error(`${context}: Request timeout. The Jellyfin server is not responding.`);
    }

    // HTTP response errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) {
        return new Error(`${context}: Authentication failed. Invalid or expired API key.`);
      }
      if (status === 403) {
        return new Error(`${context}: Access forbidden. Insufficient permissions.`);
      }
      if (status === 404) {
        return new Error(`${context}: Resource not found.`);
      }
      if (status === 503) {
        return new Error(`${context}: Jellyfin server is temporarily unavailable. Please try again later.`);
      }
      if (status >= 500) {
        return new Error(`${context}: Jellyfin server error (${status}). Please try again later.`);
      }
      
      // Use response message if available
      const message = data?.message || data?.error || error.message;
      return new Error(`${context}: ${message || `HTTP ${status}`}`);
    }

    // Generic error
    return new Error(`${context}: ${error.message || 'Unknown error'}`);
  }

  async testConnection() {
    try {
      // Use a public endpoint that doesn't require authentication
      const response = await this.client.get('/System/Info/Public');
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Jellyfin server. Please check the server URL and network connection.');
      }
      if (error.response?.status === 503) {
        throw new Error('Jellyfin server is temporarily unavailable. Please try again later.');
      }
      // For other errors (like 401 unauthorized), the server is reachable but may require auth
      if (error.response?.status === 401) {
        throw new Error('Jellyfin server is reachable but requires authentication. This is normal.');
      }
      throw new Error(`Connection test failed: ${error.response?.status || error.message}`);
    }
  }

  async authenticateByName(username, password) {
    // Save original headers BEFORE try so catch block can restore them
    const originalHeaders = { ...this.client.defaults.headers };
    try {
      logger.info(`Attempting authentication to ${this.baseURL}/Users/AuthenticateByName for user: ${username}`);
      this.client.defaults.headers = {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': 'MediaBrowser Client="Jellyfin Companion", Device="Setup Wizard", DeviceId="setup-001", Version="1.0.0"'
      };
      
      const response = await this.client.post('/Users/AuthenticateByName', {
        Username: username,
        Pw: password
      });
      
      // Restore original headers
      this.client.defaults.headers = originalHeaders;
      
      logger.info('Authentication successful');
      // Set the token for future requests
      this.apiKey = response.data.AccessToken;
      this.client.defaults.headers['X-Emby-Token'] = this.apiKey;
      return response.data;
    } catch (error) {
      // Restore original headers even on error
      try {
        this.client.defaults.headers = { ...originalHeaders };
      } catch (e) {
        // Ignore errors when restoring headers
      }
      
      logger.error('Authentication error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        code: error.code
      });
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Jellyfin server. Please check the server URL and network connection.');
      }
      if (error.response?.status === 503) {
        throw new Error('Jellyfin server is temporarily unavailable. Please try again later.');
      }
      // Handle case where error.response is undefined
      const errorMessage = error.response?.data?.message || error.message || 'Unknown authentication error';
      throw new Error(`Authentication failed: ${errorMessage}`);
    }
  }

  async getUsers() {
    const cacheKey = 'users';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.client.get('/Users');
      this.setCached(cacheKey, response.data);
      return response.data;
    } catch (error) {
      throw this.handleApiError(error, 'Failed to get users');
    }
  }

  async getUser(userId) {
    try {
      const response = await this.client.get(`/Users/${userId}`);
      return response.data;
    } catch (error) {
      throw this.handleApiError(error, `Failed to get user ${userId}`);
    }
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCached(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  async createUser(userData) {
    try {
      // Handle both string username and object formats
      let payload = typeof userData === 'string' ? { Name: userData } : userData;
      
      // SECURITY: Always set a strong random password for SSO-created users
      // This prevents users from bypassing SSO and logging in directly to Jellyfin
      if (!payload.Password) {
        const crypto = require('crypto');
        payload.Password = crypto.randomBytes(32).toString('hex') + crypto.randomBytes(32).toString('base64');
        logger.info(`🔒 Generated secure random password for user: ${payload.Name} (prevents direct Jellyfin login)`);
      }
      
      const response = await this.client.post('/Users/New', payload);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }

  async updateUser(userId, userData) {
    try {
      const response = await this.client.post(`/Users/${userId}`, userData);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
  }

  async updateUserPolicy(userId, policyData) {
    try {
      // The Jellyfin API /Users/{userId}/Policy endpoint requires a complete Policy object
      // Merge the provided data with defaults to ensure all required fields are present
      const defaultPolicy = {
        IsAdministrator: false,
        IsHidden: false,
        IsDisabled: false,
        BlockedTags: [],
        EnableSharedDeviceControl: false,
        EnableRemoteControlOfOtherUsers: false,
        EnableLiveTvManagement: false,
        EnableLiveTvAccess: false,
        EnableMediaPlayback: true,
        EnableAudioPlaybackTranscoding: true,
        EnableVideoPlaybackTranscoding: true,
        EnablePlaybackRemuxing: true,
        ForceRemoteSourceTranscoding: false,
        EnableContentDeletion: false,
        EnableContentDownloading: true,
        EnableSyncTranscoding: true,
        EnableMediaConversion: true,
        InvalidLoginAttemptCount: 0,
        LoginAttemptsBeforeLockout: -1,
        MaxActiveSessions: 0,
        EnableAllChannels: true,
        EnableAllFolders: true,
        EnableAllDevices: true
      };

      // Get current policy first to preserve other settings
      const currentUser = await this.getUser(userId);
      const currentPolicy = currentUser.Policy || {};
      
      // Merge: defaults → current → new updates
      const mergedPolicy = {
        ...defaultPolicy,
        ...currentPolicy,
        ...policyData
      };

      logger.info(`Updating user ${userId} policy:`, mergedPolicy);
      const response = await this.client.post(`/Users/${userId}/Policy`, mergedPolicy);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update user policy: ${error.message}`);
    }
  }

  async updateUserConfiguration(userId, configData) {
    try {
      // Get current user configuration first to preserve other settings
      const currentUser = await this.getUser(userId);
      const currentConfig = currentUser.Configuration || {};
      
      // Merge current configuration with updates
      const mergedConfig = {
        ...currentConfig,
        ...configData
      };

      logger.info(`Updating user ${userId} configuration:`, mergedConfig);
      const response = await this.client.post(`/Users/${userId}/Configuration`, mergedConfig);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update user configuration: ${error.message}`);
    }
  }

  async resetUserPassword(userId, newPassword) {
    try {
      const response = await this.client.post(`/Users/${userId}/Password`, {
        Id: userId,
        NewPw: newPassword,
        ResetPassword: false
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to reset user password: ${error.message}`);
    }
  }

  /**
   * Apply a Jellyfin-generated PIN to a username (ForgotPassword flow).
   * Submits the PIN to Jellyfin's /Users/ForgotPassword/Pin endpoint.
   */
  async resetPasswordWithPin(username, pin) {
    try {
      const response = await this.client.post('/Users/ForgotPassword/Pin', {
        Pin: pin
      });
      return response.data;
    } catch (error) {
      throw this.handleApiError(error, `PIN reset for ${username}`);
    }
  }

  /**
   * Change a user's password given the current (old) password and the new one.
   * Used after applying a PIN to immediately set a user-chosen password.
   */
  async updateUserPassword(userId, currentPassword, newPassword) {
    try {
      const response = await this.client.post(`/Users/${userId}/Password`, {
        Id: userId,
        CurrentPw: currentPassword,
        NewPw: newPassword
      });
      return response.data;
    } catch (error) {
      throw this.handleApiError(error, `update password for user ${userId}`);
    }
  }

  async deleteUser(userId) {
    try {
      // Jellyfin API returns 204 No Content on success
      await this.client.delete(`/Users/${userId}`);
      return { success: true };
    } catch (error) {
      // Preserve the original error response for better debugging
      const err = new Error(`Failed to delete user: ${error.response?.status || error.message}`);
      err.response = error.response;
      throw err;
    }
  }

  async checkQuickConnectEnabled() {
    try {
      const response = await this.client.get('/QuickConnect/Enabled');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to check QuickConnect: ${error.message}`);
    }
  }

  async initiateQuickConnect() {
    try {
      const response = await this.client.post('/QuickConnect/Initiate');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to initiate QuickConnect: ${error.message}`);
    }
  }

  async getQuickConnectState(secret) {
    try {
      // GET request with Secret as query parameter
      const response = await this.client.get('/QuickConnect/Connect', {
        params: { Secret: secret }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get QuickConnect state: ${error.message}`);
    }
  }

  async authorizeQuickConnect(code, userId) {
    try {
      const response = await this.client.post('/QuickConnect/Authorize', null, {
        params: { code, userId }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to authorize QuickConnect: ${error.message}`);
    }
  }

  async authenticateWithQuickConnect(secret) {
    try {
      const response = await this.client.post('/Users/AuthenticateWithQuickConnect', { Secret: secret });
      // Set token for future requests
      this.apiKey = response.data.AccessToken;
      this.client.defaults.headers['X-Emby-Token'] = this.apiKey;
      return response.data;
    } catch (error) {
      throw new Error(`QuickConnect authentication failed: ${error.message}`);
    }
  }

  async getPendingQuickConnectSessions() {
    // Jellyfin doesn't expose pending sessions via API
    // This should be called from our backend which manages pending sessions
    return [];
  }

  async approveQuickConnectSession(code, userId) {
    // Jellyfin Quick Connect doesn't require explicit approval
    // The authorization happens via /QuickConnect/Authorize
    try {
      const response = await this.client.post('/QuickConnect/Authorize', null, {
        params: {
          code: code
        }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to approve quick connect session: ${error.message}`);
    }
  }

  async rejectQuickConnectSession(code) {
    // Jellyfin doesn't have a reject endpoint
    // We'll simulate it by removing from our pending sessions tracking
    return { success: true };
  }

  async getSystemConfiguration() {
    try {
      const response = await this.client.get('/System/Configuration');
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        logger.error('❌ Authentication failed with status 401 on System/Configuration');
        logger.error(`   API Key (first 16 chars): ${this.apiKey?.substring(0, 16)}...`);
        throw new Error(`Failed to get system configuration: Invalid or expired API key (401)`);
      }
      throw new Error(`Failed to get system configuration: ${error.message}`);
    }
  }

  async updateSystemConfiguration(config) {
    try {
      const response = await this.client.post('/System/Configuration', config);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update system configuration: ${error.message}`);
    }
  }

  async getActivityLog(startIndex = 0, limit = 50) {
    try {
      const response = await this.client.get('/System/ActivityLog/Entries', {
        params: { startIndex, limit }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get activity log: ${error.message}`);
    }
  }

  // ============ PLAYBACK SESSION MANAGEMENT ============

  /**
   * Get all active playback sessions
   * Returns sessions for all users (admin only) or can be filtered by userId
   * @param {string|null} userId - User ID to filter by (optional)
   * @param {boolean} playingOnly - Only return sessions with active playback (optional)
   */
  async getActiveSessions(userId = null, playingOnly = false) {
    try {
      const response = await this.client.get('/Sessions');
      let sessions = response.data;

      // Filter by userId if provided
      if (userId) {
        sessions = sessions.filter(session => session.UserId === userId);
      }

      // Filter to only sessions with active playback if requested
      if (playingOnly) {
        sessions = sessions.filter(session => session.NowPlayingItem);
      }

      // Clean up and normalize session data
      return sessions.map(session => ({
        sessionId: session.Id,
        userId: session.UserId,
        userName: session.UserName,
        deviceId: session.DeviceId,
        deviceName: session.DeviceName,
        appName: session.AppName || session.Client || 'Unknown',
        appVersion: session.AppVersion || session.ApplicationVersion || 'Unknown',
        isPlaying: session.NowPlayingItem ? true : false,
        nowPlayingItem: session.NowPlayingItem ? {
          id: session.NowPlayingItem.Id,
          name: session.NowPlayingItem.Name,
          type: session.NowPlayingItem.Type,
          seriesName: session.NowPlayingItem.SeriesName,
          seasonName: session.NowPlayingItem.SeasonName,
          episodeNumber: session.NowPlayingItem.IndexNumber,
          primaryImageUrl: session.NowPlayingItem.ImageTags?.Primary ? 
            `/Items/${session.NowPlayingItem.Id}/Images/Primary?maxWidth=256&tag=${session.NowPlayingItem.ImageTags.Primary}` : null
        } : null,
        playbackState: session.PlayState ? {
          position: session.PlayState.PositionTicks,
          isPaused: session.PlayState.IsPaused,
          isPlaying: !session.PlayState.IsPaused
        } : null,
        remoteAddress: session.RemoteAddr,
        lastActivityDate: session.LastActivityDate
      }));
    } catch (error) {
      throw new Error(`Failed to get active sessions: ${error.message}`);
    }
  }

  /**
   * Pause playback on a session
   */
  async pausePlayback(sessionId) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/Pause`);
      return { success: true, message: 'Playback paused' };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found or already ended');
      }
      throw new Error(`Failed to pause playback: ${error.message}`);
    }
  }

  /**
   * Resume playback on a session
   */
  async resumePlayback(sessionId) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/Unpause`);
      return { success: true, message: 'Playback resumed' };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found or already ended');
      }
      throw new Error(`Failed to resume playback: ${error.message}`);
    }
  }

  /**
   * Stop playback on a session
   */
  async stopPlayback(sessionId) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/Stop`);
      return { success: true, message: 'Playback stopped' };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found or already ended');
      }
      throw new Error(`Failed to stop playback: ${error.message}`);
    }
  }

  /**
   * Seek to specific position in current playback
   * @param {string} sessionId - Session ID
   * @param {number} positionTicks - Position in 100-nanosecond ticks (e.g., 30 seconds = 300000000)
   */
  async seekPlayback(sessionId, positionTicks) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/Seek`, null, {
        params: { seekPositionTicks: positionTicks }
      });
      return { success: true, message: 'Seeked to position' };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found or already ended');
      }
      throw new Error(`Failed to seek playback: ${error.message}`);
    }
  }

  /**
   * Send a generic message/command to a session
   * Can be used for key presses, navigation, etc.
   * @param {string} sessionId - Session ID
   * @param {string} messageType - Type of message (e.g., 'play', 'pause', 'next', 'previous')
   * @param {object} data - Additional message data
   */
  async sendSessionMessage(sessionId, messageType, data = {}) {
    try {
      const messageBody = {
        Header: 'Message',
        MessageType: messageType,
        ...data
      };
      
      await this.client.post(`/Sessions/${sessionId}/Message`, messageBody);
      return { success: true, message: `Message sent: ${messageType}` };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found');
      }
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Get session details
   */
  async getSessionDetails(sessionId) {
    try {
      const response = await this.client.get(`/Sessions/${sessionId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        // Session no longer exists - return null instead of throwing
        // This can happen when sessions expire or clients disconnect
        return null;
      }
      
      // Log detailed error information for debugging
      logger.error(`getSessionDetails error: ${error.message}`, {
        sessionId,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        code: error.code
      });
      
      throw this.handleApiError(error, `Failed to get session details for sessionId ${sessionId}`);
    }
  }

  /**
   * Get available audio and subtitle tracks for current item
   * @param {string} sessionId - Session ID
   */
  async getAvailableTracks(sessionId) {
    try {
      const session = await this.getSessionDetails(sessionId);
      
      if (!session || !session.NowPlayingItem) {
        return {
          audioTracks: [],
          subtitleTracks: [],
          currentAudioTrack: null,
          currentSubtitleTrack: null
        };
      }

      const item = session.NowPlayingItem;
      const mediaStreams = item.MediaStreams || [];
      
      // Extract audio tracks
      const audioTracks = mediaStreams
        .filter(s => s && s.Type === 'Audio')
        .map(s => ({
          id: s.Index,
          language: s.Language || 'Unknown',
          codec: s.Codec || 'Unknown',
          displayName: `${s.Language || 'Unknown'} (${s.Codec || 'Unknown'})`,
          channels: s.Channels || 2,
          bitRate: s.BitRate
        })) || [];
      
      // Extract subtitle tracks
      const subtitleTracks = mediaStreams
        .filter(s => s && s.Type === 'Subtitle')
        .map(s => ({
          id: s.Index,
          language: s.Language || 'Unknown',
          codec: s.Codec || 'Unknown',
          displayName: `${s.Language || 'Unknown'} (${s.Codec || 'Unknown'})`,
          isDefault: s.IsDefault || false,
          isForced: s.IsForced || false
        })) || [];
      
      // Get current stream indices, with fallback values
      const playState = session.PlayState || {};
      const currentAudioTrack = typeof playState.AudioStreamIndex === 'number' ? playState.AudioStreamIndex : null;
      const currentSubtitleTrack = typeof playState.SubtitleStreamIndex === 'number' ? playState.SubtitleStreamIndex : null;
      
      return {
        audioTracks,
        subtitleTracks,
        currentAudioTrack,
        currentSubtitleTrack
      };
    } catch (error) {
      logger.error(`getAvailableTracks error for sessionId ${sessionId}: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Change audio track
   * @param {string} sessionId - Session ID
   * @param {number} audioTrackIndex - Audio track index
   */
  async setAudioTrack(sessionId, audioTrackIndex) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/SetAudioStreamIndex`, null, {
        params: { index: audioTrackIndex }
      });
      return { success: true, message: `Audio track changed to ${audioTrackIndex}` };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found');
      }
      logger.error(`setAudioTrack error: ${error.message}`, { sessionId, audioTrackIndex, error });
      throw this.handleApiError(error, `Failed to change audio track for sessionId ${sessionId}`);
    }
  }

  /**
   * Change subtitle track
   * @param {string} sessionId - Session ID
   * @param {number} subtitleTrackIndex - Subtitle track index (-1 to disable)
   */
  async setSubtitleTrack(sessionId, subtitleTrackIndex) {
    try {
      await this.client.post(`/Sessions/${sessionId}/Playing/SetSubtitleStreamIndex`, null, {
        params: { index: subtitleTrackIndex }
      });
      return { success: true, message: `Subtitle track changed to ${subtitleTrackIndex}` };
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Session not found');
      }
      logger.error(`setSubtitleTrack error: ${error.message}`, { sessionId, subtitleTrackIndex, error });
      throw this.handleApiError(error, `Failed to change subtitle track for sessionId ${sessionId}`);
    }
  }

  /**
   * Get current playlist/queue information
   * @param {string} sessionId - Session ID
   */
  async getPlaylistInfo(sessionId) {
    try {
      const session = await this.getSessionDetails(sessionId);
      
      // Jellyfin doesn't have a direct queue endpoint for sessions
      // Return current item and basic queue info from session
      return {
        currentItemIndex: 0, // Jellyfin's session API doesn't expose queue position
        currentItem: session.NowPlayingItem ? {
          id: session.NowPlayingItem.Id,
          name: session.NowPlayingItem.Name,
          type: session.NowPlayingItem.Type,
          duration: session.NowPlayingItem.RunTimeTicks
        } : null,
        queueLength: 1, // Jellyfin sessions don't expose queue length in basic API
        supportsQueue: false // Would need Jellyfin Playlist API for full queue management
      };
    } catch (error) {
      throw new Error(`Failed to get playlist info: ${error.message}`);
    }
  }

  /**
   * Skip to next item (sends next command)
   * Note: Requires Jellyfin client to support next command
   * @param {string} sessionId - Session ID
   */
  async skipNext(sessionId) {
    try {
      // Try direct next endpoint first
      try {
        await this.client.post(`/Sessions/${sessionId}/Playing/Next`);
        return { success: true, message: 'Skipped to next item' };
      } catch (e) {
        // Fallback to generic message command if endpoint doesn't exist
        await this.sendSessionMessage(sessionId, 'NextTrack');
        return { success: true, message: 'Next command sent' };
      }
    } catch (error) {
      throw new Error(`Failed to skip to next: ${error.message}`);
    }
  }

  /**
   * Skip to previous item
   * @param {string} sessionId - Session ID
   */
  async skipPrevious(sessionId) {
    try {
      // Try direct previous endpoint first
      try {
        await this.client.post(`/Sessions/${sessionId}/Playing/Previous`);
        return { success: true, message: 'Skipped to previous item' };
      } catch (e) {
        // Fallback to generic message command if endpoint doesn't exist
        await this.sendSessionMessage(sessionId, 'PreviousTrack');
        return { success: true, message: 'Previous command sent' };
      }
    } catch (error) {
      throw new Error(`Failed to skip to previous: ${error.message}`);
    }
  }

  // Add more methods as needed

  /**
   * Return a long-lived singleton instance configured with the admin API key.
   * Uses the same 5-minute in-memory cache across requests, avoiding repeated
   * cold-cache Round-Trips to Jellyfin for admin dashboard operations.
   *
   * Call JellyfinAPI.resetAdminInstance() after changing server settings so the
   * next request picks up the new URL / API key.
   */
  static getAdminInstance() {
    if (!JellyfinAPI._adminInstance) {
      const SetupManager = require('./SetupManager');
      const config = SetupManager.getConfig();
      JellyfinAPI._adminInstance = new JellyfinAPI(config.jellyfinUrl, config.apiKey);
    }
    return JellyfinAPI._adminInstance;
  }

  static resetAdminInstance() {
    JellyfinAPI._adminInstance = null;
  }
}

module.exports = JellyfinAPI;