const AuditLogger = require('../src/models/AuditLogger');
const DatabaseManager = require('../src/models/DatabaseManager');

/**
 * AuditLogger Tests
 * Tests all audit logging methods
 */
describe('AuditLogger', () => {
  beforeAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await DatabaseManager.close();
  });

  describe('Generic Logging', () => {
    test('should log a generic event', async () => {
      const result = await AuditLogger.log('TEST_LOG', 'test-user', 'test:resource', {}, 'success', '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should log with details', async () => {
      const result = await AuditLogger.log(
        'TEST_WITH_DETAILS',
        'user1',
        'resource:1',
        { action: 'created', timestamp: Date.now() },
        'success',
        '192.168.1.1'
      );
      expect(result).toBe(true);
    });
  });

  describe('User Operation Logging', () => {
    test('should log user creation', async () => {
      const result = await AuditLogger.logUserCreate('admin-user', 'newuser', 'newuser@test.com', '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should log user update', async () => {
      const result = await AuditLogger.logUserUpdate('admin-user', 'user-123', { Name: 'Updated Name' }, '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should log user deletion', async () => {
      const result = await AuditLogger.logUserDelete('admin-user', 'user-to-delete', 'deleteduser', '127.0.0.1');
      expect(result).toBe(true);
    });
  });

  describe('Settings Logging', () => {
    test('should log settings update', async () => {
      const result = await AuditLogger.logSettingsUpdate(
        'admin-user',
        'companion',
        { theme: 'dark' },
        '127.0.0.1'
      );
      expect(result).toBe(true);
    });

    test('should log system config update', async () => {
      const result = await AuditLogger.logSystemConfigUpdate(
        'admin-user',
        { ServerName: 'MyJellyfin' },
        '127.0.0.1'
      );
      expect(result).toBe(true);
    });
  });

  describe('Authentication Logging', () => {
    test('should log successful login', async () => {
      const result = await AuditLogger.logSuccessfulLogin('user-123', '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should log failed login with reason', async () => {
      const result = await AuditLogger.logFailedLogin('username', 'Invalid credentials', '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should log QuickConnect auth', async () => {
      const result = await AuditLogger.logQuickConnectAuth('user-456', '192.168.1.50');
      expect(result).toBe(true);
    });
  });

  describe('Other Operations', () => {
    test('should log API key regeneration', async () => {
      const result = await AuditLogger.logApiKeyRegenerate('admin-user', '127.0.0.1');
      expect(result).toBe(true);
    });

    test('should retrieve logs', async () => {
      await AuditLogger.log('RETRIEVE_TEST', 'user1', 'res:1', {}, 'success', '127.0.0.1');
      const logs = await AuditLogger.getLogs({ action: 'RETRIEVE_TEST', limit: 10 });
      expect(Array.isArray(logs)).toBe(true);
    });

    test('should cleanup old logs', async () => {
      const result = await AuditLogger.cleanup(90);
      expect(typeof result).toBe('number');
    });
  });

  describe('Data Validation', () => {
    test('should handle missing userId by using system', async () => {
      const result = await AuditLogger.log('TEST_NO_USER', null, 'res:1', {}, 'success', '127.0.0.1');
      expect(result).toBe(true);
      
      const logs = await AuditLogger.getLogs({ action: 'TEST_NO_USER', limit: 1 });
      expect(logs[0].userId).toBe('system');
    });

    test('should handle null IP address', async () => {
      const result = await AuditLogger.log('TEST_NO_IP', 'user1', 'res:1', {}, 'success', null);
      expect(result).toBe(true);
    });

    test('should store details as JSON', async () => {
      const details = { nested: { data: 'value' } };
      await AuditLogger.log('TEST_JSON_DETAILS', 'user1', 'res:1', details, 'success', '127.0.0.1');
      
      const logs = await AuditLogger.getLogs({ action: 'TEST_JSON_DETAILS', limit: 1 });
      expect(logs[0].details).toEqual(details);
    });
  });
});
