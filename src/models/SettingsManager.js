const fs = require('fs');
const path = require('path');

class SettingsManager {
  constructor() {
    this.settingsFile = path.join(__dirname, '../config/settings.json');
    this.ensureSettingsFile();
  }

  ensureSettingsFile() {
    if (!fs.existsSync(path.dirname(this.settingsFile))) {
      fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    }

    if (!fs.existsSync(this.settingsFile)) {
      const defaultSettings = {
        theme: 'light',
        language: 'en',
        notifications: true,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.settingsFile, JSON.stringify(defaultSettings, null, 2));
    }
  }

  getSettings() {
    try {
      const data = fs.readFileSync(this.settingsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading settings:', error);
      return this.getDefaultSettings();
    }
  }

  updateSettings(updates) {
    try {
      const currentSettings = this.getSettings();
      const newSettings = {
        ...currentSettings,
        ...updates,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.settingsFile, JSON.stringify(newSettings, null, 2));
      return newSettings;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw new Error(`Failed to update settings: ${error.message}`);
    }
  }

  resetSettings() {
    try {
      const defaultSettings = this.getDefaultSettings();
      fs.writeFileSync(this.settingsFile, JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    } catch (error) {
      console.error('Error resetting settings:', error);
      throw new Error(`Failed to reset settings: ${error.message}`);
    }
  }

  getDefaultSettings() {
    return {
      theme: 'light',
      language: 'en',
      notifications: true,
      updatedAt: new Date().toISOString()
    };
  }
}

module.exports = new SettingsManager();
