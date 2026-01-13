/**
 * Admin OIDC SSO Configuration JavaScript
 * Handles OIDC settings management
 */

document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('oidcForm');
  const notification = document.getElementById('notification');
  const statusBadge = document.getElementById('oidcStatus');
  const testConnectionBtn = document.getElementById('testConnectionBtn');

  // Get CSRF token
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  // Show notification
  function showNotification(message, type = 'success') {
    if (notification) {
      notification.textContent = message;
      notification.className = `notification ${type} show`;
      setTimeout(() => {
        notification.classList.remove('show');
      }, 4000);
    }
  }

  // Update status badge
  function updateStatus(enabled) {
    if (statusBadge) {
      if (enabled) {
        statusBadge.className = 'status-badge enabled';
        statusBadge.innerHTML = '<i class="fas fa-circle"></i><span>Enabled</span>';
      } else {
        statusBadge.className = 'status-badge disabled';
        statusBadge.innerHTML = '<i class="fas fa-circle"></i><span>Disabled</span>';
      }
    }
  }

  // Load current settings
  async function loadSettings() {
    try {
      const response = await fetch('/admin/api/oidc/settings');
      const data = await response.json();

      if (data.success && data.settings) {
        const s = data.settings;
        document.getElementById('oidcEnabled').checked = s.enabled || false;
        document.getElementById('providerName').value = s.providerName || '';
        document.getElementById('issuerUrl').value = s.issuerUrl || '';
        document.getElementById('clientId').value = s.clientId || '';
        document.getElementById('clientSecret').value = s.clientSecret || '';
        document.getElementById('scopes').value = s.scopes || 'openid profile email';
        document.getElementById('autoCreateUsers').checked = s.autoCreateUsers || false;
        document.getElementById('usernameClaim').value = s.usernameClaim || 'preferred_username';
        document.getElementById('adminGroup').value = s.adminGroup || '';

        updateStatus(s.enabled);
      } else {
        updateStatus(false);
      }
    } catch (error) {
      console.error('Error loading OIDC settings:', error);
      updateStatus(false);
    }
  }

  // Save settings
  async function saveSettings(e) {
    e.preventDefault();

    const settings = {
      enabled: document.getElementById('oidcEnabled').checked,
      providerName: document.getElementById('providerName').value.trim(),
      issuerUrl: document.getElementById('issuerUrl').value.trim(),
      clientId: document.getElementById('clientId').value.trim(),
      clientSecret: document.getElementById('clientSecret').value,
      scopes: document.getElementById('scopes').value.trim() || 'openid profile email',
      autoCreateUsers: document.getElementById('autoCreateUsers').checked,
      usernameClaim: document.getElementById('usernameClaim').value.trim() || 'preferred_username',
      adminGroup: document.getElementById('adminGroup').value.trim()
    };

    // Validate required fields if enabled
    if (settings.enabled) {
      if (!settings.issuerUrl) {
        showNotification('Discovery URL is required', 'error');
        return;
      }
      if (!settings.clientId) {
        showNotification('Client ID is required', 'error');
        return;
      }
      if (!settings.clientSecret) {
        showNotification('Client Secret is required', 'error');
        return;
      }
    }

    try {
      const response = await fetch('/admin/api/oidc/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'csrf-token': getCsrfToken()
        },
        body: JSON.stringify(settings)
      });

      const data = await response.json();

      if (data.success) {
        showNotification('OIDC settings saved successfully', 'success');
        updateStatus(settings.enabled);
      } else {
        showNotification(data.message || 'Failed to save settings', 'error');
      }
    } catch (error) {
      console.error('Error saving OIDC settings:', error);
      showNotification('Failed to save settings', 'error');
    }
  }

  // Test connection
  async function testConnection() {
    const issuerUrl = document.getElementById('issuerUrl').value.trim();

    if (!issuerUrl) {
      showNotification('Please enter a Discovery URL first', 'error');
      return;
    }

    testConnectionBtn.disabled = true;
    testConnectionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

    try {
      const response = await fetch('/admin/api/oidc/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'csrf-token': getCsrfToken()
        },
        body: JSON.stringify({ issuerUrl })
      });

      const data = await response.json();

      if (data.success) {
        showNotification('Connection successful! Provider: ' + (data.issuer || 'Unknown'), 'success');
      } else {
        showNotification(data.message || 'Connection failed', 'error');
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      showNotification('Connection test failed', 'error');
    } finally {
      testConnectionBtn.disabled = false;
      testConnectionBtn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
    }
  }

  // Event listeners
  if (form) {
    form.addEventListener('submit', saveSettings);
  }

  if (testConnectionBtn) {
    testConnectionBtn.addEventListener('click', testConnection);
  }

  // Update status when toggle changes
  const enabledToggle = document.getElementById('oidcEnabled');
  if (enabledToggle) {
    enabledToggle.addEventListener('change', function() {
      // Visual feedback only - actual status updates on save
    });
  }

  // Load settings on page load
  loadSettings();
});

// Copy to clipboard helper
function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    const text = element.textContent;
    navigator.clipboard.writeText(text).then(() => {
      // Show brief feedback
      const btn = element.parentElement.querySelector('button');
      if (btn) {
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
          btn.innerHTML = originalIcon;
        }, 1500);
      }
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }
}
