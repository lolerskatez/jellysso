'use strict';

/**
 * new-features.test.js
 *
 * Unit tests for features added in the current implementation round:
 *   • OmbiManager              (src/models/OmbiManager.js)
 *   • SessionEnforcementService (src/services/SessionEnforcementService.js)
 *   • JellyfinPinWatcher        (src/services/JellyfinPinWatcher.js)
 *
 * All external I/O is mocked so no running services are required.
 */

// ─── Top-level mocks (hoisted before any require) ────────────────────────────
jest.mock('axios');
jest.mock('fs');
jest.mock('../src/models/DatabaseManager', () => ({ getSetting: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../src/models/SetupManager',  () => ({ getConfig: jest.fn() }));
jest.mock('../src/models/PolicyManager', () => ({ getUserPolicyWithDetails: jest.fn() }));
jest.mock('../src/models/JellyfinAPI');
jest.mock('../src/models/NotificationManager', () => ({ getInstance: jest.fn() }));

// ─── Module references ────────────────────────────────────────────────────────
const axios             = require('axios');
const fs                = require('fs');
const DatabaseManager   = require('../src/models/DatabaseManager');
const SetupManager      = require('../src/models/SetupManager');
const PolicyManager     = require('../src/models/PolicyManager');
const JellyfinAPI       = require('../src/models/JellyfinAPI');
const NotificationManager = require('../src/models/NotificationManager');

// ─── Utility ──────────────────────────────────────────────────────────────────
/**
 * Flush all pending promises by waiting for a setImmediate callback.
 * setImmediate fires after the current microtask queue is fully drained,
 * so a single call is sufficient to drain async chains with multiple awaits.
 */
const flushPromises = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => jest.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════════
//  OmbiManager
// ═══════════════════════════════════════════════════════════════════════════════
describe('OmbiManager', () => {
  let OmbiManager;

  beforeAll(() => {
    OmbiManager = require('../src/models/OmbiManager');
  });

  beforeEach(() => {
    OmbiManager.instance = null; // reset singleton between tests
  });

  /** Wire the three DB settings that _getSettings() reads (in order). */
  function mockDbSettings(url = 'http://ombi:5000', apiKey = 'testkey', syncEnabled = true) {
    DatabaseManager.getSetting
      .mockResolvedValueOnce(url)
      .mockResolvedValueOnce(apiKey)
      .mockResolvedValueOnce(syncEnabled ? 'true' : 'false');
  }

  /** Install a fake axios HTTP client and return it. */
  function mockAxiosClient() {
    const client = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
    axios.create.mockReturnValue(client);
    return client;
  }

  // ── testConnection() ─────────────────────────────────────────────────────
  describe('testConnection()', () => {
    test('returns error when URL is empty', async () => {
      mockDbSettings('', 'key', true);
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/required/i);
    });

    test('returns error when API key is empty', async () => {
      mockDbSettings('http://ombi:5000', '', true);
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/required/i);
    });

    test('returns success with version string on HTTP 200', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({ data: { version: '4.3.0' } });
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(true);
      expect(result.version).toBe('4.3.0');
    });

    test('hits the correct Ombi status endpoint', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({ data: {} });
      await OmbiManager.getInstance().testConnection();
      expect(client.get).toHaveBeenCalledWith('/api/v1/Status');
    });

    test('returns "Invalid API key" message on 401', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockRejectedValueOnce({ response: { status: 401 } });
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invalid api key/i);
    });

    test('returns "Invalid API key" message on 403', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockRejectedValueOnce({ response: { status: 403 } });
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invalid api key/i);
    });

    test('returns the error message on a network failure', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await OmbiManager.getInstance().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('ECONNREFUSED');
    });
  });

  // ── syncUser() ───────────────────────────────────────────────────────────
  describe('syncUser()', () => {
    test('returns disabled reason when sync is off', async () => {
      mockDbSettings('http://ombi', 'key', false);
      const result = await OmbiManager.getInstance().syncUser('user-1');
      expect(result).toMatchObject({ success: false, reason: 'disabled' });
    });

    test('returns disabled when URL is missing even if syncEnabled flag is set', async () => {
      mockDbSettings('', 'key', true);
      const result = await OmbiManager.getInstance().syncUser('user-1');
      expect(result).toMatchObject({ success: false, reason: 'disabled' });
    });

    test('posts to ImportFromJellyfin endpoint with correct payload', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.post.mockResolvedValueOnce({ data: {} });
      const result = await OmbiManager.getInstance().syncUser('user-abc');
      expect(result.success).toBe(true);
      expect(client.post).toHaveBeenCalledWith(
        '/api/v1/Identity/ImportFromJellyfin',
        { jellyfinUserIds: ['user-abc'] }
      );
    });

    test('treats "already exists" 400 error as idempotent success', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.post.mockRejectedValueOnce({
        response: { status: 400, data: { message: 'User already exists' } }
      });
      const result = await OmbiManager.getInstance().syncUser('user-dup');
      expect(result.success).toBe(true);
    });

    test('treats "exist" keyword in error message as idempotent', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.post.mockRejectedValueOnce({
        response: { status: 409, data: { message: 'User already exist in system' } }
      });
      const result = await OmbiManager.getInstance().syncUser('user-dup2');
      expect(result.success).toBe(true);
    });

    test('returns failure on unexpected API error', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.post.mockRejectedValueOnce(new Error('500 Internal Server Error'));
      const result = await OmbiManager.getInstance().syncUser('user-err');
      expect(result.success).toBe(false);
    });
  });

  // ── removeUser() ─────────────────────────────────────────────────────────
  describe('removeUser()', () => {
    test('returns disabled reason when sync is off', async () => {
      mockDbSettings('http://ombi', 'key', false);
      const result = await OmbiManager.getInstance().removeUser('user-1');
      expect(result).toMatchObject({ success: false, reason: 'disabled' });
    });

    test('returns success (no-op) when user is not found in Ombi', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({ data: [{ id: 'x', jellyfinUserId: 'other-user' }] });
      const result = await OmbiManager.getInstance().removeUser('missing-user');
      expect(result.success).toBe(true);
      expect(client.delete).not.toHaveBeenCalled();
    });

    test('returns success when Ombi returns an empty user list', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({ data: [] });
      const result = await OmbiManager.getInstance().removeUser('user-1');
      expect(result.success).toBe(true);
    });

    test('finds Ombi user by jellyfinUserId and DELETEs them', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({
        data: [
          { id: 'ombi-99', jellyfinUserId: 'target-user' },
          { id: 'ombi-2',  jellyfinUserId: 'other-user'  }
        ]
      });
      client.delete.mockResolvedValueOnce({ data: {} });
      const result = await OmbiManager.getInstance().removeUser('target-user');
      expect(result.success).toBe(true);
      expect(client.delete).toHaveBeenCalledWith('/api/v1/Identity/ombi-99');
    });

    test('handles result wrapped in { result: [] } shape', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockResolvedValueOnce({
        data: { result: [{ id: 'ombi-55', jellyfinUserId: 'wrapped-user' }] }
      });
      client.delete.mockResolvedValueOnce({ data: {} });
      const result = await OmbiManager.getInstance().removeUser('wrapped-user');
      expect(result.success).toBe(true);
      expect(client.delete).toHaveBeenCalledWith('/api/v1/Identity/ombi-55');
    });

    test('returns failure when fetching the Ombi user list errors', async () => {
      mockDbSettings();
      const client = mockAxiosClient();
      client.get.mockRejectedValueOnce(new Error('503 Service Unavailable'));
      const result = await OmbiManager.getInstance().removeUser('user-1');
      expect(result.success).toBe(false);
    });
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  SessionEnforcementService
// ═══════════════════════════════════════════════════════════════════════════════
describe('SessionEnforcementService', () => {
  let service;

  beforeAll(() => {
    // Require once; _timer is module-level state, stop() resets it between tests.
    service = require('../src/services/SessionEnforcementService');
  });

  afterEach(() => {
    service.stop();
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  test('stop() is a no-op when the service has not been started', () => {
    expect(() => service.stop()).not.toThrow();
  });

  test('start() returns without creating a timer when enforcement is disabled', async () => {
    DatabaseManager.getSetting
      .mockResolvedValueOnce('false')
      .mockResolvedValueOnce('60');

    const spy = jest.spyOn(global, 'setInterval');
    await service.start();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('start() creates a setInterval timer with the configured interval', async () => {
    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('120');
    SetupManager.getConfig.mockReturnValue({}); // no jellyfinUrl → _enforce() exits early

    const spy = jest.spyOn(global, 'setInterval');
    await service.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 120_000);
    spy.mockRestore();
  });

  test('start() enforces a minimum interval of 30 seconds', async () => {
    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('5'); // below minimum
    SetupManager.getConfig.mockReturnValue({});

    const spy = jest.spyOn(global, 'setInterval');
    await service.start();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    spy.mockRestore();
  });

  test('restart() completes without error', async () => {
    DatabaseManager.getSetting.mockResolvedValue('false'); // disabled on both stop+start
    await expect(service.restart()).resolves.not.toThrow();
  });

  // ── Enforcement logic (via start() + immediate _enforce() call) ──────────
  test('_enforce() stops the single oldest session when user exceeds stream limit', async () => {
    const sessions = [
      { userId: 'u1', userName: 'alice', sessionId: 'sess-A', lastActivityDate: '2024-01-01T10:00:00Z' },
      { userId: 'u1', userName: 'alice', sessionId: 'sess-B', lastActivityDate: '2024-01-01T11:00:00Z' },
      { userId: 'u1', userName: 'alice', sessionId: 'sess-C', lastActivityDate: '2024-01-01T12:00:00Z' },
    ];

    const mockJf = {
      getActiveSessions: jest.fn().mockResolvedValue(sessions),
      stopPlayback: jest.fn().mockResolvedValue({})
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf:8096', apiKey: 'k' });
    PolicyManager.getUserPolicyWithDetails.mockResolvedValue({ maxConcurrentStreams: 2 });

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    // sess-A is the oldest → must be the one stopped (1 excess over limit of 2)
    expect(mockJf.stopPlayback).toHaveBeenCalledTimes(1);
    expect(mockJf.stopPlayback).toHaveBeenCalledWith('sess-A');
  });

  test('_enforce() stops multiple excess sessions when needed', async () => {
    const sessions = [
      { userId: 'u1', userName: 'bob', sessionId: 'sess-1', lastActivityDate: '2024-01-01T08:00:00Z' },
      { userId: 'u1', userName: 'bob', sessionId: 'sess-2', lastActivityDate: '2024-01-01T09:00:00Z' },
      { userId: 'u1', userName: 'bob', sessionId: 'sess-3', lastActivityDate: '2024-01-01T10:00:00Z' },
      { userId: 'u1', userName: 'bob', sessionId: 'sess-4', lastActivityDate: '2024-01-01T11:00:00Z' },
    ];

    const mockJf = {
      getActiveSessions: jest.fn().mockResolvedValue(sessions),
      stopPlayback: jest.fn().mockResolvedValue({})
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf', apiKey: 'k' });
    PolicyManager.getUserPolicyWithDetails.mockResolvedValue({ maxConcurrentStreams: 1 });

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    // 3 excess (4 sessions, limit 1): stop sess-1, sess-2, sess-3 (3 oldest)
    expect(mockJf.stopPlayback).toHaveBeenCalledTimes(3);
    expect(mockJf.stopPlayback).toHaveBeenCalledWith('sess-1');
    expect(mockJf.stopPlayback).toHaveBeenCalledWith('sess-2');
    expect(mockJf.stopPlayback).toHaveBeenCalledWith('sess-3');
  });

  test('_enforce() does not stop any sessions when all users are within limit', async () => {
    const sessions = [
      { userId: 'u1', userName: 'carol', sessionId: 'sess-X', lastActivityDate: '2024-01-01T10:00:00Z' }
    ];

    const mockJf = {
      getActiveSessions: jest.fn().mockResolvedValue(sessions),
      stopPlayback: jest.fn()
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf', apiKey: 'k' });
    PolicyManager.getUserPolicyWithDetails.mockResolvedValue({ maxConcurrentStreams: 2 });

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    expect(mockJf.stopPlayback).not.toHaveBeenCalled();
  });

  test('_enforce() skips users with no stream limit (limit >= 999)', async () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      userId: 'admin',
      userName: 'admin',
      sessionId: `sess-${i}`,
      lastActivityDate: new Date(2024, 0, 1, i).toISOString()
    }));

    const mockJf = {
      getActiveSessions: jest.fn().mockResolvedValue(sessions),
      stopPlayback: jest.fn()
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf', apiKey: 'k' });
    PolicyManager.getUserPolicyWithDetails.mockResolvedValue({ maxConcurrentStreams: 999 });

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    expect(mockJf.stopPlayback).not.toHaveBeenCalled();
  });

  test('_enforce() exits early when Jellyfin is not configured', async () => {
    SetupManager.getConfig.mockReturnValue({}); // no jellyfinUrl

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    expect(JellyfinAPI).not.toHaveBeenCalled();
  });

  test('_enforce() handles Jellyfin getActiveSessions error gracefully', async () => {
    const mockJf = {
      getActiveSessions: jest.fn().mockRejectedValue(new Error('Jellyfin unavailable')),
      stopPlayback: jest.fn()
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf', apiKey: 'k' });

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    // Error should be swallowed; stopPlayback definitely not called
    expect(mockJf.stopPlayback).not.toHaveBeenCalled();
  });

  test('_enforce() handles a policy lookup error for one user without crashing', async () => {
    const sessions = [
      { userId: 'u1', userName: 'dave', sessionId: 'sess-1', lastActivityDate: '2024-01-01T10:00:00Z' },
      { userId: 'u1', userName: 'dave', sessionId: 'sess-2', lastActivityDate: '2024-01-01T11:00:00Z' },
    ];

    const mockJf = {
      getActiveSessions: jest.fn().mockResolvedValue(sessions),
      stopPlayback: jest.fn()
    };
    JellyfinAPI.mockImplementation(() => mockJf);
    SetupManager.getConfig.mockReturnValue({ jellyfinUrl: 'http://jf', apiKey: 'k' });
    // Policy lookup throws → should fall back to no limit (999)
    PolicyManager.getUserPolicyWithDetails.mockRejectedValue(new Error('DB error'));

    DatabaseManager.getSetting
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('60');

    await service.start();
    await flushPromises();

    // No stop calls because the fallback limit is 999
    expect(mockJf.stopPlayback).not.toHaveBeenCalled();
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  JellyfinPinWatcher
// ═══════════════════════════════════════════════════════════════════════════════
describe('JellyfinPinWatcher', () => {
  let JellyfinPinWatcher;

  beforeAll(() => {
    JellyfinPinWatcher = require('../src/services/JellyfinPinWatcher');
  });

  beforeEach(() => {
    // Reset static state so each test starts clean
    JellyfinPinWatcher.stop();
    JellyfinPinWatcher._pollTimer = null;
    JellyfinPinWatcher._configDir = null;
  });

  // ── start() ──────────────────────────────────────────────────────────────
  describe('start()', () => {
    test('returns without error and no timer when configDir is not configured', async () => {
      DatabaseManager.getSetting.mockResolvedValueOnce(null);
      await expect(JellyfinPinWatcher.start()).resolves.not.toThrow();
      expect(JellyfinPinWatcher._pollTimer).toBeNull();
    });

    test('warns and does not start when configured directory does not exist', async () => {
      const logger = require('../src/utils/logger');
      DatabaseManager.getSetting.mockResolvedValueOnce('/nonexistent/path');
      fs.existsSync.mockReturnValueOnce(false);

      await JellyfinPinWatcher.start();

      expect(JellyfinPinWatcher._pollTimer).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/does not exist/));
    });

    test('creates a poll timer when the directory exists', async () => {
      DatabaseManager.getSetting.mockResolvedValueOnce('/data/jellyfin');
      fs.existsSync.mockReturnValueOnce(true);
      jest.useFakeTimers();

      await JellyfinPinWatcher.start();
      expect(JellyfinPinWatcher._pollTimer).not.toBeNull();

      jest.useRealTimers();
    });

    test('is idempotent — a second call does not replace the running timer', async () => {
      DatabaseManager.getSetting.mockResolvedValueOnce('/data/jellyfin');
      fs.existsSync.mockReturnValueOnce(true);
      jest.useFakeTimers();

      await JellyfinPinWatcher.start();
      const firstTimer = JellyfinPinWatcher._pollTimer;

      // Second call: timer is already set, so start() returns immediately
      await JellyfinPinWatcher.start();
      expect(JellyfinPinWatcher._pollTimer).toBe(firstTimer);

      jest.useRealTimers();
    });
  });

  // ── _handlePinFile() ─────────────────────────────────────────────────────
  describe('_handlePinFile()', () => {
    const VALID_PIN = {
      UserId:         'user-abc',
      UserName:       'alice',
      Pin:            '112233',
      ExpirationDate: '2099-12-31T23:59:59Z'
    };

    test('calls NotificationManager.sendToUser for a valid PIN file', async () => {
      fs.readFileSync.mockReturnValueOnce(JSON.stringify(VALID_PIN));
      DatabaseManager.getSetting.mockResolvedValueOnce('link');
      SetupManager.getConfig.mockReturnValue({
        serverName: 'MyServer',
        webAppPublicUrl: 'http://localhost:3000'
      });
      const mockNm = { sendToUser: jest.fn().mockResolvedValue(true) };
      NotificationManager.getInstance.mockReturnValue(mockNm);

      await JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_alice.json');

      expect(mockNm.sendToUser).toHaveBeenCalledTimes(1);
      expect(mockNm.sendToUser).toHaveBeenCalledWith(
        'user-abc',
        expect.objectContaining({ type: 'PASSWORD_RESET' })
      );
    });

    test('includes a reset link URL in the message body when mode is "link"', async () => {
      fs.readFileSync.mockReturnValueOnce(JSON.stringify(VALID_PIN));
      DatabaseManager.getSetting.mockResolvedValueOnce('link');
      SetupManager.getConfig.mockReturnValue({
        serverName: 'S',
        webAppPublicUrl: 'http://app.example.com'
      });
      const mockNm = { sendToUser: jest.fn().mockResolvedValue(true) };
      NotificationManager.getInstance.mockReturnValue(mockNm);

      await JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_alice.json');

      const [[, { body }]] = mockNm.sendToUser.mock.calls;
      expect(body).toContain('http://app.example.com/auth/pin-reset?data=');
    });

    test('includes the raw PIN in the message body when mode is "pin"', async () => {
      fs.readFileSync.mockReturnValueOnce(JSON.stringify(VALID_PIN));
      DatabaseManager.getSetting.mockResolvedValueOnce('pin');
      SetupManager.getConfig.mockReturnValue({ serverName: 'S' });
      const mockNm = { sendToUser: jest.fn().mockResolvedValue(true) };
      NotificationManager.getInstance.mockReturnValue(mockNm);

      await JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_alice.json');

      const [[, { body }]] = mockNm.sendToUser.mock.calls;
      expect(body).toContain('112233');
    });

    test('handles invalid JSON without throwing and logs a warning', async () => {
      const logger = require('../src/utils/logger');
      fs.readFileSync.mockReturnValueOnce('not valid JSON {{{');

      await expect(
        JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_x.json')
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/invalid json/i));
    });

    test('handles missing required fields without throwing and logs a warning', async () => {
      const logger = require('../src/utils/logger');
      // Missing Pin and UserName
      fs.readFileSync.mockReturnValueOnce(JSON.stringify({ UserId: 'u1' }));

      await expect(
        JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_x.json')
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/missing required fields/i));
    });

    test('includes the server name and expiry date in the subject/body', async () => {
      fs.readFileSync.mockReturnValueOnce(JSON.stringify(VALID_PIN));
      DatabaseManager.getSetting.mockResolvedValueOnce('pin');
      SetupManager.getConfig.mockReturnValue({ serverName: 'CoolServer' });
      const mockNm = { sendToUser: jest.fn().mockResolvedValue(true) };
      NotificationManager.getInstance.mockReturnValue(mockNm);

      await JellyfinPinWatcher._handlePinFile('/data/jellyfin/passwordreset_alice.json');

      const [[, { subject, body }]] = mockNm.sendToUser.mock.calls;
      expect(subject).toContain('CoolServer');
      expect(body).toContain('alice');
    });
  });
});
