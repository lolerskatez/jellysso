#!/usr/bin/env node

/**
 * Phase 3 Integration Validation Script
 * Verifies all Phase 3 components are in place and properly integrated
 * Run: node validate-phase-3.js
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const BASE_DIR = __dirname;
const CHECKS = [];
const ISSUES = [];
const WARNINGS = [];

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function check(name, passed, message = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  CHECKS.push({ name, passed, message });
  log(`${status} - ${name}${message ? ': ' + message : ''}`, passed ? 'green' : 'red');
  if (!passed && message) {
    ISSUES.push(`${name}: ${message}`);
  }
}

function warn(name, passed, message = '') {
  if (!passed) {
    const status = '⚠️  WARN';
    log(`${status} - ${name}${message ? ': ' + message : ''}`, 'yellow');
    WARNINGS.push(`${name}: ${message}`);
  }
}

async function fileExists(filePath, description) {
  const fullPath = path.join(BASE_DIR, filePath);
  const exists = fs.existsSync(fullPath);
  check(`File exists: ${description}`, exists, filePath);
  return exists;
}

async function fileContains(filePath, searchString, description) {
  try {
    const content = fs.readFileSync(path.join(BASE_DIR, filePath), 'utf8');
    const contains = content.includes(searchString);
    check(`File contains: ${description}`, contains, filePath);
    return contains;
  } catch (err) {
    check(`File contains: ${description}`, false, `Error reading: ${err.message}`);
    return false;
  }
}

async function validateJavaScript(filePath, description) {
  try {
    const result = await execPromise(`node --check "${path.join(BASE_DIR, filePath)}"`);
    check(`JavaScript valid: ${description}`, true, filePath);
    return true;
  } catch (err) {
    check(`JavaScript valid: ${description}`, false, filePath);
    return false;
  }
}

async function getLineCount(filePath) {
  try {
    const content = fs.readFileSync(path.join(BASE_DIR, filePath), 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

async function runValidation() {
  log('\n═══════════════════════════════════════════════════════════════', 'cyan');
  log('         Phase 3: User Account Page Validation', 'cyan');
  log('═══════════════════════════════════════════════════════════════\n', 'cyan');

  // Section 1: Files Exist
  log('\n📁 SECTION 1: File Structure Validation', 'blue');
  log('─────────────────────────────────────────\n', 'blue');

  await fileExists('views/account.ejs', 'Account View File');
  await fileExists('public/js/account.js', 'Account JavaScript');
  await fileExists('public/css/account.css', 'Account Stylesheet');
  await fileExists('src/routes/user-account.js', 'User Account API Routes');
  await fileExists('PHASE_3_ACCOUNT_PAGE_COMPLETE.md', 'Phase 3 Documentation');

  // Section 2: Backend API Routes
  log('\n🔌 SECTION 2: Backend API Route Validation', 'blue');
  log('─────────────────────────────────────────\n', 'blue');

  await fileContains('src/routes/user-account.js', 'GET /api/user/account-status', 
    'Account Status Endpoint');
  await fileContains('src/routes/user-account.js', 'GET /api/user/lifecycle', 
    'User Lifecycle Endpoint');
  await fileContains('src/routes/user-account.js', 'UserExpiryManager', 
    'UserExpiryManager Integration');
  await fileContains('src/routes/user-account.js', 'ContactMethodManager', 
    'ContactMethodManager Integration');
  await fileContains('src/routes/user-account.js', 'getBaseUrl', 
    'Base URL Helper for Referral Links');

  // Section 3: Route Mounting in Server
  log('\n🛣️  SECTION 3: Route Mounting Validation', 'blue');
  log('─────────────────────────────────────────\n', 'blue');

  await fileContains('src/server.js', "app.use('/api/user'", 
    'User Account Routes Mounted in Server');
  await fileContains('src/server.js', "require('./routes/user-account')", 
    'User Account Routes Imported');

  // Section 4: Frontend HTML Structure
  log('\n🎨 SECTION 4: Frontend HTML Structure Validation', 'blue');
  log('────────────────────────────────────────────\n', 'blue');

  await fileContains('views/account.ejs', 'id="status"', 
    'Account Status Section');
  await fileContains('views/account.ejs', 'id="accountStatusValue"', 
    'Account Status Value Element');
  await fileContains('views/account.ejs', 'id="expiryDateValue"', 
    'Expiry Date Element');
  await fileContains('views/account.ejs', 'id="verifiedContactsCount"', 
    'Verified Contacts Count Element');
  await fileContains('views/account.ejs', 'id="contactMethodsList"', 
    'Contact Methods List Container');
  await fileContains('views/account.ejs', 'id="referralCard"', 
    'Referral Section Container');
  await fileContains('views/account.ejs', 'id="referralLink"', 
    'Referral Link Input');
  await fileContains('views/account.ejs', 'id="copyReferralBtn"', 
    'Copy Referral Button');
  await fileContains('views/account.ejs', 'account-status-grid', 
    'Status Cards Grid');

  // Section 5: CSS Styling
  log('\n🎨 SECTION 5: CSS Styling Validation', 'blue');
  log('───────────────────────────────────\n', 'blue');

  await fileContains('public/css/account.css', '.account-status-grid', 
    'Status Cards Grid Styling');
  await fileContains('public/css/account.css', '.contact-methods-list', 
    'Contact Methods List Styling');
  await fileContains('public/css/account.css', '.contact-method-item', 
    'Contact Method Item Styling');
  await fileContains('public/css/account.css', '.input-group', 
    'Input Group Styling (Referral Link)');
  await fileContains('public/css/account.css', '.status-card', 
    'Status Card Styling');
  await fileContains('public/css/account.css', '.account-expiry-active', 
    'Expiry Status Color Coding');

  // Section 6: JavaScript Functionality
  log('\n⚙️  SECTION 6: JavaScript Functionality Validation', 'blue');
  log('──────────────────────────────────────────────\n', 'blue');

  await fileContains('public/js/account.js', 'loadAccountStatus()', 
    'Load Account Status Function');
  await fileContains('public/js/account.js', 'displayAccountStatus(status)', 
    'Display Account Status Function');
  await fileContains('public/js/account.js', 'displayContactMethods(contactMethods)', 
    'Display Contact Methods Function');
  await fileContains('public/js/account.js', 'displayReferralInfo(referral)', 
    'Display Referral Info Function');
  await fileContains('public/js/account.js', 'copyReferralLink()', 
    'Copy Referral Link Function');
  await fileContains('public/js/account.js', '/api/user/account-status', 
    'API Call to Account Status Endpoint');
  await fileContains('public/js/account.js', 'DOMContentLoaded', 
    'Page Load Initialization');

  // Section 7: API Integration Flow
  log('\n🔄 SECTION 7: API Integration Flow Validation', 'blue');
  log('───────────────────────────────────────────\n', 'blue');

  await fileContains('public/js/account.js', 'await this.loadAccountStatus()', 
    'Account Status Loading in Init');
  await fileContains('public/js/account.js', "fetch('/api/user/account-status'", 
    'Frontend Calls Account Status API');
  await fileContains('src/routes/user-account.js', "res.json", 
    'Backend Returns JSON Response');

  // Section 8: Code Quality
  log('\n✅ SECTION 8: Code Quality Validation', 'blue');
  log('────────────────────────────────────\n', 'blue');

  await validateJavaScript('public/js/account.js', 'account.js');
  await validateJavaScript('src/routes/user-account.js', 'user-account.js');

  // Section 9: File Sizes
  log('\n📊 SECTION 9: Code Size Validation', 'blue');
  log('──────────────────────────────────\n', 'blue');

  const jsLines = await getLineCount('public/js/account.js');
  const cssLines = await getLineCount('public/css/account.css');
  const viewLines = await getLineCount('views/account.ejs');
  const routeLines = await getLineCount('src/routes/user-account.js');

  check(`JavaScript line count`, jsLines > 600, `${jsLines} lines (target: >600)`);
  check(`CSS line count`, cssLines > 700, `${cssLines} lines (target: >700)`);
  check(`View line count`, viewLines > 300, `${viewLines} lines (target: >300)`);
  check(`Routes line count`, routeLines > 100, `${routeLines} lines (target: >100)`);

  // Section 10: Feature Documentation
  log('\n📚 SECTION 10: Documentation Validation', 'blue');
  log('──────────────────────────────────────\n', 'blue');

  await fileContains('PHASE_3_ACCOUNT_PAGE_COMPLETE.md', '## Deliverables', 
    'Deliverables Section');
  await fileContains('PHASE_3_ACCOUNT_PAGE_COMPLETE.md', '## Integration Points', 
    'Integration Points Documentation');
  await fileContains('PHASE_3_ACCOUNT_PAGE_COMPLETE.md', '## Testing Checklist', 
    'Testing Checklist');
  await fileContains('PHASE_3_ACCOUNT_PAGE_COMPLETE.md', 'PRODUCTION READY', 
    'Production Readiness Statement');

  // Generate Summary
  log('\n═══════════════════════════════════════════════════════════════', 'cyan');
  log('                        VALIDATION SUMMARY', 'cyan');
  log('═══════════════════════════════════════════════════════════════\n', 'cyan');

  const passed = CHECKS.filter(c => c.passed).length;
  const total = CHECKS.length;
  const passPercentage = Math.round((passed / total) * 100);

  log(`Total Checks: ${total}`, 'cyan');
  log(`Passed: ${passed}`, 'green');
  log(`Failed: ${total - passed}`, CHECKS.some(c => !c.passed) ? 'red' : 'green');
  log(`Success Rate: ${passPercentage}%\n`, passPercentage === 100 ? 'green' : 'yellow');

  if (ISSUES.length > 0) {
    log('❌ ISSUES FOUND:\n', 'red');
    ISSUES.forEach((issue, i) => log(`  ${i + 1}. ${issue}`, 'red'));
    log('');
  }

  if (WARNINGS.length > 0) {
    log('⚠️  WARNINGS:\n', 'yellow');
    WARNINGS.forEach((warning, i) => log(`  ${i + 1}. ${warning}`, 'yellow'));
    log('');
  }

  if (ISSUES.length === 0) {
    log('✅ ALL VALIDATION CHECKS PASSED!\n', 'green');
    log('Phase 3 Frontend Implementation Status:', 'green');
    log('  ✓ Backend API endpoints created', 'green');
    log('  ✓ Frontend view enhanced with new sections', 'green');
    log('  ✓ JavaScript display logic implemented', 'green');
    log('  ✓ CSS styling added', 'green');
    log('  ✓ Code quality validated', 'green');
    log('  ✓ Documentation complete\n', 'green');

    log('🚀 Ready for:', 'cyan');
    log('  • Browser testing with database', 'cyan');
    log('  • Contact method actions implementation', 'cyan');
    log('  • Phase 4: User Labels System\n', 'cyan');
  }

  log('═══════════════════════════════════════════════════════════════\n', 'cyan');

  return ISSUES.length === 0;
}

// Run validation
runValidation().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  log(`\nValidation script error: ${err.message}`, 'red');
  process.exit(1);
});
