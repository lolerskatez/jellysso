const axios = require('axios');

class JellyfinAPI {
  constructor(baseURL, apiKey = null) {
    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.cache = new Map(); // Simple in-memory cache
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    
    // Log API key info for debugging
    if (apiKey) {
      console.log(`🔑 JellyfinAPI initialized with API key (first 16 chars: ${apiKey.substring(0, 16)}...)`);
    } else {
      console.log('⚠️  JellyfinAPI initialized WITHOUT API key');
    }
    
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
    try {
      console.log(`Attempting authentication to ${this.baseURL}/Users/AuthenticateByName for user: ${username}`);
      
      // Temporarily modify headers for authentication
      const originalHeaders = { ...this.client.defaults.headers };
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
      
      console.log('Authentication successful');
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
      
      console.error('Authentication error details:', {
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
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error('Unable to connect to Jellyfin server. Please check the server URL and network connection.');
      }
      if (error.response?.status === 401) {
        console.error('❌ Authentication failed with status 401. The API key may be invalid or expired.');
        console.error(`   API Key (first 16 chars): ${this.apiKey?.substring(0, 16)}...`);
        console.error(`   Response: ${error.response?.data || 'No response body'}`);
        throw new Error('Authentication failed: Invalid or expired API key');
      }
      if (error.response?.status === 503) {
        throw new Error('Jellyfin server is temporarily unavailable. Please try again later.');
      }
      throw new Error(`Failed to get users: ${error.message}`);
    }
  }

  async getUser(userId) {
    try {
      const response = await this.client.get(`/Users/${userId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get user: ${error.message}`);
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
        console.log(`🔒 Generated secure random password for user: ${payload.Name} (prevents direct Jellyfin login)`);
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

      console.log(`Updating user ${userId} policy:`, mergedPolicy);
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

      console.log(`Updating user ${userId} configuration:`, mergedConfig);
      const response = await this.client.post(`/Users/${userId}/Configuration`, mergedConfig);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update user configuration: ${error.message}`);
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
        console.error('❌ Authentication failed with status 401 on System/Configuration');
        console.error(`   API Key (first 16 chars): ${this.apiKey?.substring(0, 16)}...`);
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

  // Add more methods as needed
}

module.exports = JellyfinAPI;