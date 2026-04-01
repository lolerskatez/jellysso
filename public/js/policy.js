/**
 * Policy Management Client - User Side
 * Handles UI interactions for user policy settings
 */

let csrfToken = null;

/**
 * Get CSRF token
 */
async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  
  try {
    const response = await fetch('/api/csrf-token');
    const data = await response.json();
    csrfToken = data.csrf_token;
    return csrfToken;
  } catch (error) {
    console.error('Failed to get CSRF token:', error);
    showStatus('Failed to get security token', 'error');
    return null;
  }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  const msgEl = document.getElementById('statusMsg');
  msgEl.textContent = message;
  msgEl.className = `status-msg ${type}`;
  
  // Auto-hide after 5 seconds for success messages
  if (type === 'success') {
    setTimeout(() => {
      msgEl.className = 'status-msg';
    }, 5000);
  }
}

/**
 * Load user policy settings
 */
async function loadUserPolicy() {
  try {
    const response = await fetch('/api/policy/user/policy');
    const data = await response.json();
    
    if (!data.success) {
      showStatus('Failed to load policy: ' + data.message, 'error');
      return;
    }

    const policy = data.policy;
    
    // Update tier display
    document.getElementById('tierBadge').textContent = (policy.tier || 'unknown').toUpperCase();
    document.getElementById('tierName').textContent = 
      (policy.tier || 'unknown').charAt(0).toUpperCase() + (policy.tier || 'unknown').slice(1);
    document.getElementById('maxStreams').textContent = policy.maxConcurrentStreams || 'N/A';
    
    // Update description
    const descriptions = {
      'single': 'Perfect for personal use',
      'standard': 'Great for individuals and small groups',
      'unlimited': 'Unlimited streaming for everyone',
      'admin': 'Administrator access with unlimited streams'
    };
    document.getElementById('tierDescription').textContent = 
      descriptions[policy.tier] || 'Your subscription plan';
    
    // Update device whitelist toggle
    document.getElementById('deviceWhitelistToggle').checked = 
      policy.deviceWhitelistEnabled === true;
    
  } catch (error) {
    console.error('Error loading policy:', error);
    showStatus('Failed to load policy settings', 'error');
  }
}

/**
 * Toggle device whitelist enforcement
 */
document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.getElementById('deviceWhitelistToggle');
  if (toggle) {
    toggle.addEventListener('change', async function() {
      await toggleDeviceWhitelist(this.checked);
    });
  }
});

async function toggleDeviceWhitelist(enabled) {
  try {
    const token = await getCsrfToken();
    if (!token) return;

    const response = await fetch('/api/policy/user/device-whitelist/enable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify({ enabled })
    });

    const data = await response.json();
    
    if (data.success) {
      showStatus(
        `Device whitelist ${enabled ? 'enabled' : 'disabled'}`,
        'success'
      );
    } else {
      showStatus('Failed to update device whitelist: ' + data.message, 'error');
      // Revert toggle
      document.getElementById('deviceWhitelistToggle').checked = !enabled;
    }
  } catch (error) {
    console.error('Error toggling device whitelist:', error);
    showStatus('Failed to update setting', 'error');
    document.getElementById('deviceWhitelistToggle').checked = !enabled;
  }
}

/**
 * Load whitelisted devices
 */
async function loadWhitelistedDevices() {
  try {
    const response = await fetch('/api/policy/user/policy');
    const data = await response.json();
    
    if (!data.success) {
      document.getElementById('deviceList').innerHTML = 
        '<div class="empty-state"><i class="fas fa-exclamation"></i><p>Failed to load devices</p></div>';
      return;
    }

    const devices = data.whitelistedDevices || [];
    const listEl = document.getElementById('deviceList');
    
    if (devices.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-microchip"></i>
          <p>No whitelisted devices yet</p>
          <p style="font-size: 12px;">Add your current device to get started</p>
        </div>
      `;
      return;
    }

    // Build device list
    let html = '<ul class="device-list">';
    devices.forEach(device => {
      const addedDate = new Date(device.whitelistedAt).toLocaleDateString();
      const typeIcon = getDeviceTypeIcon(device.deviceType);
      
      html += `
        <li class="device-item">
          <div class="device-info">
            <div class="device-name">
              ${typeIcon} ${device.deviceName || 'Unknown Device'}
              <span class="device-type">${device.deviceType}</span>
            </div>
            <div class="device-date">Added on ${addedDate}</div>
          </div>
          <div class="device-actions">
            <button class="btn-remove" onclick="removeDevice('${device.deviceId}')">
              <i class="fas fa-trash"></i> Remove
            </button>
          </div>
        </li>
      `;
    });
    html += '</ul>';
    
    listEl.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading devices:', error);
    document.getElementById('deviceList').innerHTML = 
      '<div class="empty-state"><i class="fas fa-exclamation"></i><p>Failed to load devices</p></div>';
  }
}

/**
 * Get device type icon
 */
function getDeviceTypeIcon(type) {
  const icons = {
    'web': '<i class="fas fa-globe"></i>',
    'mobile': '<i class="fas fa-mobile-alt"></i>',
    'tv': '<i class="fas fa-tv"></i>',
    'desktop': '<i class="fas fa-desktop"></i>'
  };
  return icons[type] || '<i class="fas fa-microchip"></i>';
}

/**
 * Add device to whitelist
 */
async function addDevice() {
  try {
    const deviceName = document.getElementById('deviceName').value;
    const deviceType = document.getElementById('deviceType').value;
    const currentDevice = document.getElementById('currentDevice').value;
    
    // Validate
    if (!deviceName.trim()) {
      showStatus('Please enter a device name', 'error');
      return;
    }

    const token = await getCsrfToken();
    if (!token) return;

    // Generate or use selected device ID
    const deviceId = currentDevice || 'device-' + Date.now();

    const response = await fetch('/api/policy/user/device/whitelist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify({
        deviceId,
        deviceName,
        deviceType
      })
    });

    const data = await response.json();
    
    if (data.success) {
      showStatus(`Device "${deviceName}" added to whitelist!`, 'success');
      
      // Clear form
      document.getElementById('deviceName').value = '';
      document.getElementById('deviceType').value = 'web';
      document.getElementById('currentDevice').value = '';
      
      // Refresh device list
      loadWhitelistedDevices();
    } else {
      showStatus('Failed to add device: ' + data.message, 'error');
    }
    
  } catch (error) {
    console.error('Error adding device:', error);
    showStatus('Failed to add device', 'error');
  }
}

/**
 * Remove device from whitelist
 */
async function removeDevice(deviceId) {
  if (!confirm('Remove this device from your whitelist?')) {
    return;
  }

  try {
    const response = await fetch(`/api/policy/user/device/whitelist/${deviceId}`, {
      method: 'DELETE'
    });

    const data = await response.json();
    
    if (data.success) {
      showStatus('Device removed from whitelist', 'success');
      loadWhitelistedDevices();
    } else {
      showStatus('Failed to remove device', 'error');
    }
    
  } catch (error) {
    console.error('Error removing device:', error);
    showStatus('Failed to remove device', 'error');
  }
}

/**
 * Load audit log
 */
async function loadAuditLog() {
  try {
    const response = await fetch('/api/policy/user/audit-log?limit=20');
    const data = await response.json();
    
    if (!data.success) {
      document.getElementById('auditLog').innerHTML = 
        '<div class="empty-state"><i class="fas fa-exclamation"></i><p>Failed to load audit log</p></div>';
      return;
    }

    const logs = data.logs || [];
    const logEl = document.getElementById('auditLog');
    
    if (logs.length === 0) {
      logEl.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-history"></i>
          <p>No activity yet</p>
        </div>
      `;
      return;
    }

    // Build audit log
    let html = '';
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      const timeStr = date.toLocaleString();
      const actionDisplay = formatAction(log.action);
      
      html += `
        <div class="audit-entry">
          <div>
            <div class="audit-type">
              ${formatPolicyType(log.type)}: ${actionDisplay}
            </div>
            <div class="audit-time">${timeStr}</div>
          </div>
          <div style="color: var(--text-muted); font-size: 12px;">
            ${log.reason ? log.reason : 'User action'}
          </div>
        </div>
      `;
    });
    
    logEl.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading audit log:', error);
    document.getElementById('auditLog').innerHTML = 
      '<div class="empty-state"><i class="fas fa-exclamation"></i><p>Failed to load activity</p></div>';
  }
}

/**
 * Refresh audit log
 */
async function refreshAuditLog() {
  loadAuditLog();
}

/**
 * Format policy type for display
 */
function formatPolicyType(type) {
  const types = {
    'TIER': 'Subscription Tier',
    'DEVICE': 'Device Whitelist',
    'SCHEDULE': 'Access Schedule',
    'ACCESS': 'Access Check'
  };
  return types[type] || type;
}

/**
 * Format action for display
 */
function formatAction(action) {
  const actions = {
    'upgraded': 'Upgraded',
    'downgraded': 'Downgraded',
    'added': 'Added',
    'removed': 'Removed',
    'enabled': 'Enabled',
    'disabled': 'Disabled',
    'checked': 'Checked',
    'whitelisted': 'Whitelisted',
    'device_added': 'Device Added',
    'device_removed': 'Device Removed'
  };
  return actions[action] || action;
}

/**
 * Get current user ID (from page or session)
 */
function getCurrentUserId() {
  // Try to get from page element
  const userEl = document.getElementById('currentUserId');
  if (userEl) return userEl.value;
  
  // Try to get from data attribute
  const container = document.querySelector('.policy-container');
  if (container && container.dataset.userId) return container.dataset.userId;
  
  // This shouldn't happen in production
  console.warn('Could not determine user ID');
  return null;
}

// Page initialization
document.addEventListener('DOMContentLoaded', function() {
  loadUserPolicy();
  loadWhitelistedDevices();
  loadAuditLog();

  document.getElementById('addDeviceBtn')?.addEventListener('click', addDevice);
  document.getElementById('refreshAuditLogBtn')?.addEventListener('click', refreshAuditLog);
});
