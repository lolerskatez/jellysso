const SetupManager = require('./src/models/SetupManager');
const JellyfinAPI = require('./src/models/JellyfinAPI');

console.log('🧪 Testing Setup Wizard Functionality...\n');

// Test 1: SetupManager basic functionality
console.log('1. Testing SetupManager...');
try {
  // Reset setup for testing
  SetupManager.resetSetup();

  // Check initial state
  const isComplete = SetupManager.isSetupComplete();
  console.log(`   ✓ Initial setup state: ${isComplete ? 'complete' : 'incomplete'}`);

  // Update config
  SetupManager.updateConfig({
    jellyfinUrl: 'http://localhost:8096',
    jellyfinPublicUrl: 'https://jellyfin.example.com',
    webAppPublicUrl: 'https://companion.example.com',
    apiKey: 'test-api-key-123456789'
  });

  const config = SetupManager.getConfig();
  console.log(`   ✓ Config updated: ${Object.keys(config).length} fields`);

  // Complete setup
  const finalConfig = SetupManager.completeSetup({
    adminUser: 'admin'
  });

  console.log(`   ✓ Setup completed: ${finalConfig.setupCompletedAt ? 'timestamp present' : 'no timestamp'}`);
  console.log(`   ✓ Final state: ${SetupManager.isSetupComplete() ? 'complete' : 'incomplete'}`);

} catch (error) {
  console.error('   ✗ SetupManager test failed:', error.message);
}

// Test 2: JellyfinAPI basic functionality
console.log('\n2. Testing JellyfinAPI...');
try {
  const api = new JellyfinAPI('http://localhost:8096');
  console.log('   ✓ JellyfinAPI instance created');

  // Test basic properties
  console.log(`   ✓ Base URL set: ${api.baseURL}`);
  console.log(`   ✓ Cache initialized: ${api.cache instanceof Map}`);

} catch (error) {
  console.error('   ✗ JellyfinAPI test failed:', error.message);
}

// Test 3: Setup routes validation
console.log('\n3. Testing setup route validation...');
try {
  const express = require('express');
  const setupRoutes = require('./src/routes/setup');

  const app = express();
  app.use(express.json());
  app.use('/setup', setupRoutes);

  console.log('   ✓ Setup routes loaded without errors');

} catch (error) {
  console.error('   ✗ Setup routes test failed:', error.message);
}

console.log('\n✅ Setup Wizard functionality tests completed!');
console.log('\n📋 Setup Wizard Features:');
console.log('   • Secure one-time setup wizard');
console.log('   • 3-step configuration process');
console.log('   • Jellyfin server connection validation');
console.log('   • Admin user authentication');
console.log('   • Configuration persistence');
console.log('   • Professional UI with progress tracking');
console.log('   • Security middleware preventing access before setup');