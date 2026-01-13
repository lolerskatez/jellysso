/**
 * Plugin page JavaScript
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

function showMessage(message, type = 'success') {
  const messageDiv = document.getElementById('statusMessage');
  messageDiv.className = `alert alert-${type}`;
  messageDiv.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i> ${message}`;
  messageDiv.style.display = 'flex';

  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 5000);
}

async function loadApiKey() {
  try {
    const response = await fetch('/api/plugin/apikey');
    const data = await response.json();
    const apiKeyDisplay = document.getElementById('apiKeyDisplay');
    if (apiKeyDisplay) {
      apiKeyDisplay.textContent = data.apiKey;
    }
    const apiKeyTable = document.getElementById('apiKeyTable');
    if (apiKeyTable) {
      apiKeyTable.textContent = data.apiKey;
    }
  } catch (error) {
    const apiKeyDisplay = document.getElementById('apiKeyDisplay');
    if (apiKeyDisplay) {
      apiKeyDisplay.textContent = 'Error loading API key';
    }
    console.error('Failed to load API key:', error);
  }
}

async function loadConfiguration() {
  try {
    // This would typically load from the setup configuration
    const companionUrl = window.location.origin;
    const companionUrlEl = document.getElementById('companionUrl');
    if (companionUrlEl) {
      companionUrlEl.textContent = companionUrl;
    }
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
}

function copyApiKey() {
  const apiKeyDisplay = document.getElementById('apiKeyDisplay');
  const apiKey = apiKeyDisplay ? apiKeyDisplay.textContent : '';
  
  if (!apiKey || apiKey === 'Error loading API key') {
    showMessage('No API key to copy', 'error');
    return;
  }

  navigator.clipboard.writeText(apiKey).then(() => {
    showMessage('API key copied to clipboard!');
  }).catch(() => {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = apiKey;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showMessage('API key copied to clipboard!');
  });
}

async function regenerateApiKey() {
  if (!confirm('Are you sure you want to regenerate the API key? This will break existing plugin configurations.')) {
    return;
  }

  try {
    const response = await fetch('/api/plugin/regenerate', { method: 'POST' });
    if (response.ok) {
      showMessage('API key regenerated successfully!');
      loadApiKey();
    } else {
      showMessage('Failed to regenerate API key', 'error');
    }
  } catch (error) {
    showMessage('Error regenerating API key', 'error');
  }
}

function downloadPlugin() {
  // This would typically trigger a download of the plugin package
  showMessage('Plugin download would start here. Feature coming soon!', 'info');
}

function showInstallationInstructions() {
  const modal = document.getElementById('instructionsModal');
  if (modal) {
    modal.classList.add('show');
  }
}

function closeInstructionsModal() {
  const modal = document.getElementById('instructionsModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Load data on page load
  loadApiKey();
  loadConfiguration();

  // Bind copy button
  const copyBtn = document.querySelector('.copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', copyApiKey);
  }

  // Bind regenerate button
  const regenerateBtn = document.querySelector('.regenerate-btn');
  if (regenerateBtn) {
    regenerateBtn.addEventListener('click', regenerateApiKey);
  }

  // Bind download buttons
  document.querySelectorAll('[data-action="download"]').forEach(btn => {
    btn.addEventListener('click', downloadPlugin);
  });

  // Bind instructions button
  const instructionsBtn = document.getElementById('showInstructionsBtn');
  if (instructionsBtn) {
    instructionsBtn.addEventListener('click', showInstallationInstructions);
  }

  // Bind modal close buttons
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', closeInstructionsModal);
  });

  // Close modals when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal')) {
      e.target.classList.remove('show');
    }
  });

  // Check if plugin download is available
  fetch('/api/plugin/download', { method: 'HEAD' })
    .then(response => {
      if (!response.ok) {
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
          downloadBtn.style.display = 'none';
        }
        const warning = document.createElement('p');
        warning.innerHTML = '<strong>⚠️ Plugin not available for download.</strong> Please build the plugin first using the build instructions.';
        warning.style.color = 'var(--warning-color)';
        const pluginSection = document.querySelector('.plugin-section');
        if (pluginSection) {
          pluginSection.appendChild(warning);
        }
      }
    })
    .catch(() => {
      const downloadBtn = document.getElementById('downloadBtn');
      if (downloadBtn) {
        downloadBtn.style.display = 'none';
      }
    });
});
