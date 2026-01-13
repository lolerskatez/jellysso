#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Setting up Jellyfin Companion test environment...\n');

// Check if Docker is available
try {
  execSync('docker --version', { stdio: 'pipe' });
  console.log('✅ Docker is available');
} catch (error) {
  console.error('❌ Docker is not available. Please install Docker to run integration tests.');
  process.exit(1);
}

// Create test environment file
const envPath = path.join(__dirname, '.env.test');
if (!fs.existsSync(envPath)) {
  console.log('📝 Creating test environment file...');
  const envContent = `# Test Environment Configuration
NODE_ENV=development
JELLYFIN_BASE_URL=http://localhost:8096
PORT=3000
SESSION_SECRET=test-session-secret-for-development
JWT_SECRET=test-jwt-secret-for-development
SHARED_SECRET=test-shared-secret-for-plugin
HTTPS_PORT=3443

# OIDC Configuration
OIDC_ISSUER=http://localhost:3000
OIDC_CLIENT_ID=jellyfin-companion
OIDC_CLIENT_SECRET=companion-secret

# Logging
LOG_LEVEL=debug
`;
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Test environment file created');
}

// Install dependencies if needed
try {
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });
  console.log('✅ Dependencies installed');
} catch (error) {
  console.error('❌ Failed to install dependencies');
  process.exit(1);
}

console.log('\n🎯 Test environment setup complete!');
console.log('\nTo run tests:');
console.log('1. Start test environment: npm run docker:test');
console.log('2. Run unit tests: npm test');
console.log('3. Run integration tests: npm run test:integration');
console.log('4. Run all tests: npm run test:all');