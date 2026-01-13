/**
 * Migration script to move from file-based storage to SQLite
 * Run with: node migrate-to-db.js
 */

const fs = require('fs');
const path = require('path');
const DatabaseManager = require('./src/models/DatabaseManager');

async function migrateSettings() {
  console.log('\n📝 Migrating settings to database...');
  const settingsPath = path.join(__dirname, 'src/config/settings.json');
  
  if (fs.existsSync(settingsPath)) {
    try {
      const settingsData = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      
      // Store all settings in database
      for (const [key, value] of Object.entries(settingsData)) {
        if (key !== 'updatedAt') {
          const type = typeof value === 'object' ? 'json' : 'string';
          await DatabaseManager.setSetting(key, value, type);
        }
      }
      
      console.log('✅ Settings migrated successfully');
      return true;
    } catch (err) {
      console.error('❌ Error migrating settings:', err);
      return false;
    }
  } else {
    console.log('ℹ️  No settings file found to migrate');
    return true;
  }
}

async function migrateAuditLogs() {
  console.log('\n📊 Migrating audit logs to database...');
  const auditPath = path.join(__dirname, 'src/config/audit.log');
  
  if (fs.existsSync(auditPath)) {
    try {
      const content = fs.readFileSync(auditPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let migratedCount = 0;
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          await DatabaseManager.insertAuditLog(
            entry.action,
            entry.userId,
            entry.resource,
            entry.status || 'success',
            entry.ip,
            entry.details || {}
          );
          migratedCount++;
        } catch (e) {
          console.warn('⚠️  Failed to parse audit entry:', line.substring(0, 50));
        }
      }
      
      console.log(`✅ Migrated ${migratedCount} audit log entries`);
      return true;
    } catch (err) {
      console.error('❌ Error migrating audit logs:', err);
      return false;
    }
  } else {
    console.log('ℹ️  No audit log file found to migrate');
    return true;
  }
}

async function verifyMigration() {
  console.log('\n✔️ Verifying migration...');
  
  const allSettings = await DatabaseManager.getAllSettings();
  const auditLogs = await DatabaseManager.getAuditLogs({ limit: 5 });
  const stats = await DatabaseManager.getAuditStats();
  
  console.log(`   Settings stored: ${Object.keys(allSettings).length}`);
  console.log(`   Audit logs stored: ${stats.total}`);
  console.log(`   Recent sample: ${auditLogs.length} logs`);
  
  console.log('\n✅ Database verification complete');
  console.log('\n⚠️  IMPORTANT: If migration was successful, you should:');
  console.log('   1. Backup your old files:');
  console.log('      - src/config/settings.json');
  console.log('      - src/config/audit.log');
  console.log('   2. Update src/models/AuditLogger.js to use database backend');
  console.log('   3. Update src/models/SettingsManager.js to use database backend');
  console.log('   4. Restart the application');
}

async function runMigration() {
  console.log('🚀 Starting migration to SQLite...\n');
  
  try {
    const settingsOk = await migrateSettings();
    const auditOk = await migrateAuditLogs();
    
    if (settingsOk && auditOk) {
      await verifyMigration();
      console.log('\n✅ Migration complete!');
    } else {
      console.log('\n❌ Migration failed - please check errors above');
    }
  } catch (err) {
    console.error('\n❌ Fatal error during migration:', err);
  } finally {
    await DatabaseManager.close();
  }
}

runMigration();
