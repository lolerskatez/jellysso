/**
 * Plugin Management Admin Page
 * Handles plugin configuration, testing, and log management
 */

document.addEventListener('DOMContentLoaded', async function() {
  // Get config from data attribute
  const configElement = document.getElementById('pluginConfig');
  const config = configElement ? JSON.parse(configElement.dataset.pluginConfig) : {};

  // DOM Elements
  const pluginForm = document.getElementById('pluginForm');
  const appUrlInput = document.getElementById('appUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const pluginEnabledInput = document.getElementById('pluginEnabled');
  const validateSessionsInput = document.getElementById('validateSessions');
  const sessionTimeoutInput = document.getElementById('sessionTimeout');
  const testConnectionBtn = document.getElementById('testConnectionBtn');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const downloadPluginBtn = document.getElementById('downloadPluginBtn');
  const logsContainer = document.getElementById('logsContainer');
  const notification = document.getElementById('notification');
  const pluginStatus = document.getElementById('pluginStatus');
  const ssoPluginStatus = document.getElementById('ssoPluginStatus');
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const toggleSecretBtn = document.getElementById('toggleSecretBtn');
  const generateSecretBtn = document.getElementById('generateSecretBtn');
  const sharedSecretDisplay = document.getElementById('sharedSecretDisplay');
  const sharedSecretValue = document.getElementById('sharedSecretValue');

  let currentSharedSecret = '';

  /**
   * Copy text to clipboard
   */
  window.copyToClipboard = function(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    
    navigator.clipboard.writeText(text).then(() => {
      showNotification('Copied to clipboard', 'success');
    }).catch(() => {
      showNotification('Failed to copy', 'error');
    });
  };

  /**
   * Generate random secret
   */
  function generateSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let secret = '';
    for (let i = 0; i < 32; i++) {
      secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
  }

  /**
   * Show notification toast
   */
  function showNotification(message, type = 'success') {
    notification.textContent = message;
    notification.className = `notification show ${type}`;
    setTimeout(() => {
      notification.classList.remove('show');
    }, 4000);
  }

  /**
   * Tab switching
   */
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      
      // Hide all tabs
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      
      // Remove active class from all buttons
      document.querySelectorAll('.tab-button').forEach(tabBtn => {
        tabBtn.classList.remove('active');
      });
      
      // Show selected tab and mark button as active
      document.getElementById(`tab-${tabName}`).classList.add('active');
      this.classList.add('active');
    });
  });

  /**
   * Toggle password visibility
   */
  document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const isPassword = input.type === 'password';
      
      input.type = isPassword ? 'text' : 'password';
      this.innerHTML = isPassword ? 
        '<i class="fas fa-eye-slash"></i>' : 
        '<i class="fas fa-eye"></i>';
    });
  });

  /**
   * Toggle secret visibility
   */
  if (toggleSecretBtn) {
    toggleSecretBtn.addEventListener('click', function() {
      const isHidden = sharedSecretDisplay.textContent.includes('••••');
      
      if (isHidden && currentSharedSecret) {
        sharedSecretDisplay.textContent = currentSharedSecret;
        sharedSecretValue.textContent = currentSharedSecret;
        toggleSecretBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
      } else {
        sharedSecretDisplay.textContent = '••••••••••••••••';
        toggleSecretBtn.innerHTML = '<i class="fas fa-eye"></i>';
      }
    });
  }

  /**
   * Generate new secret
   */
  if (generateSecretBtn) {
    generateSecretBtn.addEventListener('click', async function() {
      if (!confirm('Generate a new shared secret? The old secret will no longer work.')) {
        return;
      }

      try {
        const newSecret = generateSecret();
        
        // Save to configuration
        const response = await fetch('/admin/api/plugins/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: pluginEnabledInput.checked,
            appUrl: appUrlInput.value,
            apiKey: newSecret,
            validateSessions: validateSessionsInput.checked,
            sessionTimeout: parseInt(sessionTimeoutInput.value)
          })
        });

        const data = await response.json();
        if (data.success) {
          currentSharedSecret = newSecret;
          sharedSecretDisplay.textContent = newSecret;
          sharedSecretValue.textContent = newSecret;
          apiKeyInput.value = newSecret;
          toggleSecretBtn.innerHTML = '<i class="fas fa-eye-slash"></i>';
          showNotification('New secret generated successfully', 'success');
        } else {
          showNotification('Failed to generate secret', 'error');
        }
      } catch (error) {
        showNotification('Error generating secret: ' + error.message, 'error');
      }
    });
  }

  /**
   * Save configuration
   */
  pluginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    try {
      const submitBtn = pluginForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      const response = await fetch('/admin/api/plugins/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: pluginEnabledInput.checked,
          appUrl: appUrlInput.value,
          apiKey: apiKeyInput.value,
          validateSessions: validateSessionsInput.checked,
          sessionTimeout: parseInt(sessionTimeoutInput.value)
        })
      });

      const data = await response.json();
      if (data.success) {
        showNotification('Configuration saved successfully', 'success');
      } else {
        showNotification(data.message || 'Error saving configuration', 'error');
      }
    } catch (error) {
      showNotification('Error saving configuration: ' + error.message, 'error');
    } finally {
      const submitBtn = pluginForm.querySelector('button[type="submit"]');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Configuration';
    }
  });

  /**
   * Test connection
   */
  testConnectionBtn.addEventListener('click', async function() {
    try {
      testConnectionBtn.disabled = true;
      testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
      
      const response = await fetch('/admin/api/plugins/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appUrl: appUrlInput.value,
          apiKey: apiKeyInput.value
        })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('Connection test successful', 'success');
      } else {
        showNotification(data.message || 'Connection test failed', 'error');
      }
    } catch (error) {
      showNotification('Connection test error: ' + error.message, 'error');
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionBtn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }
  });

  /**
   * Download plugin
   */
  downloadPluginBtn.addEventListener('click', function() {
    try {
      downloadPluginBtn.disabled = true;
      downloadPluginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
      window.location.href = '/admin/api/plugin/download';
      
      // Re-enable button after a brief delay in case download fails
      setTimeout(() => {
        downloadPluginBtn.disabled = false;
        downloadPluginBtn.innerHTML = '<i class="fas fa-download"></i> Download Plugin (DLL)';
      }, 2000);
    } catch (error) {
      showNotification('Error downloading plugin: ' + error.message, 'error');
      downloadPluginBtn.disabled = false;
      downloadPluginBtn.innerHTML = '<i class="fas fa-download"></i> Download Plugin (DLL)';
    }
  });

  /**
   * Load and display logs
   */
  async function loadLogs() {
    try {
      const response = await fetch('/admin/api/plugins/logs');
      const data = await response.json();
      
      if (data.logs && data.logs.length > 0) {
        logsContainer.innerHTML = data.logs.map(log => {
          const timestamp = new Date(log.timestamp).toLocaleString();
          const message = escapeHtml(log.message || log.type);
          return `<div>[${timestamp}] ${message}</div>`;
        }).join('');
      } else {
        logsContainer.innerHTML = '<div class="logs-empty">No logs available</div>';
      }
    } catch (error) {
      logsContainer.innerHTML = `<div class="logs-empty" style="color: var(--danger);">Error loading logs: ${error.message}</div>`;
    }
  }

  /**
   * Clear logs
   */
  clearLogsBtn.addEventListener('click', async function() {
    if (confirm('Are you sure you want to clear all SSO validation logs?')) {
      try {
        clearLogsBtn.disabled = true;
        clearLogsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

        const response = await fetch('/admin/api/plugins/logs', { method: 'DELETE' });
        const data = await response.json();
        
        if (data.success) {
          loadLogs();
          showNotification('Logs cleared successfully', 'success');
        } else {
          showNotification(data.message || 'Error clearing logs', 'error');
        }
      } catch (error) {
        showNotification('Error clearing logs: ' + error.message, 'error');
      } finally {
        clearLogsBtn.disabled = false;
        clearLogsBtn.innerHTML = '<i class="fas fa-trash"></i> Clear Logs';
      }
    }
  });

  /**
   * Check plugin installation status
   */
  async function checkPluginStatus() {
    try {
      const response = await fetch('/admin/api/plugins/status');
      const data = await response.json();
      
      if (data.installed) {
        ssoPluginStatus.className = 'status-badge installed';
        ssoPluginStatus.innerHTML = '<i class="fas fa-check-circle"></i> Installed';
        pluginStatus.className = 'status-badge installed';
        pluginStatus.innerHTML = '<i class="fas fa-check-circle"></i> Installed';
        
        if (data.version) {
          document.getElementById('pluginVersion').textContent = data.version;
        }
        if (data.lastUpdated) {
          document.getElementById('pluginUpdated').textContent = new Date(data.lastUpdated).toLocaleDateString();
        }
      } else {
        ssoPluginStatus.className = 'status-badge not-installed';
        ssoPluginStatus.innerHTML = '<i class="fas fa-times-circle"></i> Not Installed';
        pluginStatus.className = 'status-badge not-installed';
        pluginStatus.innerHTML = '<i class="fas fa-times-circle"></i> Not Installed';
      }
    } catch (error) {
      ssoPluginStatus.className = 'status-badge not-installed';
      ssoPluginStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i> Error';
    }
  }

  /**
   * Load initial configuration
   */
  async function loadConfiguration() {
    try {
      const response = await fetch('/admin/api/plugins/config');
      const data = await response.json();
      
      if (data.config) {
        const cfg = data.config;
        if (cfg.enabled !== undefined) pluginEnabledInput.checked = cfg.enabled;
        if (cfg.appUrl) appUrlInput.value = cfg.appUrl;
        if (cfg.apiKey) {
          apiKeyInput.value = cfg.apiKey;
          currentSharedSecret = cfg.apiKey;
          sharedSecretValue.textContent = cfg.apiKey;
        }
        if (cfg.validateSessions !== undefined) validateSessionsInput.checked = cfg.validateSessions;
        if (cfg.sessionTimeout) sessionTimeoutInput.value = cfg.sessionTimeout;
      }
    } catch (error) {
      console.error('Error loading configuration:', error);
    }
  }

  /**
   * Mobile menu toggle
   */
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', function() {
      document.querySelector('nav').classList.toggle('mobile-open');
    });
  }

  /**
   * Utility: Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Initialize page
   */
  checkPluginStatus();
  loadConfiguration();
  loadLogs();

  /**
   * Refresh status and logs every 30 seconds
   */
  setInterval(checkPluginStatus, 30000);
  setInterval(loadLogs, 30000);
});
