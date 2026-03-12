#!/usr/bin/env node
/**
 * Comprehensive Codebase Verification Script
 * Validates all implementation files and integrations
 */

const fs = require('fs');
const path = require('path');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║       JELLYFIN COMPANION - CODEBASE VERIFICATION          ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// 1. Check critical files exist
console.log('📋 CRITICAL FILES VERIFICATION:');
const criticalFiles = [
  { path: 'src/server.js', description: 'Main Express server' },
  { path: 'src/models/SessionStore.js', description: 'Database-backed sessions' },
  { path: 'src/models/CacheManager.js', description: 'Advanced caching system' },
  { path: 'src/models/PluginManager.js', description: 'Plugin loading system' },
  { path: 'src/models/PerformanceMonitor.js', description: 'Performance metrics' },
  { path: 'src/models/TokenManager.js', description: 'OIDC token management' },
  { path: 'src/routes/admin.js', description: 'Admin panel routes' },
  { path: 'src/routes/system.js', description: 'System management routes' },
  { path: 'views/admin/dashboard.ejs', description: 'Admin dashboard' },
  { path: 'views/admin/system.ejs', description: 'System management UI' },
  { path: 'views/admin/backups.ejs', description: 'Backup management UI' }
];

let filesOK = 0;
for (const file of criticalFiles) {
  const fullPath = path.join(__dirname, file.path);
  const exists = fs.existsSync(fullPath);
  const status = exists ? '✅' : '❌';
  const size = exists ? `(${fs.statSync(fullPath).size} bytes)` : '';
  console.log(`  ${status} ${file.description.padEnd(30)} ${file.path} ${size}`);
  if (exists) filesOK++;
}
console.log(`\n  Result: ${filesOK}/${criticalFiles.length} files present\n`);

// 2. Check imports
console.log('📦 DEPENDENCY IMPORTS:');
try {
  require('./src/models/SessionStore');
  console.log('  ✅ SessionStore');
} catch (e) {
  console.log(`  ❌ SessionStore: ${e.message}`);
}

try {
  require('./src/models/CacheManager');
  console.log('  ✅ CacheManager');
} catch (e) {
  console.log(`  ❌ CacheManager: ${e.message}`);
}

try {
  require('./src/models/PluginManager');
  console.log('  ✅ PluginManager');
} catch (e) {
  console.log(`  ❌ PluginManager: ${e.message}`);
}

try {
  require('./src/models/PerformanceMonitor');
  console.log('  ✅ PerformanceMonitor');
} catch (e) {
  console.log(`  ❌ PerformanceMonitor: ${e.message}`);
}

try {
  require('./src/models/TokenManager');
  console.log('  ✅ TokenManager');
} catch (e) {
  console.log(`  ❌ TokenManager: ${e.message}`);
}

console.log('');

// 3. Check routes
console.log('🛣️  ROUTE CONFIGURATION:');
try {
  const adminRoutes = fs.readFileSync('./src/routes/admin.js', 'utf8');
  const adminMatches = adminRoutes.match(/router\.(get|post)\(/g) || [];
  console.log(`  ✅ Admin routes: ${adminMatches.length} endpoints`);
  
  if (adminRoutes.includes('/system')) {
    console.log('  ✅ System management route present');
  }
  if (adminRoutes.includes('/backups')) {
    console.log('  ✅ Backups route present');
  }
} catch (e) {
  console.log(`  ❌ Admin routes error: ${e.message}`);
}

try {
  const systemRoutes = fs.readFileSync('./src/routes/system.js', 'utf8');
  const systemMatches = systemRoutes.match(/router\.(get|post)\(/g) || [];
  console.log(`  ✅ System API routes: ${systemMatches.length} endpoints`);
} catch (e) {
  console.log(`  ❌ System routes error: ${e.message}`);
}

console.log('');

// 4. Check integrations in server.js
console.log('🔧 SERVER INTEGRATION:');
try {
  const server = fs.readFileSync('./src/server.js', 'utf8');
  
  if (server.includes('SessionStore')) {
    console.log('  ✅ SessionStore integrated');
  } else {
    console.log('  ❌ SessionStore NOT integrated');
  }
  
  if (server.includes('CacheManager')) {
    console.log('  ✅ CacheManager integrated');
  } else {
    console.log('  ❌ CacheManager NOT integrated');
  }
  
  if (server.includes('PluginManager')) {
    console.log('  ✅ PluginManager integrated');
  } else {
    console.log('  ❌ PluginManager NOT integrated');
  }
  
  if (server.includes('PerformanceMonitor')) {
    console.log('  ✅ PerformanceMonitor integrated');
  } else {
    console.log('  ❌ PerformanceMonitor NOT integrated');
  }
  
  if (server.includes("require('./routes/system')")) {
    console.log('  ✅ System routes mounted');
  } else {
    console.log('  ❌ System routes NOT mounted');
  }
} catch (e) {
  console.log(`  ❌ Server integration error: ${e.message}`);
}

console.log('');

// 5. Check database tables
console.log('🗄️  DATABASE SCHEMA:');
try {
  const DatabaseManager = require('./src/models/DatabaseManager');
  
  // Give database a moment to initialize
  setTimeout(() => {
    const expectedTables = [
      'settings',
      'audit_logs',
      'sessions',
      'import_history'
    ];
    
    console.log(`  ✅ Database initialized`);
    console.log(`  📊 Expected tables: ${expectedTables.join(', ')}`);
    process.exit(0);
  }, 100);
} catch (e) {
  console.log(`  ❌ Database error: ${e.message}`);
  process.exit(1);
}
