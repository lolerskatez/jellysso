const fs = require('fs');
const path = require('path');
const os = require('os');

// On non-Windows, restrict config file permissions to owner-only
function lockFilePermissions(filePath) {
  if (os.platform() !== 'win32') {
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  }
}

class SetupManager {
  constructor() {
    this.setupFile = path.join(__dirname, '../config/setup.json');
    this.ensureSetupFile();
  }

  ensureSetupFile() {
    if (!fs.existsSync(path.dirname(this.setupFile))) {
      fs.mkdirSync(path.dirname(this.setupFile), { recursive: true });
    }

    if (!fs.existsSync(this.setupFile)) {
      const defaultConfig = {
        isSetupComplete: false,
        jellyfinUrl: '',
        jellyfinPublicUrl: '',
        webAppPublicUrl: '',
        apiKey: '',
        adminUser: '',
        setupCompletedAt: null
      };
      fs.writeFileSync(this.setupFile, JSON.stringify(defaultConfig, null, 2));
      lockFilePermissions(this.setupFile);
    }
  }

  getConfig() {
    try {
      const data = fs.readFileSync(this.setupFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading setup config:', error);
      return { isSetupComplete: false };
    }
  }

  updateConfig(updates) {
    const currentConfig = this.getConfig();
    const newConfig = { ...currentConfig, ...updates };
    fs.writeFileSync(this.setupFile, JSON.stringify(newConfig, null, 2));
    lockFilePermissions(this.setupFile);
    return newConfig;
  }

  isSetupComplete() {
    return this.getConfig().isSetupComplete;
  }

  completeSetup(config) {
    const currentConfig = this.getConfig();

    // Use the provided API key from config, don't generate a new one
    // Only generate if explicitly not provided (backwards compatibility)
    let apiKey = config.apiKey || currentConfig.apiKey;
    if (!apiKey) {
      console.warn('⚠️  No API key provided. Generating a random one (this will NOT work with Jellyfin)');
      const crypto = require('crypto');
      apiKey = crypto.randomBytes(32).toString('hex');
    }

    const setupConfig = {
      ...config,
      apiKey: apiKey,
      isSetupComplete: true,
      setupCompletedAt: new Date().toISOString()
    };
    this.updateConfig(setupConfig);
    return setupConfig;
  }

  resetSetup() {
    // For development/testing only
    const defaultConfig = {
      isSetupComplete: false,
      jellyfinUrl: '',
      jellyfinPublicUrl: '',
      webAppPublicUrl: '',
      apiKey: '',
      adminUser: '',
      setupCompletedAt: null
    };
    fs.writeFileSync(this.setupFile, JSON.stringify(defaultConfig, null, 2));
    lockFilePermissions(this.setupFile);
  }
}

module.exports = new SetupManager();