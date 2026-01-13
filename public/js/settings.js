/**
 * Settings page JavaScript
 */

// Sidebar toggle for mobile
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.querySelector('.sidebar');

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
  });
}

// Close sidebar on link click (mobile)
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    sidebar.classList.remove('active');
  });
});

// Update active nav link
const currentPath = window.location.pathname;
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === currentPath) {
    link.classList.add('active');
  }
});

// Logout function
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    
    fetch('/api/auth/logout', { 
      method: 'POST',
      credentials: 'include',
      headers
    })
      .then(() => {
        window.location.href = '/login';
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }
}

// Bind logout button
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', logout);
}

// Settings section switching
document.querySelectorAll('.settings-nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const sectionName = item.getAttribute('data-section');
    
    // Hide all sections
    document.querySelectorAll('.settings-section').forEach(section => {
      section.classList.remove('active');
    });

    // Remove active class from nav items
    document.querySelectorAll('.settings-nav-item').forEach(navItem => {
      navItem.classList.remove('active');
    });

    // Show selected section
    document.getElementById(sectionName + '-section').classList.add('active');

    // Set active nav item
    item.classList.add('active');
  });
});

// Message display function
function showMessage(message, type = 'success') {
  const messageDiv = document.getElementById('message');
  messageDiv.className = `alert alert-${type}`;
  messageDiv.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i> ${message}`;
  messageDiv.style.display = 'flex';

  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 5000);
}

// Load and save settings (old tabs system)
async function loadSettings() {
  try {
    // Load general settings (OLD TABS SYSTEM)
    const serverNameOld = localStorage.getItem('serverName') || '';
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const autoSaveInterval = localStorage.getItem('autoSaveInterval') || '5';

    const oldServerNameField = document.getElementById('serverNameOld');
    if (oldServerNameField) {
      oldServerNameField.value = serverNameOld;
    }
    
    const serverUrlField = document.getElementById('serverUrl');
    if (serverUrlField) {
      serverUrlField.value = serverUrl;
    }
    
    const autoSaveField = document.getElementById('autoSaveInterval');
    if (autoSaveField) {
      autoSaveField.value = autoSaveInterval;
    }

    // Load security settings
    const sessionTimeout = localStorage.getItem('sessionTimeout') || '30';
    const enableSSL = localStorage.getItem('enableSSL') === 'true';
    const requireStrongPassword = localStorage.getItem('requireStrongPassword') === 'true';

    const sessionTimeoutField = document.getElementById('sessionTimeout');
    if (sessionTimeoutField) {
      sessionTimeoutField.value = sessionTimeout;
    }
    
    const enableSSLField = document.getElementById('enableSSL');
    if (enableSSLField) {
      enableSSLField.checked = enableSSL;
    }
    
    const strongPasswordField = document.getElementById('requireStrongPassword');
    if (strongPasswordField) {
      strongPasswordField.checked = requireStrongPassword;
    }

    // Load notification settings
    const enableNotifications = localStorage.getItem('enableNotifications') !== 'false';
    const notifyOnUserLogin = localStorage.getItem('notifyOnUserLogin') !== 'false';
    const notifyOnError = localStorage.getItem('notifyOnError') !== 'false';

    const enableNotifField = document.getElementById('enableNotifications');
    if (enableNotifField) {
      enableNotifField.checked = enableNotifications;
    }
    
    const notifyLoginField = document.getElementById('notifyOnUserLogin');
    if (notifyLoginField) {
      notifyLoginField.checked = notifyOnUserLogin;
    }
    
    const notifyErrorField = document.getElementById('notifyOnError');
    if (notifyErrorField) {
      notifyErrorField.checked = notifyOnError;
    }

    // Load version info (silently fail if endpoint doesn't exist)
    try {
      const response = await fetch('/api/server/info');
      if (response.ok) {
        const data = await response.json();
        const versionField = document.getElementById('jellyfinVersion');
        if (versionField) {
          versionField.textContent = data.version || 'Unknown';
        }
      } else {
        // Endpoint doesn't exist, just set default value
        const versionField = document.getElementById('jellyfinVersion');
        if (versionField) {
          versionField.textContent = 'Not Available';
        }
      }
    } catch (error) {
      // Silently fail - endpoint may not exist
      const versionField = document.getElementById('jellyfinVersion');
      if (versionField) {
        versionField.textContent = 'Not Available';
      }
    }

    const lastUpdated = localStorage.getItem('lastSettingsUpdate') || new Date().toLocaleDateString();
    const lastUpdatedField = document.getElementById('lastUpdated');
    if (lastUpdatedField) {
      lastUpdatedField.textContent = lastUpdated;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save security settings
function saveSecuritySettings() {
  localStorage.setItem('sessionTimeout', document.getElementById('sessionTimeout').value);
  localStorage.setItem('enableSSL', document.getElementById('enableSSL').checked);
  localStorage.setItem('requireStrongPassword', document.getElementById('requireStrongPassword').checked);
  alert('Security settings saved successfully!');
}

// Save notification settings
function saveNotificationSettings() {
  localStorage.setItem('enableNotifications', document.getElementById('enableNotifications').checked);
  localStorage.setItem('notifyOnUserLogin', document.getElementById('notifyOnUserLogin').checked);
  localStorage.setItem('notifyOnError', document.getElementById('notifyOnError').checked);
  alert('Notification settings saved successfully!');
}

// Load companion settings
async function loadCompanionSettings() {
  try {
    const response = await fetch('/api/settings/companion');
    const settings = await response.json();
    Object.keys(settings).forEach(key => {
      const element = document.querySelector(`[name="${key}"]`);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = settings[key];
        } else {
          element.value = settings[key];
        }
      }
    });
  } catch (error) {
    console.error('Failed to load companion settings');
  }
}

// Backup functionality
async function createBackup() {
  try {
    const response = await fetch('/api/settings/backup');
    const backup = await response.json();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jellyfin-companion-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showMessage('Backup created successfully!');
  } catch (error) {
    showMessage('Failed to create backup', 'error');
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Load settings on page load (OLD TABS SYSTEM)
  loadSettings();

  // Save general settings (OLD TABS SYSTEM)
  const generalForm = document.getElementById('generalForm');
  if (generalForm) {
    generalForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const oldServerNameField = document.getElementById('serverNameOld');
      const serverUrlField = document.getElementById('serverUrl');
      const autoSaveField = document.getElementById('autoSaveInterval');
      
      if (oldServerNameField) {
        localStorage.setItem('serverName', oldServerNameField.value);
      }
      if (serverUrlField) {
        localStorage.setItem('serverUrl', serverUrlField.value);
      }
      if (autoSaveField) {
        localStorage.setItem('autoSaveInterval', autoSaveField.value);
      }
      localStorage.setItem('lastSettingsUpdate', new Date().toLocaleDateString());
      alert('General settings saved successfully!');
    });
  }

  // Bind save security settings button
  const saveSecurityBtn = document.querySelector('[data-save="security"]');
  if (saveSecurityBtn) {
    saveSecurityBtn.addEventListener('click', saveSecuritySettings);
  }

  // Bind save notification settings button
  const saveNotificationBtn = document.querySelector('[data-save="notification"]');
  if (saveNotificationBtn) {
    saveNotificationBtn.addEventListener('click', saveNotificationSettings);
  }

  // Load companion settings on page load (NEW SYSTEM)
  loadCompanionSettings();

  // Companion settings form (NEW SYSTEM)
  const companionSettingsForm = document.getElementById('companionSettingsForm');
  if (companionSettingsForm) {
    companionSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      data.notifications = e.target.notifications.checked;

      try {
        const response = await fetch('/api/settings/companion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (response.ok) {
          showMessage('Companion settings saved successfully!');
        } else {
          showMessage('Failed to save companion settings', 'error');
        }
      } catch (error) {
        showMessage('Error saving companion settings', 'error');
      }
    });
  }

  // System settings (NEW SYSTEM)
  const loadSystemSettingsBtn = document.getElementById('loadSystemSettings');
  if (loadSystemSettingsBtn) {
    loadSystemSettingsBtn.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/settings/system');
        const config = await response.json();
        
        const systemServerNameField = document.getElementById('serverName');
        if (systemServerNameField) {
          systemServerNameField.value = config.ServerName || '';
        }
        
        const enableHttpsField = document.getElementById('enableHttps');
        if (enableHttpsField) {
          enableHttpsField.checked = config.EnableHttps || false;
        }
        
        const publicHttpsPortField = document.getElementById('publicHttpsPort');
        if (publicHttpsPortField) {
          publicHttpsPortField.value = config.PublicHttpsPort || '';
        }
        
        const systemSettingsForm = document.getElementById('systemSettingsForm');
        if (systemSettingsForm) {
          systemSettingsForm.style.display = 'block';
        }
        
        loadSystemSettingsBtn.style.display = 'none';
      } catch (error) {
        showMessage('Failed to load system settings. Make sure you are logged in as admin.', 'error');
      }
    });
  }

  const systemSettingsForm = document.getElementById('systemSettingsForm');
  if (systemSettingsForm) {
    systemSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      data.EnableHttps = e.target.EnableHttps.checked;
      data.PublicHttpsPort = parseInt(data.PublicHttpsPort) || 0;

      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) {
          headers['x-csrf-token'] = csrfToken;
        }
        const response = await fetch('/api/settings/system', {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
        });

        if (response.ok) {
          showMessage('System settings saved successfully!');
        } else {
          showMessage('Failed to save system settings. Admin access required.', 'error');
        }
      } catch (error) {
        showMessage('Error saving system settings', 'error');
      }
    });
  }

  // Backup functionality
  const backupBtn = document.getElementById('backupBtn');
  if (backupBtn) {
    backupBtn.addEventListener('click', createBackup);
  }
  
  const backupBtnFull = document.getElementById('backupBtnFull');
  if (backupBtnFull) {
    backupBtnFull.addEventListener('click', createBackup);
  }

  // Restore functionality
  const restoreBtn = document.getElementById('restoreBtn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      document.getElementById('restoreFile').click();
    });
  }

  const restoreBtnFull = document.getElementById('restoreBtnFull');
  if (restoreBtnFull) {
    restoreBtnFull.addEventListener('click', () => {
      document.getElementById('restoreFile').click();
    });
  }

  const restoreFile = document.getElementById('restoreFile');
  if (restoreFile) {
    restoreFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const text = await file.text();
          const backup = JSON.parse(text);
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
          const headers = { 'Content-Type': 'application/json' };
          if (csrfToken) {
            headers['x-csrf-token'] = csrfToken;
          }
          const response = await fetch('/api/settings/restore', {
            method: 'POST',
            headers,
            body: JSON.stringify(backup)
          });

          if (response.ok) {
            showMessage('Settings restored successfully!');
            loadCompanionSettings();
          } else {
            showMessage('Failed to restore settings', 'error');
          }
        } catch (error) {
          showMessage('Invalid backup file', 'error');
        }
      }
      // Clear the file input
      e.target.value = '';
    });
  }
});
