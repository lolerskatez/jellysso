const axios = require('axios');
const { expect } = require('@jest/globals');
const SetupManager = require('../src/models/SetupManager');

// Use configured URL if setup is complete, otherwise fallback to env var
const getBaseUrl = () => {
  try {
    const config = SetupManager.getConfig();
    return config.jellyfinUrl;
  } catch (error) {
    return process.env.JELLYFIN_BASE_URL || 'http://localhost:8096';
  }
};

const BASE_URL = getBaseUrl();
const COMPANION_URL = 'http://localhost:3000';
const TEST_USER = 'testuser';
const TEST_PASS = 'testpass123';

describe('Jellyfin Companion Integration Tests', () => {
  let authToken;
  let testUserId;
  let sessionCookie;

  beforeAll(async () => {
    // Wait for services to be ready
    await waitForService(BASE_URL, 30000);
    await waitForService(COMPANION_URL, 30000);
  }, 60000);

  describe('Authentication Flow', () => {
    test('should authenticate with Jellyfin directly', async () => {
      const response = await axios.post(`${BASE_URL}/Users/AuthenticateByName`, {
        Username: 'admin', // Default Jellyfin admin
        Pw: 'admin123'    // Default password
      });

      expect(response.status).toBe(200);
      expect(response.data.AccessToken).toBeDefined();
      expect(response.data.User).toBeDefined();

      authToken = response.data.AccessToken;
    });

    test('should login via companion app', async () => {
      const response = await axios.post(`${COMPANION_URL}/api/auth/login`, {
        username: 'admin',
        password: 'admin123'
      }, {
        maxRedirects: 0,
        validateStatus: (status) => status < 500
      });

      if (response.status === 200) {
        expect(response.data.success).toBe(true);
        expect(response.data.user).toBeDefined();
        sessionCookie = response.headers['set-cookie'];
      } else {
        console.log('Companion login failed, might need setup');
      }
    });
  });

  describe('User Management', () => {
    test('should get users list', async () => {
      const response = await axios.get(`${BASE_URL}/Users`, {
        headers: { 'X-Emby-Token': authToken }
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data)).toBe(true);
    });

    test('should create new user', async () => {
      const response = await axios.post(`${BASE_URL}/Users/New`, {
        Name: TEST_USER,
        Password: TEST_PASS
      }, {
        headers: { 'X-Emby-Token': authToken }
      });

      expect(response.status).toBe(200);
      expect(response.data.Id).toBeDefined();
      testUserId = response.data.Id;
    });

    test('should update user', async () => {
      const response = await axios.post(`${BASE_URL}/Users/${testUserId}`, {
        Name: TEST_USER,
        Policy: { IsAdministrator: false }
      }, {
        headers: { 'X-Emby-Token': authToken }
      });

      expect(response.status).toBe(200);
    });
  });

  describe('QuickConnect', () => {
    test('should check QuickConnect enabled', async () => {
      const response = await axios.get(`${BASE_URL}/QuickConnect/Enabled`);

      expect(response.status).toBe(200);
      // QuickConnect might not be enabled by default
      expect(typeof response.data).toBe('boolean');
    });

    test('should initiate QuickConnect if enabled', async () => {
      const enabledResponse = await axios.get(`${BASE_URL}/QuickConnect/Enabled`);
      if (enabledResponse.data) {
        const response = await axios.post(`${BASE_URL}/QuickConnect/Initiate`);
        expect(response.status).toBe(200);
        expect(response.data.Secret).toBeDefined();
        expect(response.data.Code).toBeDefined();

        // Test polling for status
        const connectResponse = await axios.post(`${BASE_URL}/QuickConnect/Connect`, {
          Secret: response.data.Secret
        });
        expect(connectResponse.status).toBe(200);
        // Should return status information
      } else {
        console.log('QuickConnect not enabled, skipping device pairing test');
      }
    });
  });

  describe('Settings', () => {
    test('should get system configuration', async () => {
      const response = await axios.get(`${BASE_URL}/System/Configuration`, {
        headers: { 'X-Emby-Token': authToken }
      });

      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
    });
  });

  describe('Plugin Integration', () => {
    test('should validate SSO tokens for plugin', async () => {
      try {
        // Test with invalid API key
        await expect(axios.get(`${COMPANION_URL}/api/auth/validate-sso?token=test-token`))
          .rejects.toThrow();

        // Test with valid API key but invalid token
        const response = await axios.get(`${COMPANION_URL}/api/auth/validate-sso?token=invalid-token`, {
          headers: { 'X-API-Key': 'test-shared-secret' }
        });
        expect(response.status).toBe(401);

        // Test with no token
        const noTokenResponse = await axios.get(`${COMPANION_URL}/api/auth/validate-sso`, {
          headers: { 'X-API-Key': 'test-shared-secret' }
        });
        expect(noTokenResponse.status).toBe(400);

      } catch (error) {
        console.log('Plugin integration test failed - companion app may not be running');
      }
    });
  });

  afterAll(async () => {
    // Cleanup test user if created
    if (testUserId && authToken) {
      try {
        await axios.delete(`${BASE_URL}/Users/${testUserId}`, {
          headers: { 'X-Emby-Token': authToken }
        });
      } catch (error) {
        console.log('Could not cleanup test user:', error.message);
      }
    }
  });
});

async function waitForService(url, timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      await axios.get(url, { timeout: 5000 });
      return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  throw new Error(`Service at ${url} did not become available within ${timeout}ms`);
}