const DatabaseManager = require('../src/models/DatabaseManager');
const AuditLogger = require('../src/models/AuditLogger');

/**
 * DatabaseManager Tests
 * Tests all database operations
 */
describe('DatabaseManager', () => {
  beforeAll(async () => {
    // Give database time to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await DatabaseManager.close();
  });

  describe('Settings Operations', () => {
    test('should set and get a string setting', async () => {
      await DatabaseManager.setSetting('test-string', 'test-value');
      const value = await DatabaseManager.getSetting('test-string');
      expect(value).toBe('test-value');
    });

    test('should set and get a JSON setting', async () => {
      const jsonData = { theme: 'dark', lang: 'en' };
      await DatabaseManager.setSetting('test-json', jsonData, 'json');
      const value = await DatabaseManager.getSetting('test-json');
      expect(value).toEqual(jsonData);
    });

    test('should get all settings', async () => {
      await DatabaseManager.setSetting('key1', 'value1');
      await DatabaseManager.setSetting('key2', 'value2');
      const settings = await DatabaseManager.getAllSettings();
      expect(settings).toHaveProperty('key1');
      expect(settings).toHaveProperty('key2');
    });

    test('should return null for non-existent setting', async () => {
      const value = await DatabaseManager.getSetting('non-existent-key-12345');
      expect(value).toBeNull();
    });

    test('should update existing setting', async () => {
      await DatabaseManager.setSetting('update-test', 'initial');
      await DatabaseManager.setSetting('update-test', 'updated');
      const value = await DatabaseManager.getSetting('update-test');
      expect(value).toBe('updated');
    });
  });

  describe('Audit Log Operations', () => {
    test('should insert an audit log entry', async () => {
      const result = await DatabaseManager.insertAuditLog(
        'TEST_ACTION',
        'test-user',
        'test:resource',
        'success',
        '127.0.0.1',
        { message: 'test entry' }
      );
      expect(result).toBe(true);
    });

    test('should retrieve audit logs', async () => {
      await DatabaseManager.insertAuditLog('RETRIEVE_TEST', 'user1', 'res:1', 'success', '127.0.0.1', {});
      const logs = await DatabaseManager.getAuditLogs({ limit: 100 });
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
    });

    test('should filter logs by action', async () => {
      await DatabaseManager.insertAuditLog('FILTER_ACTION_1', 'user1', 'res:1', 'success', '127.0.0.1', {});
      await DatabaseManager.insertAuditLog('FILTER_ACTION_2', 'user1', 'res:1', 'success', '127.0.0.1', {});
      const logs = await DatabaseManager.getAuditLogs({ action: 'FILTER_ACTION_1', limit: 100 });
      const hasOnlyFilterAction1 = logs.every(log => log.action === 'FILTER_ACTION_1');
      expect(hasOnlyFilterAction1).toBe(true);
    });

    test('should filter logs by userId', async () => {
      await DatabaseManager.insertAuditLog('FILTER_USER', 'filter-user-123', 'res:1', 'success', '127.0.0.1', {});
      const logs = await DatabaseManager.getAuditLogs({ userId: 'filter-user-123', limit: 100 });
      const hasOnlyFilterUser = logs.every(log => log.userId === 'filter-user-123');
      expect(hasOnlyFilterUser).toBe(true);
    });

    test('should filter logs by status', async () => {
      await DatabaseManager.insertAuditLog('FILTER_STATUS', 'user1', 'res:1', 'failure', '127.0.0.1', {});
      const logs = await DatabaseManager.getAuditLogs({ status: 'failure', limit: 100 });
      const hasOnlyFailure = logs.every(log => log.status === 'failure');
      expect(hasOnlyFailure).toBe(true);
    });

    test('should limit results', async () => {
      const logs = await DatabaseManager.getAuditLogs({ limit: 5 });
      expect(logs.length).toBeLessThanOrEqual(5);
    });

    test('should return empty array for non-matching filters', async () => {
      const logs = await DatabaseManager.getAuditLogs({ 
        action: 'NEVER_CREATED_ACTION_999',
        limit: 100 
      });
      expect(logs).toEqual([]);
    });

    test('should cleanup old logs', async () => {
      // Insert a test log
      await DatabaseManager.insertAuditLog('CLEANUP_TEST', 'user1', 'res:1', 'success', '127.0.0.1', {});
      
      // Cleanup with 0 days (deletes all)
      const deleted = await DatabaseManager.cleanupAuditLogs(0);
      
      expect(typeof deleted).toBe('number');
      expect(deleted).toBeGreaterThanOrEqual(0);
    });

    test('should get audit statistics', async () => {
      await DatabaseManager.insertAuditLog('STATS_TEST_1', 'user1', 'res:1', 'success', '127.0.0.1', {});
      await DatabaseManager.insertAuditLog('STATS_TEST_2', 'user2', 'res:2', 'failure', '127.0.0.1', {});
      
      const stats = await DatabaseManager.getAuditStats();
      
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('last24h');
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Database Connection', () => {
    test('should have a valid database connection', () => {
      expect(DatabaseManager.db).toBeDefined();
      expect(DatabaseManager.db).not.toBeNull();
    });

    test('should be able to close connection', async () => {
      const result = await DatabaseManager.close();
      expect(result).toBeUndefined(); // close() resolves with undefined
    });
  });
});
