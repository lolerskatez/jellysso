/**
 * Admin Policy Management Client
 * Handles UI interactions for admin policy management
 */

let csrfToken = null;
let currentEditingUserId = null;
let policiesCache = [];

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
 * Load all policies
 */
async function loadPolicies() {
  try {
    const response = await fetch('/api/policy/admin/policies');
    const data = await response.json();
    
    if (!data.success) {
      showStatus('Failed to load policies: ' + data.message, 'error');
      document.getElementById('policiesTableBody').innerHTML = `
        <tr>
          <td colspan="8" class="error-message">Failed to load policies</td>
        </tr>
      `;
      return;
    }

    policiesCache = data.policies || [];
    renderPoliciesTable(policiesCache);
    
  } catch (error) {
    console.error('Error loading policies:', error);
    showStatus('Failed to load policies', 'error');
  }
}

/**
 * Render policies table
 */
function renderPoliciesTable(policies) {
  const tbody = document.getElementById('policiesTableBody');
  const emptyState = document.getElementById('emptyState');
  
  if (!policies || policies.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  
  let html = '';
  policies.forEach(policy => {
    const updatedDate = new Date(policy.updatedAt).toLocaleDateString();
    
    html += `
      <tr>
        <td class="user-id">${escapeHtml(policy.userId.substring(0, 16))}${policy.userId.length > 16 ? '...' : ''}</td>
        <td>
          <span class="tier-badge tier-${policy.tier}">
            ${policy.tier.toUpperCase()}
          </span>
        </td>
        <td>${policy.maxConcurrentStreams}</td>
        <td>
          ${policy.deviceWhitelistEnabled ? 
            '<i class="fas fa-check" style="color: #27ae60;"></i>' : 
            '<i class="fas fa-times" style="color: #e74c3c;"></i>'}
        </td>
        <td>
          ${policy.enforceAccessSchedule ? 
            '<i class="fas fa-check" style="color: #27ae60;"></i>' : 
            '<i class="fas fa-times" style="color: #e74c3c;"></i>'}
        </td>
        <td>${policy.whitelistedDeviceCount || 0}</td>
        <td style="font-size: 12px; color: var(--text-muted);">${updatedDate}</td>
        <td>
          <div class="actions-cell">
            <button class="btn-sm btn-edit" onclick="openEditModal('${escapeHtml(policy.userId)}')">
              <i class="fas fa-edit"></i> Edit
            </button>
            <button class="btn-sm btn-audit" onclick="openAuditModal('${escapeHtml(policy.userId)}')">
              <i class="fas fa-history"></i> Audit
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  
  tbody.innerHTML = html;
}

/**
 * Search policies
 */
async function searchPolicies() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  
  if (!searchTerm.trim()) {
    renderPoliciesTable(policiesCache);
    return;
  }

  const filtered = policiesCache.filter(policy =>
    policy.userId.toLowerCase().includes(searchTerm)
  );

  renderPoliciesTable(filtered);
}

/**
 * Refresh policies
 */
async function refreshPolicies() {
  loadPolicies();
  showStatus('Policies refreshed', 'success');
}

/**
 * Open edit modal
 */
async function openEditModal(userId) {
  try {
    currentEditingUserId = userId;
    
    // Get policy details
    const response = await fetch('/api/policy/admin/policies');
    const data = await response.json();
    
    if (!data.success) {
      showStatus('Failed to load policy', 'error');
      return;
    }

    const policy = data.policies.find(p => p.userId === userId);
    if (!policy) {
      showStatus('Policy not found', 'error');
      return;
    }

    // Get devices
    const devResponse = await fetch(`/api/policy/admin/user/${userId}/audit-log?limit=0`);
    const devData = await devResponse.json();
    
    // Populate modal
    document.getElementById('editUserId').value = userId;
    document.getElementById('editTier').value = policy.tier;
    document.getElementById('editMaxStreams').value = policy.maxConcurrentStreams;
    document.getElementById('editDeviceWL').checked = policy.deviceWhitelistEnabled;
    document.getElementById('editSchedule').checked = policy.enforceAccessSchedule;
    
    // Load devices for this user
    loadUserDevices(userId);
    
    // Show modal
    document.getElementById('editModal').classList.add('show');
    
  } catch (error) {
    console.error('Error opening modal:', error);
    showStatus('Failed to open edit modal', 'error');
  }
}

/**
 * Close modal
 */
function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
  currentEditingUserId = null;
}

/**
 * Close modal when clicking outside
 */
document.addEventListener('click', function(event) {
  const editModal = document.getElementById('editModal');
  const auditModal = document.getElementById('auditModal');
  
  if (event.target === editModal) {
    closeModal('editModal');
  }
  
  if (event.target === auditModal) {
    closeModal('auditModal');
  }
});

/**
 * Update max streams when tier changes
 */
function updateMaxStreams() {
  const tier = document.getElementById('editTier').value;
  const tierMaxStreams = {
    'free': 1,
    'standard': 2,
    'premium': 4,
    'family': 6
  };
  
  document.getElementById('editMaxStreams').value = tierMaxStreams[tier] || 2;
}

/**
 * Save policy changes
 */
async function savePolicyChanges(event) {
  event.preventDefault();
  
  try {
    const userId = document.getElementById('editUserId').value;
    const tier = document.getElementById('editTier').value;
    const token = await getCsrfToken();
    
    if (!token) return;

    // Save tier change
    const tierResponse = await fetch(`/api/policy/admin/user/${userId}/tier`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify({ tier })
    });

    const tierData = await tierResponse.json();
    if (!tierData.success) {
      showStatus('Failed to update tier: ' + tierData.message, 'error');
      return;
    }

    // Save device whitelist setting
    const deviceWLEnabled = document.getElementById('editDeviceWL').checked;
    const dwlResponse = await fetch(`/api/policy/admin/user/${userId}/device-whitelist/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify({ enabled: deviceWLEnabled })
    });

    const dwlData = await dwlResponse.json();
    if (!dwlData.success) {
      showStatus('Failed to update device whitelist setting', 'error');
      return;
    }

    // Save access schedule setting
    const scheduleEnabled = document.getElementById('editSchedule').checked;
    const schedResponse = await fetch(`/api/policy/admin/user/${userId}/access-schedule/enforce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token
      },
      body: JSON.stringify({ enforce: scheduleEnabled })
    });

    const schedData = await schedResponse.json();
    if (!schedData.success) {
      showStatus('Failed to update access schedule setting', 'error');
      return;
    }

    showStatus('Policy updated successfully', 'success');
    closeModal('editModal');
    loadPolicies();
    
  } catch (error) {
    console.error('Error saving changes:', error);
    showStatus('Failed to save changes', 'error');
  }
}

/**
 * Load user devices
 */
async function loadUserDevices(userId) {
  try {
    // This would require a call to get user's specific devices
    // For now, load a summary from audit log
    const response = await fetch(`/api/policy/admin/user/${userId}/audit-log?limit=50`);
    const data = await response.json();
    
    if (!data.success) {
      document.getElementById('editDevicesList').innerHTML = 'Failed to load devices';
      return;
    }

    const logs = data.logs || [];
    const deviceLogs = logs.filter(l => l.type === 'DEVICE' || l.type === 'DEVICE_WHITELIST');

    if (deviceLogs.length === 0) {
      document.getElementById('editDevicesList').innerHTML = 'No device activity found';
      return;
    }

    let deviceHtml = '<ul style="list-style: none; padding: 0; margin: 0;">';
    deviceLogs.slice(0, 5).forEach(log => {
      deviceHtml += `
        <li style="padding: 5px 0; border-bottom: 1px solid var(--border-color);">
          ${log.action}: ${log.device || 'Unknown device'} 
          <span style="color: var(--text-muted); font-size: 11px;">(${new Date(log.timestamp).toLocaleDateString()})</span>
        </li>
      `;
    });
    deviceHtml += '</ul>';

    document.getElementById('editDevicesList').innerHTML = deviceHtml;
    
  } catch (error) {
    console.error('Error loading devices:', error);
    document.getElementById('editDevicesList').innerHTML = 'Failed to load devices';
  }
}

/**
 * Placeholder for additional settings
 */
function updatePolicySettings() {
  // Called when toggles change to show changes
}

/**
 * Open audit modal
 */
async function openAuditModal(userId) {
  try {
    // Get audit log
    const response = await fetch(`/api/policy/admin/user/${userId}/audit-log?limit=100`);
    const data = await response.json();
    
    if (!data.success) {
      showStatus('Failed to load audit log', 'error');
      return;
    }

    const logs = data.logs || [];
    let auditHtml = '';

    if (logs.length === 0) {
      auditHtml = '<div class="empty-state"><p>No activity found</p></div>';
    } else {
      auditHtml = '<ul style="list-style: none; padding: 0; margin: 0;">';
      logs.forEach(log => {
        const date = new Date(log.timestamp);
        const timeStr = date.toLocaleString();
        const typeDisplay = formatPolicyType(log.type);
        
        auditHtml += `
          <li style="padding: 10px; border-bottom: 1px solid var(--border-color); background: var(--bg-tertiary); margin-bottom: 8px; border-radius: 4px;">
            <div style="font-weight: bold; color: var(--text-primary);">
              ${typeDisplay}: ${log.action}
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px;">
              ${timeStr} | IP: ${escapeHtml(log.ipAddress || 'N/A')}
            </div>
            ${log.reason ? `<div style="font-size: 12px; margin-top: 3px;">Reason: ${escapeHtml(log.reason)}</div>` : ''}
          </li>
        `;
      });
      auditHtml += '</ul>';
    }

    document.getElementById('auditLogContent').innerHTML = auditHtml;
    document.getElementById('auditModal').classList.add('show');
    
  } catch (error) {
    console.error('Error loading audit log:', error);
    showStatus('Failed to load audit log', 'error');
  }
}

/**
 * Format policy type for display
 */
function formatPolicyType(type) {
  const types = {
    'TIER': 'Subscription Tier',
    'DEVICE': 'Device',
    'DEVICE_WHITELIST': 'Device Whitelist',
    'SCHEDULE': 'Access Schedule',
    'ACCESS': 'Access Check'
  };
  return types[type] || type;
}

/**
 * Escape HTML to prevent XSS
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
