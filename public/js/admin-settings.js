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
    if (!confirm('Run database maintenance now? This may take a few moments.')) {
      return;
    }

    const btn = document.getElementById('runMaintenanceBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running...';
    }

    try {
      const response = await fetch('/admin/api/maintenance/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (data.success) {
        showNotification('Maintenance completed successfully!', 'success');
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

  // Generate API Key function
  async function generateApiKey() {
    if (!confirm('Generate a new API key? The old key will no longer work.')) {
      return;
    }

    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      const response = await fetch('/admin/api/generate-api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken || ''
        }
      });

      const data = await response.json();
      
      if (data.success && data.apiKey) {
        const apiKeyInput = document.querySelector('input[name="apiKey"]');
        if (apiKeyInput) {
          apiKeyInput.value = data.apiKey;
        }
        showNotification('New API key generated successfully!', 'success');
      } else {
        showNotification(data.message || 'Failed to generate API key', 'error');
      }
    } catch (error) {
      console.error('Error generating API key:', error);
      showNotification('Error generating API key', 'error');
    }
  }

  // Copy API Key function
  function copyApiKey() {
    const apiKeyInput = document.querySelector('input[name="apiKey"]');
    if (apiKeyInput && apiKeyInput.value) {
      navigator.clipboard.writeText(apiKeyInput.value).then(() => {
        showNotification('API key copied to clipboard!', 'success');
      }).catch(() => {
        showNotification('Failed to copy API key', 'error');
      });
    } else {
      showNotification('No API key to copy', 'error');
    }
  }

  // Event listeners for API key buttons
  const generateApiKeyBtn = document.getElementById('generateApiKeyBtn');
  const copyApiKeyBtn = document.getElementById('copyApiKeyBtn');
  
  if (generateApiKeyBtn) {
    generateApiKeyBtn.addEventListener('click', generateApiKey);
  }
  
  if (copyApiKeyBtn) {
    copyApiKeyBtn.addEventListener('click', copyApiKey);
  }

  // Initialize first tab as active if none selected
  const activePanel = document.querySelector('.settings-panel.active');
  if (!activePanel && tabPanels.length > 0) {
    tabPanels[0].classList.add('active');
    if (tabButtons.length > 0) {
      tabButtons[0].classList.add('active');
    }
  }
});
