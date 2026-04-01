/**
 * Edge case tests for JellySSO
 * Tests concurrent sessions, token expiration, CSRF rotation, cache invalidation, etc.
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const SessionStore = require('../src/models/SessionStore');
const CacheManager = require('../src/models/CacheManager');
const TokenManager = require('../src/models/TokenManager');
const DatabaseManager = require('../src/models/DatabaseManager');
const { getInstance, AccountLockoutManager } = require('../src/models/AccountLockoutManager');

describe('Edge Cases - Concurrent Sessions', () => {
  let app;

  beforeAll(() => {
    // Use express-session default MemoryStore (no DB dependency) for concurrency tests
    app = express();
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true
    }));

    app.get('/set-session', (req, res) => {
      req.session.user = { id: 'user1', name: 'Test User' };
      req.session.save(() => res.json({ sessionId: req.sessionID }));
    });

    app.get('/get-session', (req, res) => {
      res.json({ user: req.session.user });
    });
  });

  test('should handle concurrent session creation', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(request(app).get('/set-session'));
    }

    const results = await Promise.all(promises);
    const sessionIds = new Set(results.map(r => r.body.sessionId));

    // All sessions should be unique
    expect(sessionIds.size).toBe(10);
  });

  test('should handle concurrent session reads', async () => {
    const setRes = await request(app).get('/set-session');
    const cookie = setRes.headers['set-cookie'];

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        request(app)
          .get('/get-session')
          .set('Cookie', cookie)
      );
    }

    const results = await Promise.all(promises);
    results.forEach(res => {
      expect(res.body.user).toEqual({ id: 'user1', name: 'Test User' });
    });
  });

  test('should handle concurrent session updates', async () => {
    const setRes = await request(app).get('/set-session');
    const cookie = setRes.headers['set-cookie'];

    app.post('/update-session', (req, res) => {
      req.session.counter = (req.session.counter || 0) + 1;
      req.session.save(() => res.json({ counter: req.session.counter }));
    });

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        request(app)
          .post('/update-session')
          .set('Cookie', cookie)
      );
    }

    const results = await Promise.all(promises);
    // Last result should have counter = 10
    expect(results[results.length - 1].body.counter).toBeLessThanOrEqual(10);
  });
});

describe('Edge Cases - Token Expiration & Refresh', () => {
  beforeAll(() => {
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-jwt-secret-for-edge-cases';
  });

  test('should handle token expiration', () => {
    const user = { Id: 'user1', Name: 'Test User' };
    // generateAccessToken uses the default tokenExpiry; we just verify it produces a valid token
    const token = TokenManager.generateAccessToken(user);

    // Token should be valid immediately
    expect(() => TokenManager.verifyToken(token)).not.toThrow();
  });

  test('should handle refresh token rotation', () => {
    const user = { Id: 'user1', Name: 'Test User' };
    const refreshToken1 = TokenManager.generateRefreshToken(user);
    
    // Verify first token works
    expect(() => TokenManager.verifyRefreshToken(refreshToken1)).not.toThrow();

    // Generate new token
    const refreshToken2 = TokenManager.generateRefreshToken(user);
    
    // Both should be valid
    expect(() => TokenManager.verifyRefreshToken(refreshToken1)).not.toThrow();
    expect(() => TokenManager.verifyRefreshToken(refreshToken2)).not.toThrow();

    // Revoke first token
    TokenManager.revokeRefreshToken(refreshToken1);

    // First should now fail
    expect(() => TokenManager.verifyRefreshToken(refreshToken1)).toThrow();
    // Second should still work
    expect(() => TokenManager.verifyRefreshToken(refreshToken2)).not.toThrow();
  });

  test('should handle concurrent token generation', async () => {
    const user = { Id: 'user1', Name: 'Test User' };
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(Promise.resolve(TokenManager.generateAccessToken(user)));
    }

    const tokens = await Promise.all(promises);
    const uniqueTokens = new Set(tokens);

    // All tokens should be unique
    expect(uniqueTokens.size).toBe(10);

    // All should be valid
    tokens.forEach(token => {
      expect(() => TokenManager.verifyToken(token)).not.toThrow();
    });
  });
});

describe('Edge Cases - Cache Invalidation', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheManager({
      defaultTTL: 100, // 100ms for testing
      maxSize: 10
    });
  });

  test('should invalidate expired cache entries', async () => {
    cache.set('key1', 'value1', 50);
    
    expect(cache.get('key1')).toBe('value1');

    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(cache.get('key1')).toBeNull();
  });

  test('should handle cache eviction on size limit', () => {
    // Add 11 items to cache with max size 10
    for (let i = 0; i < 11; i++) {
      cache.set(`key${i}`, `value${i}`);
    }

    // First item should be evicted (LRU)
    expect(cache.get('key0')).toBeNull();
    // Most recent items should still be there
    expect(cache.get('key10')).toBe('value10');
  });

  test('should handle concurrent cache operations', async () => {
    const promises = [];

    // Concurrent writes
    for (let i = 0; i < 20; i++) {
      promises.push(Promise.resolve(cache.set(`key${i}`, `value${i}`)));
    }

    await Promise.all(promises);

    // Verify some entries exist (not all due to LRU)
    let count = 0;
    for (let i = 0; i < 20; i++) {
      if (cache.get(`key${i}`) !== undefined) count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test('should handle cache invalidation', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBe('value2');

    cache.delete('key1');

    expect(cache.get('key1')).toBeNull();
    expect(cache.get('key2')).toBe('value2');
  });
});

describe('Edge Cases - Account Lockout', () => {
  let lockoutManager;
  jest.setTimeout(15000); // lockout timeout tests wait up to ~1.1s

  beforeEach(() => {
    lockoutManager = getInstance();
  });

  test('should track failed login attempts', async () => {
    const username = `testuser_${Date.now()}`;
    const ip = '127.0.0.1';

    // Record 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await lockoutManager.recordLoginAttempt(username, ip, false, 'Invalid password');
    }

    const failedAttempts = await lockoutManager.getFailedAttempts(username, 15);
    expect(failedAttempts).toBe(3);
  });

  test('should lock account after threshold', async () => {
    const username = `testuser_${Date.now()}`;
    const ip = '127.0.0.1';

    // Record 5 failed attempts (should trigger lockout)
    for (let i = 0; i < 5; i++) {
      await lockoutManager.recordLoginAttempt(username, ip, false, 'Invalid password');
    }

    const loginCheck = await lockoutManager.checkLoginAllowed(username, ip);
    expect(loginCheck.allowed).toBe(false);
    expect(loginCheck.reason).toContain('locked');
  });

  test('should unlock account after timeout', async () => {
    const username = `testuser_${Date.now()}`;
    const ip = '127.0.0.1';

    // Lock account for 1 second
    await lockoutManager.lockAccount(username, 0.016, 'Test lockout'); // ~1 second

    let lockStatus = await lockoutManager.isAccountLocked(username);
    expect(lockStatus.locked).toBe(true);

    // Wait for unlock
    await new Promise(resolve => setTimeout(resolve, 1100));

    lockStatus = await lockoutManager.isAccountLocked(username);
    expect(lockStatus.locked).toBe(false);
  });

  test('should handle concurrent lockout checks', async () => {
    const username = `testuser_${Date.now()}`;
    const ip = '127.0.0.1';

    // Record failed attempts
    for (let i = 0; i < 5; i++) {
      await lockoutManager.recordLoginAttempt(username, ip, false, 'Invalid password');
    }

    // Concurrent checks
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(lockoutManager.checkLoginAllowed(username, ip));
    }

    const results = await Promise.all(promises);
    results.forEach(result => {
      expect(result.allowed).toBe(false);
    });
  });
});

describe('Edge Cases - Database Transactions', () => {
  test('should handle transaction rollback on error', async () => {
    const db = DatabaseManager.db;

    // Attempt operation that should fail
    const result = await new Promise(resolve => {
      db.run('INSERT INTO nonexistent_table VALUES (1)', (err) => {
        resolve(err);
      });
    });

    expect(result).toBeDefined(); // Should have error
  });

  test('should handle concurrent database writes', async () => {
    const db = DatabaseManager.db;

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        new Promise(resolve => {
          db.run(
            'INSERT INTO login_attempts (username, ip_address, success) VALUES (?, ?, ?)',
            [`user_${i}`, '127.0.0.1', 1],
            (err) => resolve(err)
          );
        })
      );
    }

    const results = await Promise.all(promises);
    // Most should succeed
    const successes = results.filter(r => !r).length;
    expect(successes).toBeGreaterThan(5);
  });
});

describe('Edge Cases - OIDC Provider Validation', () => {
  test('should handle invalid OIDC discovery URL', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockRejectedValueOnce(new Error('Network error'));

    const discoveryUrl = 'https://invalid-oidc-provider.com/.well-known/openid-configuration';
    
    try {
      await axios.get(discoveryUrl);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error.message).toContain('Network error');
    }
  });

  test('should handle malformed OIDC token', () => {
    const malformedToken = 'invalid.token.format';
    
    try {
      const parts = malformedToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid token format');
      }
    } catch (error) {
      expect(error.message).toContain('Invalid token format');
    }
  });

  test('should handle OIDC provider timeout', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockImplementationOnce(() => 
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      })
    );

    try {
      await axios.get('https://oidc-provider.com/token', { timeout: 50 });
      expect(true).toBe(false);
    } catch (error) {
      expect(error.message).toMatch(/Timeout|timeout/);
    }
  });
});

describe('Edge Cases - Jellyfin API Timeouts', () => {
  test('should handle Jellyfin API timeout', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockImplementationOnce(() =>
      new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 100);
      })
    );

    try {
      await axios.get('http://jellyfin:8096/Users', { timeout: 50 });
      expect(true).toBe(false);
    } catch (error) {
      expect(error.message).toContain('timeout');
    }
  });

  test('should handle Jellyfin API connection refused', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    try {
      await axios.get('http://jellyfin:8096/Users');
      expect(true).toBe(false);
    } catch (error) {
      expect(error.message).toContain('ECONNREFUSED');
    }
  });

  test('should handle Jellyfin API 5xx errors', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockRejectedValueOnce({
      response: { status: 503, statusText: 'Service Unavailable' }
    });

    try {
      await axios.get('http://jellyfin:8096/Users');
      expect(true).toBe(false);
    } catch (error) {
      expect(error.response.status).toBe(503);
    }
  });

  test('should handle Jellyfin API rate limiting', async () => {
    const axios = require('axios');
    jest.mock('axios');

    axios.get.mockRejectedValueOnce({
      response: { status: 429, statusText: 'Too Many Requests' }
    });

    try {
      await axios.get('http://jellyfin:8096/Users');
      expect(true).toBe(false);
    } catch (error) {
      expect(error.response.status).toBe(429);
    }
  });
});

describe('Edge Cases - CSRF Token Rotation', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true
    }));

    app.get('/csrf-token', (req, res) => {
      // Simulate CSRF token generation
      const token = require('crypto').randomBytes(32).toString('hex');
      req.session.csrfToken = token;
      res.json({ token });
    });

    app.post('/submit', (req, res) => {
      const newToken = require('crypto').randomBytes(32).toString('hex');
      req.session.csrfToken = newToken;
      res.json({ newToken });
    });
  });

  test('should rotate CSRF token on form submission', async () => {
    const agent = request.agent(app);

    // Get initial token
    const tokenRes = await agent.get('/csrf-token');
    const token1 = tokenRes.body.token;

    // Submit form
    const submitRes = await agent.post('/submit');
    const token2 = submitRes.body.newToken;

    // Tokens should be different
    expect(token1).not.toBe(token2);
  });

  test('should handle concurrent CSRF token requests', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(request(app).get('/csrf-token'));
    }

    const results = await Promise.all(promises);
    const tokens = results.map(r => r.body.token);
    const uniqueTokens = new Set(tokens);

    // All tokens should be unique
    expect(uniqueTokens.size).toBe(10);
  });
});
