const logger = require('../utils/logger');
'use strict';

/**
 * MigrationManager — lightweight schema migration versioning
 *
 * Maintains a `schema_migrations` table that records which numbered migrations
 * have been applied.  New migrations are appended to the MIGRATIONS array and
 * are run automatically on startup, in order, against any database that does
 * not yet have them applied.
 *
 * Each migration SQL is idempotent by design: "duplicate column name" and
 * "already exists" errors from SQLite are swallowed and the migration is still
 * recorded as applied.
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'add_invites_maxUses',
    sql: 'ALTER TABLE invites ADD COLUMN maxUses INTEGER DEFAULT 1'
  },
  {
    version: 2,
    name: 'add_invites_userExpiryDays',
    sql: 'ALTER TABLE invites ADD COLUMN userExpiryDays INTEGER'
  },
  {
    version: 3,
    name: 'add_sessions_updatedAt',
    sql: 'ALTER TABLE sessions ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP'
  },
  {
    version: 4,
    name: 'add_user_policies_accountEnabled',
    sql: 'ALTER TABLE user_policies ADD COLUMN accountEnabled INTEGER NOT NULL DEFAULT 1'
  },
  {
    version: 5,
    name: 'add_user_policies_expiresAt',
    sql: 'ALTER TABLE user_policies ADD COLUMN expiresAt TEXT'
  },
  {
    version: 6,
    name: 'add_user_policies_isAdmin',
    sql: 'ALTER TABLE user_policies ADD COLUMN isAdmin INTEGER NOT NULL DEFAULT 0'
  },
  {
    version: 7,
    name: 'add_user_policies_allowDownloads',
    sql: 'ALTER TABLE user_policies ADD COLUMN allowDownloads INTEGER NOT NULL DEFAULT 1'
  }
];

/**
 * Run all pending migrations against the given sqlite3 db handle.
 * @param {import('sqlite3').Database} db
 */
async function runMigrations(db) {
  const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.run(sql, params, (err) => (err ? reject(err) : resolve()))
    );

  const all = (sql, params = []) =>
    new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );

  // Ensure the tracking table exists
  await run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name    TEXT    NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = await all('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    try {
      await run(migration.sql);
    } catch (err) {
      // Idempotent: skip structural conflicts from already-applied changes
      const msg = err.message || '';
      if (
        !msg.includes('duplicate column name') &&
        !msg.includes('already exists') &&
        !msg.includes('no such table')
      ) {
        throw err;
      }
    }

    await run(
      'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
      [migration.version, migration.name]
    );
    logger.info(`[MigrationManager] Applied migration ${migration.version}: ${migration.name}`);
  }
}

module.exports = { runMigrations };
