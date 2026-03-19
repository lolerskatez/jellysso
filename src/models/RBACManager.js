/**
 * Role-Based Access Control (RBAC) Manager
 * Manages roles, permissions, and user role assignments
 */

const DatabaseManager = require('./DatabaseManager');
const logger = require('../utils/logger');

class RBACManager {
  static instance = null;

  static getInstance() {
    if (!RBACManager.instance) {
      RBACManager.instance = new RBACManager();
      RBACManager.instance.initializeSchema();
    }
    return RBACManager.instance;
  }

  /**
   * Initialize database schema
   */
  async initializeSchema() {
    const db = DatabaseManager.db;

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Roles table
        db.run(`
          CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            is_system INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create roles table', { error: err.message });
            reject(err);
          }
        });

        // Permissions table
        db.run(`
          CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT,
            category TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create permissions table', { error: err.message });
            reject(err);
          }
        });

        // Role-Permission mapping
        db.run(`
          CREATE TABLE IF NOT EXISTS role_permissions (
            role_id INTEGER NOT NULL,
            permission_id INTEGER NOT NULL,
            PRIMARY KEY (role_id, permission_id),
            FOREIGN KEY (role_id) REFERENCES roles(id),
            FOREIGN KEY (permission_id) REFERENCES permissions(id)
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create role_permissions table', { error: err.message });
            reject(err);
          }
        });

        // User-Role mapping
        db.run(`
          CREATE TABLE IF NOT EXISTS user_roles (
            user_id TEXT NOT NULL,
            role_id INTEGER NOT NULL,
            assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, role_id),
            FOREIGN KEY (role_id) REFERENCES roles(id)
          )
        `, (err) => {
          if (err) {
            logger.error('Failed to create user_roles table', { error: err.message });
            reject(err);
          }
        });

        // Create indexes
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)
        `, (err) => {
          if (err) {
            logger.error('Failed to create indexes', { error: err.message });
            reject(err);
          } else {
            this.initializeDefaultRoles();
            logger.info('RBAC schema initialized');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Initialize default roles and permissions
   */
  async initializeDefaultRoles() {
    const db = DatabaseManager.db;

    // Default permissions
    const permissions = [
      // User management
      { name: 'users:read', description: 'View users', category: 'users' },
      { name: 'users:create', description: 'Create users', category: 'users' },
      { name: 'users:update', description: 'Update users', category: 'users' },
      { name: 'users:delete', description: 'Delete users', category: 'users' },
      // Policy management
      { name: 'policies:read', description: 'View policies', category: 'policies' },
      { name: 'policies:update', description: 'Update policies', category: 'policies' },
      // Audit
      { name: 'audit:read', description: 'View audit logs', category: 'audit' },
      // Settings
      { name: 'settings:read', description: 'View settings', category: 'settings' },
      { name: 'settings:update', description: 'Update settings', category: 'settings' },
      // Admin
      { name: 'admin:access', description: 'Access admin panel', category: 'admin' },
      { name: 'admin:system', description: 'System administration', category: 'admin' },
      // 2FA
      { name: '2fa:manage', description: 'Manage 2FA settings', category: '2fa' },
      // API Keys
      { name: 'api-keys:read', description: 'View API keys', category: 'api-keys' },
      { name: 'api-keys:create', description: 'Create API keys', category: 'api-keys' },
      { name: 'api-keys:delete', description: 'Delete API keys', category: 'api-keys' }
    ];

    // Insert permissions
    for (const perm of permissions) {
      db.run(
        `INSERT OR IGNORE INTO permissions (name, description, category) VALUES (?, ?, ?)`,
        [perm.name, perm.description, perm.category]
      );
    }

    // Default roles
    const roles = [
      {
        name: 'admin',
        description: 'Administrator with full system access',
        permissions: ['users:read', 'users:create', 'users:update', 'users:delete',
                     'policies:read', 'policies:update', 'audit:read',
                     'settings:read', 'settings:update', 'admin:access', 'admin:system',
                     '2fa:manage', 'api-keys:read', 'api-keys:create', 'api-keys:delete']
      },
      {
        name: 'manager',
        description: 'User manager with limited admin access',
        permissions: ['users:read', 'users:create', 'users:update',
                     'policies:read', 'policies:update', 'audit:read',
                     'settings:read', 'admin:access', '2fa:manage']
      },
      {
        name: 'moderator',
        description: 'Moderator with audit and policy view access',
        permissions: ['users:read', 'policies:read', 'audit:read', 'admin:access']
      },
      {
        name: 'user',
        description: 'Regular user with personal settings access',
        permissions: ['settings:read', '2fa:manage', 'api-keys:read', 'api-keys:create']
      }
    ];

    // Insert roles and assign permissions
    for (const role of roles) {
      db.run(
        `INSERT OR IGNORE INTO roles (name, description, is_system) VALUES (?, ?, 1)`,
        [role.name, role.description],
        function(err) {
          if (!err) {
            const roleId = this.lastID;
            for (const permName of role.permissions) {
              db.run(
                `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
                 SELECT ?, id FROM permissions WHERE name = ?`,
                [roleId, permName]
              );
            }
          }
        }
      );
    }

    logger.info('Default RBAC roles and permissions initialized');
  }

  /**
   * Get all roles
   */
  async getRoles() {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.all(
        `SELECT id, name, description, is_system, created_at FROM roles ORDER BY name`,
        (err, rows) => {
          if (err) {
            logger.error('Failed to get roles', { error: err.message });
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get role by ID with permissions
   */
  async getRoleWithPermissions(roleId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.get(
        `SELECT id, name, description, is_system FROM roles WHERE id = ?`,
        [roleId],
        async (err, role) => {
          if (err) {
            logger.error('Failed to get role', { error: err.message });
            reject(err);
          } else if (!role) {
            resolve(null);
          } else {
            // Get permissions for this role
            db.all(
              `SELECT p.id, p.name, p.description, p.category 
               FROM permissions p
               JOIN role_permissions rp ON p.id = rp.permission_id
               WHERE rp.role_id = ?`,
              [roleId],
              (err, permissions) => {
                if (err) {
                  reject(err);
                } else {
                  resolve({ ...role, permissions: permissions || [] });
                }
              }
            );
          }
        }
      );
    });
  }

  /**
   * Create new role
   */
  async createRole(name, description, permissionIds = []) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.run(
        `INSERT INTO roles (name, description, is_system) VALUES (?, ?, 0)`,
        [name, description],
        function(err) {
          if (err) {
            logger.error('Failed to create role', { error: err.message });
            reject(err);
          } else {
            const roleId = this.lastID;
            
            // Assign permissions
            if (permissionIds.length > 0) {
              const placeholders = permissionIds.map(() => '?').join(',');
              db.run(
                `INSERT INTO role_permissions (role_id, permission_id) 
                 SELECT ?, id FROM permissions WHERE id IN (${placeholders})`,
                [roleId, ...permissionIds],
                (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    logger.info('Role created', { roleId, name });
                    resolve(roleId);
                  }
                }
              );
            } else {
              logger.info('Role created', { roleId, name });
              resolve(roleId);
            }
          }
        }
      );
    });
  }

  /**
   * Update role permissions
   */
  async updateRolePermissions(roleId, permissionIds) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      
      db.serialize(() => {
        // Delete existing permissions
        db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId], (err) => {
          if (err) {
            logger.error('Failed to update role permissions', { error: err.message });
            reject(err);
          }
        });

        // Add new permissions
        if (permissionIds.length > 0) {
          const placeholders = permissionIds.map(() => '?').join(',');
          db.run(
            `INSERT INTO role_permissions (role_id, permission_id) 
             SELECT ?, id FROM permissions WHERE id IN (${placeholders})`,
            [roleId, ...permissionIds],
            (err) => {
              if (err) {
                reject(err);
              } else {
                logger.info('Role permissions updated', { roleId });
                resolve();
              }
            }
          );
        } else {
          logger.info('Role permissions updated', { roleId });
          resolve();
        }
      });
    });
  }

  /**
   * Delete role
   */
  async deleteRole(roleId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      
      db.serialize(() => {
        // Delete role permissions
        db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

        // Delete user roles
        db.run(`DELETE FROM user_roles WHERE role_id = ?`, [roleId]);

        // Delete role
        db.run(`DELETE FROM roles WHERE id = ?`, [roleId], (err) => {
          if (err) {
            logger.error('Failed to delete role', { error: err.message });
            reject(err);
          } else {
            logger.info('Role deleted', { roleId });
            resolve();
          }
        });
      });
    });
  }

  /**
   * Assign role to user
   */
  async assignRoleToUser(userId, roleId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.run(
        `INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`,
        [userId, roleId],
        (err) => {
          if (err) {
            logger.error('Failed to assign role to user', { error: err.message });
            reject(err);
          } else {
            logger.info('Role assigned to user', { userId, roleId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Remove role from user
   */
  async removeRoleFromUser(userId, roleId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.run(
        `DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`,
        [userId, roleId],
        (err) => {
          if (err) {
            logger.error('Failed to remove role from user', { error: err.message });
            reject(err);
          } else {
            logger.info('Role removed from user', { userId, roleId });
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get user's roles with permissions
   */
  async getUserRoles(userId) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.all(
        `SELECT r.id, r.name, r.description FROM roles r
         JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = ?`,
        [userId],
        async (err, roles) => {
          if (err) {
            logger.error('Failed to get user roles', { error: err.message });
            reject(err);
          } else {
            // Get all permissions for all roles
            const allPermissions = new Set();
            for (const role of roles || []) {
              const roleData = await this.getRoleWithPermissions(role.id);
              roleData.permissions.forEach(p => allPermissions.add(p.name));
            }
            resolve({
              roles: roles || [],
              permissions: Array.from(allPermissions)
            });
          }
        }
      );
    });
  }

  /**
   * Check if user has permission
   */
  async hasPermission(userId, permissionName) {
    const userRoles = await this.getUserRoles(userId);
    return userRoles.permissions.includes(permissionName);
  }

  /**
   * Check if user has any of the given permissions
   */
  async hasAnyPermission(userId, permissionNames) {
    const userRoles = await this.getUserRoles(userId);
    return permissionNames.some(perm => userRoles.permissions.includes(perm));
  }

  /**
   * Check if user has all of the given permissions
   */
  async hasAllPermissions(userId, permissionNames) {
    const userRoles = await this.getUserRoles(userId);
    return permissionNames.every(perm => userRoles.permissions.includes(perm));
  }

  /**
   * Get all permissions
   */
  async getPermissions(category = null) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      const query = category 
        ? `SELECT id, name, description, category FROM permissions WHERE category = ? ORDER BY category, name`
        : `SELECT id, name, description, category FROM permissions ORDER BY category, name`;
      
      const params = category ? [category] : [];

      db.all(query, params, (err, rows) => {
        if (err) {
          logger.error('Failed to get permissions', { error: err.message });
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * Get users with specific role
   */
  async getUsersWithRole(roleId, limit = 50) {
    return new Promise((resolve, reject) => {
      const db = DatabaseManager.db;
      db.all(
        `SELECT DISTINCT user_id FROM user_roles WHERE role_id = ? LIMIT ?`,
        [roleId, limit],
        (err, rows) => {
          if (err) {
            logger.error('Failed to get users with role', { error: err.message });
            reject(err);
          } else {
            resolve(rows?.map(r => r.user_id) || []);
          }
        }
      );
    });
  }
}

module.exports = RBACManager;
