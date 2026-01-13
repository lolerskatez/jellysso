#!/usr/bin/env node
/**
 * COMMAND REFERENCE - Quick lookup for all available commands
 */

const fs = require('fs');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                   COMMAND REFERENCE                           ║
║              Jellyfin Companion - Quick Lookup                 ║
╚════════════════════════════════════════════════════════════════╝

🚀 DEVELOPMENT & DEPLOYMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

npm start                    Start application in production mode
npm run dev                  Start application in development mode (with hot reload)
npm run docker:test         Run application in Docker for testing

🧪 TESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

npm test                    Run all tests
npm run test:comprehensive  Run core feature tests (SessionStore, Cache, Plugins)
npm run test:admin          Run admin feature tests (Backups, Provisioning, Analytics)
npm run test:integration    Run integration tests
npm run test:all            Run all test suites
npm run test:setup          Run test setup wizard

📊 PERFORMANCE & BENCHMARKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

npm run benchmark           Run complete benchmark suite
npm run benchmark:performance  Run performance tests only
npm run benchmark:load      Run load testing only

🔍 VERIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

node verify-codebase.js     Verify all implementation files are in place
node verify-qa.js           Verify QA infrastructure (tests & benchmarks)

📝 UTILITY SCRIPTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

node setup-test.js          Run test setup wizard
node test-setup-wizard.js   Interactive test configuration wizard
node migrate-to-db.js       Migrate settings to database

════════════════════════════════════════════════════════════════════

📚 RECOMMENDED WORKFLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FIRST TIME SETUP:
  1. npm install
  2. node verify-codebase.js
  3. node verify-qa.js
  4. npm test
  5. npm run benchmark

DEVELOPMENT:
  1. npm run dev              (Keep running)
  2. npm test:comprehensive   (Run tests while developing)
  3. npm run benchmark        (Before committing)

PRE-DEPLOYMENT:
  1. npm run test:all
  2. npm run benchmark
  3. npm run docker:test      (Optional, test in Docker)
  4. Code review
  5. Deploy

MONITORING PERFORMANCE:
  1. npm run benchmark        (Establish baseline)
  2. npm run benchmark        (Weekly/Monthly for comparison)
  3. Track results in benchmark-results.json
  4. Monitor trends over time

════════════════════════════════════════════════════════════════════

📦 AVAILABLE TEST FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Core Tests (tests/comprehensive.test.js):
  ✅ SessionStore - 4 tests
  ✅ CacheManager - 6 tests
  ✅ PluginManager - 5 tests
  ✅ System APIs - 6 tests
  ✅ Data Integrity - 3 tests
  ✅ Performance Baselines - 3 tests

Admin Features Tests (tests/admin-features.test.js):
  ✅ Backup Management - 3 tests
  ✅ User Provisioning - 4 tests
  ✅ Analytics - 7 tests
  ✅ Data Validation - 4 tests

Integration Tests (tests/integration.test.js):
  ✅ API Integration - Various
  ✅ JellyfinAPI - Various
  ✅ Database Manager - Various

════════════════════════════════════════════════════════════════════

🎯 BENCHMARK SUITES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Performance Suite (benchmarks/performance-suite.js):
  📊 SessionStore Performance - 1000+ iterations
  📊 CacheManager Performance - 10000+ iterations
  📊 PluginManager Performance - 100+ hooks, 1000+ executions
  📊 Concurrent Operations - 500 concurrent ops
  📊 HTML Report Generation

Load Testing Suite (benchmarks/load-testing.js):
  📊 SessionStore Load - 50 concurrent users
  📊 CacheManager Load - 50 concurrent users
  📊 PluginManager Load - 20 concurrent executions
  📊 API Simulation - 100 connections

════════════════════════════════════════════════════════════════════

📖 DOCUMENTATION FILES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

README.md
  Main project documentation

INFRASTRUCTURE_IMPLEMENTATION.md
  • Complete technical architecture
  • Feature-by-feature breakdown
  • API endpoint documentation
  • Integration architecture

INFRASTRUCTURE_QUICK_REFERENCE.md
  • Quick lookup for common operations
  • Code examples for each feature
  • Troubleshooting guide
  • Environment variables reference

CODEBASE_VERIFICATION_REPORT.md
  • Comprehensive verification results
  • File structure analysis
  • Integration verification
  • Security checklist

TESTING_AND_BENCHMARKS.md
  • Complete testing guide
  • Benchmark explanation
  • Performance baselines
  • CI/CD integration recommendations

PROJECT_COMPLETION_SUMMARY.md
  • Full project overview
  • Delivery summary
  • Next steps
  • Support resources

FINAL_DELIVERY_CHECKLIST.md
  • Complete verification checklist
  • Deployment readiness
  • Quality verification
  • Pre-deployment steps

════════════════════════════════════════════════════════════════════

🔗 COMMON WORKFLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

QUICK VALIDATION:
  npm test && npm run benchmark

FULL VALIDATION:
  npm run test:all && npm run benchmark && node verify-codebase.js

PERFORMANCE BASELINE:
  npm run benchmark > baseline-$(date +%Y-%m-%d).txt

DEVELOPMENT LOOP:
  npm run dev                 # Terminal 1
  npm test -- --watch        # Terminal 2

DEPLOYMENT PREP:
  npm run test:all           # All tests
  npm run benchmark          # Performance tests
  docker-compose -f docker-compose.prod.yml build

════════════════════════════════════════════════════════════════════

⚡ QUICK TIPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Use 'npm run' to see all available scripts
2. Run tests before each commit: npm test
3. Monitor performance trends: npm run benchmark
4. Check documentation for troubleshooting
5. Use 'npm run dev' for development with hot reload
6. Keep benchmark results for trend analysis
7. Review HTML benchmark reports in browser

════════════════════════════════════════════════════════════════════

📊 EXPECTED OUTPUT LOCATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

After 'npm run benchmark':
  ✅ benchmark-results.json      - Detailed metrics
  ✅ benchmark-report.html       - Visual dashboard
  ✅ load-test-results.json      - Load test metrics

After 'npm test':
  ✅ Test output in console      - Test results
  ✅ Coverage reports (optional) - Code coverage

After application start:
  ✅ logs/error.log              - Error logging
  ✅ logs/combined.log           - All logging
  ✅ src/config/companion.db     - SQLite database

════════════════════════════════════════════════════════════════════

🎯 NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Read: FINAL_DELIVERY_CHECKLIST.md
2. Run:  npm test
3. Run:  npm run benchmark
4. Review: benchmark-report.html
5. Deploy: Follow deployment guide in documentation

════════════════════════════════════════════════════════════════════
`);

// Also list all available npm scripts
try {
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  console.log('📋 FULL SCRIPT LIST FROM PACKAGE.JSON:\n');
  Object.entries(pkg.scripts || {}).forEach(([name, cmd]) => {
    console.log(\`  npm run \${name}\${name.length < 20 ? ' '.repeat(20 - name.length) : ' '} → \${cmd}\`);
  });
  console.log('\n');
} catch (e) {
  // Ignore if package.json not found
}

console.log('════════════════════════════════════════════════════════════════════\n');
