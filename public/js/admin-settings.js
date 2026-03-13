// Admin Settings JavaScript

document.addEventListener('DOMContentLoaded', function() {
  // Tab elements
  const tabButtons = document.querySelectorAll('.settings-tab-btn');
  const tabPanels = document.querySelectorAll('.settings-panel');
  
  // Toggle switches
  const toggleSwitches = document.querySelectorAll('.toggle-switch');
  
  // Form elements
  const saveButtons = document.querySelectorAll('[data-action="save"]');
  const resetButtons = document.querySelectorAll('[data-action="reset"]');
  const runMaintenanceBtn = document.getElementById('runMaintenanceBtn');

  // Switch tab function
  function switchTab(tabName) {
    // Hide all panels
    tabPanels.forEach(panel => {
      panel.classList.remove('active');
    });
    
    // Remove active class from all buttons
    tabButtons.forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Show selected panel
    const targetPanel = document.getElementById(tabName);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
    
    // Activate clicked button
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
    }

    // Refresh live data for tabs that display it
    if (tabName === 'logging') loadAuditLogStats();
    if (tabName === 'maintenance') loadMaintenanceHistory();
  }

  // Toggle switch function
  function toggleSwitch(element) {
    element.classList.toggle('active');
    const input = element.querySelector('input[type="hidden"]');
    if (input) {
      input.value = element.classList.contains('active') ? 'true' : 'false';
    }
  }

  // Show notification
  function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    if (notification) {
      notification.textContent = message;
      notification.className = `notification ${type}`;
      notification.classList.add('show');
      setTimeout(() => {
        notification.classList.remove('show');
      }, 3000);
    }
  }

  // Save settings function
  async function saveSettings(section) {
    const panel = document.getElementById(section);
    if (!panel) return;

    const formData = {};
    
    // Collect all inputs from the section
    panel.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.name) {
        if (input.type === 'checkbox') {
          formData[input.name] = input.checked;
        } else {
          formData[input.name] = input.value;
        }
      }
    });

    // Collect toggle switch values
    panel.querySelectorAll('.toggle-switch').forEach(toggle => {
      const name = toggle.dataset.name;
      if (name) {
        formData[name] = toggle.classList.contains('active');
      }
    });

    try {
      // Get CSRF token from meta tag
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      
      const response = await fetch('/admin/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken || ''
        },
        body: JSON.stringify({ section, settings: formData })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('Settings saved successfully!', 'success');
        if (section === 'maintenance') loadMaintenanceHistory();
        if (section === 'logging') loadAuditLogStats();
        // Reload the page after saving app settings so appName and theme take effect
        if (section === 'app') {
          // Persist theme to localStorage so theme-init.js applies it on every page immediately
          if (formData.theme && window.applyTheme) {
            localStorage.setItem('app-theme', formData.theme);
            window.applyTheme(formData.theme);
          }
          setTimeout(() => window.location.reload(), 800);
          return;
        }
      } else {
        showNotification(data.message || 'Failed to save settings', 'error');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      showNotification('Error saving settings', 'error');
    }
  }

  // Reset settings function
  function resetSettings(section) {
    if (confirm('Are you sure you want to reset these settings to defaults?')) {
      showNotification('Settings reset to defaults', 'success');
      // Reload the page to get default values
      window.location.reload();
    }
  }

  // Run maintenance function
  async function runMaintenance() {
    if (!confirm('Run all database maintenance tasks now? This may take a few moments.')) {
      return;
    }

    const btn = document.getElementById('runMaintenanceBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
    }

    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/admin/api/maintenance/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ task: 'all' })
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('Maintenance completed successfully!', 'success');
        loadMaintenanceHistory();
      } else {
        showNotification(data.message || 'Maintenance failed', 'error');
      }
    } catch (error) {
      console.error('Error running maintenance:', error);
      showNotification('Error running maintenance', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Run Now';
      }
    }
  }

  // Event listeners for tabs
  tabButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });
  });

  // Event listeners for toggle switches
  toggleSwitches.forEach(toggle => {
    toggle.addEventListener('click', function() {
      toggleSwitch(this);
    });
  });

  // Event listeners for save buttons
  saveButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const section = this.dataset.section;
      if (section) {
        saveSettings(section);
      }
    });
  });

  // Event listeners for reset buttons
  resetButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const section = this.dataset.section;
      if (section) {
        resetSettings(section);
      }
    });
  });

  // Event listener for run maintenance
  if (runMaintenanceBtn) {
    runMaintenanceBtn.addEventListener('click', runMaintenance);
  }

  // Initialize first tab as active if none selected
  const activePanel = document.querySelector('.settings-panel.active');
  if (!activePanel && tabPanels.length > 0) {
    tabPanels[0].classList.add('active');
    if (tabButtons.length > 0) {
      tabButtons[0].classList.add('active');
    }
  }

  // Load maintenance history on page load
  loadMaintenanceHistory();
  // Load audit log stats on page load (powers the logging tab summary box)
  loadAuditLogStats();
});

// Load maintenance history from audit logs
async function loadMaintenanceHistory() {
  try {
    const response = await fetch('/admin/api/maintenance/history');
    if (!response.ok) return;
    const data = await response.json();
    if (!data.success) return;
    const el = id => document.getElementById(id);
    if (el('lastCleanupHistory'))  el('lastCleanupHistory').textContent  = data.history.lastCleanup;
    if (el('lastOptimizeHistory')) el('lastOptimizeHistory').textContent = data.history.lastOptimize;
    if (el('lastBackupHistory'))   el('lastBackupHistory').textContent   = data.history.lastBackup;
  } catch (e) {
    console.error('Failed to load maintenance history:', e);
  }
}

// Load live audit log statistics into the logging tab summary box
async function loadAuditLogStats() {
  try {
    const response = await fetch('/admin/api/stats');
    if (!response.ok) return;
    const data = await response.json();
    if (!data.success) return;

    const box = document.getElementById('auditLogSummary');
    const total = document.getElementById('auditLogTotal');
    const last24h = document.getElementById('auditLogLast24h');
    const rate = document.getElementById('auditLogSuccessRate');

    if (total)  total.textContent  = (data.totalRequests  ?? '—').toLocaleString();
    if (last24h) last24h.textContent = (data.last24h       ?? '—').toLocaleString();
    if (rate)   rate.textContent   = data.successRate ?? '—';
    if (box)    box.style.display  = '';
  } catch (e) {
    console.error('Failed to load audit log stats:', e);
  }
}
