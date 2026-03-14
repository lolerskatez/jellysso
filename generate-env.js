#!/usr/bin/env node
/**
 * generate-env.js
 * Generates a .env file from .env.example with random secrets pre-filled.
 * Run once before starting JellySSO: node generate-env.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const examplePath = path.join(__dirname, '.env.example');
const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  console.log('⚠️  .env already exists — not overwriting.');
  console.log('    Delete it first if you want to regenerate secrets.');
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('❌ .env.example not found.');
  process.exit(1);
}

const SECRET_KEYS = ['SESSION_SECRET', 'SHARED_SECRET', 'COOKIE_SECRET'];

let contents = fs.readFileSync(examplePath, 'utf8');

for (const key of SECRET_KEYS) {
  const secret = crypto.randomBytes(32).toString('hex');
  // Replace lines like "KEY=" or "KEY= " with "KEY=<generated>"
  contents = contents.replace(
    new RegExp(`^(${key}=)\\s*$`, 'm'),
    `$1${secret}`
  );
}

fs.writeFileSync(envPath, contents, 'utf8');

console.log('✅ .env created with generated secrets:');
for (const key of SECRET_KEYS) {
  console.log(`   ${key} — generated`);
}
console.log('');
console.log('Next steps:');
console.log('  1. Review .env and set APP_PORT / PUBLIC_URL if needed');
console.log('  2. Run: docker-compose up -d');
console.log('  3. Open http://localhost:3010/setup to configure Jellyfin connection');
