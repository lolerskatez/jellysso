/**
 * OpenAPI 3.0 Specification for JellySSO API
 * Provides comprehensive API documentation for all endpoints
 */

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'JellySSO API',
    description: 'Single Sign-On companion application for Jellyfin with advanced user management and policy enforcement',
    version: '1.0.0',
    contact: {
      name: 'JellySSO Project',
      url: 'https://github.com/jellysso/jellysso'
    },
    license: {
      name: 'MIT'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Development server'
    },
    {
      url: 'https://jellysso.example.com',
      description: 'Production server'
    }
  ],
  tags: [
    { name: 'Authentication', description: 'User authentication and session management' },
    { name: 'Users', description: 'User management operations' },
    { name: 'Policies', description: 'User policy and access control' },
    { name: 'Settings', description: 'Application and system settings' },
    { name: 'Admin', description: 'Administrative operations' },
    { name: 'System', description: 'System information and health' },
    { name: 'QuickConnect', description: 'Jellyfin QuickConnect integration' },
    { name: '2FA', description: 'Two-factor authentication' },
    { name: 'Audit', description: 'Audit logging and activity tracking' }
  ],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'User login',
        description: 'Authenticate user with username and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'john.doe' },
                  password: { type: 'string', format: 'password', example: 'password123' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    user: { $ref: '#/components/schemas/User' }
                  }
                }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          429: { $ref: '#/components/responses/RateLimitError' }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'User logout',
        description: 'Destroy user session',
        responses: {
          200: {
            description: 'Logout successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/auth/check': {
      get: {
        tags: ['Authentication'],
        summary: 'Check authentication status',
        description: 'Verify if user is authenticated',
        responses: {
          200: {
            description: 'Authentication status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    loggedIn: { type: 'boolean' },
                    user: { $ref: '#/components/schemas/User' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        description: 'Get list of all users with optional filtering',
        parameters: [
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string' },
            description: 'Search by username'
          },
          {
            name: 'isDisabled',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Filter by disabled status'
          },
          {
            name: 'isAdministrator',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Filter by admin status'
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
            description: 'Number of results to return'
          },
          {
            name: 'startIndex',
            in: 'query',
            schema: { type: 'integer', default: 0 },
            description: 'Starting index for pagination'
          }
        ],
        responses: {
          200: {
            description: 'List of users',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    Items: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    TotalRecordCount: { type: 'integer' },
                    StartIndex: { type: 'integer' }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      },
      post: {
        tags: ['Users'],
        summary: 'Create user',
        description: 'Create a new user (admin only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['Name'],
                properties: {
                  Name: { type: 'string', example: 'John Doe' },
                  Password: { type: 'string', format: 'password' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'User created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          403: { $ref: '#/components/responses/ForbiddenError' }
        }
      }
    },
    '/api/users/{userId}': {
      get: {
        tags: ['Users'],
        summary: 'Get user details',
        description: 'Get detailed information about a specific user',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'User ID'
          }
        ],
        responses: {
          200: {
            description: 'User details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' }
              }
            }
          },
          404: { $ref: '#/components/responses/NotFoundError' }
        }
      },
      put: {
        tags: ['Users'],
        summary: 'Update user',
        description: 'Update user information (admin only)',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  Name: { type: 'string' },
                  Password: { type: 'string', format: 'password' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'User updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' }
              }
            }
          },
          403: { $ref: '#/components/responses/ForbiddenError' },
          404: { $ref: '#/components/responses/NotFoundError' }
        }
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete user',
        description: 'Delete a user (admin only)',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string' }
          }
        ],
        responses: {
          200: {
            description: 'User deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' }
                  }
                }
              }
            }
          },
          403: { $ref: '#/components/responses/ForbiddenError' },
          404: { $ref: '#/components/responses/NotFoundError' }
        }
      }
    },
    '/api/policy/user/policy': {
      get: {
        tags: ['Policies'],
        summary: 'Get user policy',
        description: 'Get current user\'s policy settings',
        responses: {
          200: {
            description: 'User policy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    policy: { $ref: '#/components/schemas/Policy' },
                    whitelistedDevices: { type: 'array', items: { $ref: '#/components/schemas/Device' } },
                    availableTiers: { type: 'array', items: { type: 'string' } }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    },
    '/api/policy/user/device/whitelist': {
      post: {
        tags: ['Policies'],
        summary: 'Add whitelisted device',
        description: 'Add current device to user\'s whitelist',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId'],
                properties: {
                  deviceId: { type: 'string', example: 'device-123' },
                  deviceName: { type: 'string', example: 'My Laptop' },
                  deviceType: { type: 'string', example: 'web' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Device added',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' }
                  }
                }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    },
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get settings',
        description: 'Get application settings',
        responses: {
          200: {
            description: 'Settings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
                    language: { type: 'string' },
                    notifications: { type: 'boolean' }
                  }
                }
              }
            }
          }
        }
      },
      put: {
        tags: ['Settings'],
        summary: 'Update settings',
        description: 'Update application settings',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
                  language: { type: 'string' },
                  notifications: { type: 'boolean' }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Settings updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' }
                  }
                }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Check if API is healthy',
        responses: {
          200: {
            description: 'API is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'error'] },
                    timestamp: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/server-info': {
      get: {
        tags: ['System'],
        summary: 'Server information',
        description: 'Get Jellyfin server information',
        responses: {
          200: {
            description: 'Server info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    online: { type: 'boolean' },
                    version: { type: 'string' },
                    serverName: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/api/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Get audit logs',
        description: 'Get audit logs with filtering and pagination',
        parameters: [
          {
            name: 'action',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by action'
          },
          {
            name: 'userId',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by user ID'
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
            description: 'Number of results'
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
            description: 'Starting offset'
          }
        ],
        responses: {
          200: {
            description: 'Audit logs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    logs: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } },
                    total: { type: 'integer' }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    }
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          Id: { type: 'string', example: 'user-123' },
          Name: { type: 'string', example: 'John Doe' },
          PrimaryImageTag: { type: 'string' },
          Policy: {
            type: 'object',
            properties: {
              IsAdministrator: { type: 'boolean' },
              IsDisabled: { type: 'boolean' }
            }
          }
        }
      },
      Policy: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['Free', 'Standard', 'Premium', 'Family'] },
          maxConcurrentStreams: { type: 'integer' },
          deviceWhitelistEnabled: { type: 'boolean' },
          enforceAccessSchedule: { type: 'boolean' }
        }
      },
      Device: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          deviceName: { type: 'string' },
          deviceType: { type: 'string' },
          addedAt: { type: 'string', format: 'date-time' }
        }
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          action: { type: 'string' },
          userId: { type: 'string' },
          resource: { type: 'string' },
          status: { type: 'string', enum: ['success', 'failure'] },
          timestamp: { type: 'string', format: 'date-time' },
          ip: { type: 'string' }
        }
      },
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              requestId: { type: 'string' }
            }
          }
        }
      }
    },
    responses: {
      ValidationError: {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'VALIDATION_ERROR' },
                    message: { type: 'string' },
                    details: { type: 'array', items: { type: 'string' } },
                    timestamp: { type: 'string', format: 'date-time' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      UnauthorizedError: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'INVALID_CREDENTIALS' },
                    message: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      ForbiddenError: {
        description: 'Forbidden',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'FORBIDDEN' },
                    message: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      NotFoundError: {
        description: 'Not found',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'NOT_FOUND' },
                    message: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      RateLimitError: {
        description: 'Rate limit exceeded',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', example: 'RATE_LIMIT_EXCEEDED' },
                    message: { type: 'string' },
                    retryAfter: { type: 'integer' },
                    timestamp: { type: 'string', format: 'date-time' },
                    requestId: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      }
    },
    securitySchemes: {
      sessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Session cookie authentication'
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token authentication'
      }
    }
  },
  security: [
    { sessionAuth: [] },
    { bearerAuth: [] }
  ]
};

module.exports = openApiSpec;
