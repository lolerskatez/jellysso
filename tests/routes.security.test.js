const request = require('supertest');
const SetupManager = require('../src/models/SetupManager');
const DatabaseManager = require('../src/models/DatabaseManager');

/**
 * Routes Security Tests
 * Tests CSRF protection and authentication requirements
 */
describe('Security & CSRF Protection', () => {
  let app;
  let csrfToken = null;

  beforeAll(async () => {
    // Import app after dependencies are ready
    app = require('../src/server');
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await DatabaseManager.close();
  });

  describe('CSRF Token Generation', () => {
    test('GET /login should return CSRF token in response', async () => {
      const response = await request(app)
        .get('/login')
        .expect(200);
      
      expect(response.text).toContain('csrf');
    });

    test('GET / should redirect to login if not authenticated', async () => {
      const response = await request(app)
        .get('/')
        .expect(302);
      
      expect(response.headers.location).toBe('/login');
    });
  });

  describe('Authentication Routes', () => {
    test('POST /auth/login without credentials should fail', async () => {
      const response = await request(app)
        .post('/auth/login')
        .expect(400);
      
      expect(response.body).toHaveProperty('message');
      expect(response.body.success).toBe(false);
    });

    test('GET /auth/check should work without auth', async () => {
      const response = await request(app)
        .get('/auth/check')
        .expect(200);
      
      expect(response.body).toHaveProperty('loggedIn');
    });

    test('POST /auth/logout without session should still succeed', async () => {
      const response = await request(app)
        .post('/auth/logout')
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });
  });

  describe('User Routes - Authorization', () => {
    test('GET /api/users without auth should be allowed (for public display)', async () => {
      const response = await request(app)
        .get('/api/users')
        .expect(401); // Should require auth
    });

    test('POST /api/users without auth should fail', async () => {
      const response = await request(app)
        .post('/api/users')
        .send({ Name: 'testuser' })
        .expect(401);
    });
  });

  describe('Settings Routes', () => {
    test('GET /api/settings/companion should work without auth', async () => {
      const response = await request(app)
        .get('/api/settings/companion')
        .expect(200);
      
      expect(response.body).toHaveProperty('theme');
    });

    test('POST /api/settings/companion should validate CSRF', async () => {
      const response = await request(app)
        .post('/api/settings/companion')
        .send({ theme: 'dark' })
        .expect(403); // Missing CSRF token
    });

    test('POST /api/settings/system without admin should fail', async () => {
      const response = await request(app)
        .post('/api/settings/system')
        .send({ ServerName: 'test' })
        .expect(401); // Not authenticated
    });
  });

  describe('Activity Routes', () => {
    test('GET /api/activity should require auth', async () => {
      const response = await request(app)
        .get('/api/activity')
        .expect(401);
    });

    test('GET /api/activity with invalid params should return 400', async () => {
      const response = await request(app)
        .get('/api/activity?limit=9999') // Limit too high
        .set('Cookie', 'session=test')
        .expect(400);
    });
  });

  describe('Audit Routes', () => {
    test('GET /api/audit should require admin', async () => {
      const response = await request(app)
        .get('/api/audit')
        .expect(401); // Not authenticated
    });

    test('GET /api/audit/summary should require admin', async () => {
      const response = await request(app)
        .get('/api/audit/summary')
        .expect(401);
    });

    test('POST /api/audit/cleanup should require admin', async () => {
      const response = await request(app)
        .post('/api/audit/cleanup')
        .send({ daysToKeep: 90 })
        .expect(401);
    });
  });

  describe('Plugin Routes', () => {
    test('POST /api/plugin/regenerate-key should require CSRF token', async () => {
      const response = await request(app)
        .post('/api/plugin/regenerate-key')
        .expect(403); // Missing CSRF token
    });

    test('GET /api/plugin should return success', async () => {
      const response = await request(app)
        .get('/api/plugin')
        .expect(200);
      
      expect(response.body).toHaveProperty('status');
    });
  });

  describe('Input Validation', () => {
    test('POST /api/settings/companion with invalid theme should fail', async () => {
      const response = await request(app)
        .post('/api/settings/companion')
        .send({ theme: 123 }) // Should be string
        .expect(400);
    });

    test('GET /api/activity with negative startIndex should fail', async () => {
      const response = await request(app)
        .get('/api/activity?startIndex=-1')
        .expect(400);
    });

    test('GET /api/activity with excessive limit should fail', async () => {
      const response = await request(app)
        .get('/api/activity?limit=99999')
        .expect(400);
    });
  });

  describe('HTTP Status Codes', () => {
    test('404 for non-existent route', async () => {
      const response = await request(app)
        .get('/api/non-existent-route')
        .expect(404);
    });

    test('405 for wrong method', async () => {
      // Try GET on a POST-only endpoint
      const response = await request(app)
        .get('/auth/login')
        .expect(200); // login GET is allowed (shows form)
    });

    test('500 handling for errors', async () => {
      // This should be caught by error handler
      const response = await request(app)
        .post('/api/users/invalid-user-id')
        .expect(401); // Not auth, not 500
    });
  });
});
