const JellyfinAPI = require('../src/models/JellyfinAPI');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('JellyfinAPI', () => {
  let api;

  beforeEach(() => {
    // Clear all mocks
    mockedAxios.create.mockClear();
    api = new JellyfinAPI('http://localhost:8096');
  });

  test('should create instance correctly', () => {
    expect(api.baseURL).toBe('http://localhost:8096');
    expect(api.apiKey).toBeNull();
  });

  test('should handle network errors gracefully', async () => {
    // Mock network error
    mockedAxios.create.mockReturnValue({
      get: jest.fn().mockRejectedValue({ code: 'ECONNREFUSED' })
    });

    const invalidApi = new JellyfinAPI('http://invalid-url');
    invalidApi.client = mockedAxios.create();

    await expect(invalidApi.getUsers()).rejects.toThrow(
      'Unable to connect to Jellyfin server'
    );
  });

  test('should handle authentication errors', async () => {
    // Mock authentication error
    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockRejectedValue({
        response: { status: 401, data: { message: 'Invalid username or password' } }
      })
    });

    api.client = mockedAxios.create();

    await expect(api.authenticateByName('invalid', 'invalid')).rejects.toThrow(
      'Authentication failed'
    );
  });

  test('should handle successful authentication', async () => {
    const mockResponse = {
      data: {
        User: { Id: '123', Name: 'testuser' },
        AccessToken: 'mock-token'
      }
    };

    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockResolvedValue(mockResponse),
      defaults: { headers: {} }
    });

    api.client = mockedAxios.create();

    const result = await api.authenticateByName('testuser', 'password');
    expect(result.User.Name).toBe('testuser');
    expect(api.apiKey).toBe('mock-token');
  });
});