/**
 * Admin Dashboard JavaScript
 * Handles admin dashboard functionality and data loading
 */

document.addEventListener('DOMContentLoaded', () => {
  initializeAdminDashboard();
  loadSystemStats();
  setupLogout();
  highlightCurrentNav();
});

/**
 * Initialize the admin dashboard
 */
function initializeAdminDashboard() {
  console.log('Initializing admin dashboard...');
  
  // Add any initialization logic here
}

/**
 * Load system statistics
 */
async function loadSystemStats() {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('Failed to load stats');
    
    const data = await response.json();
    
    // Update server version
    const versionElement = document.getElementById('serverVersion');
    if (versionElement && data.version) {
      versionElement.textContent = data.version;
    }
    
    // Update uptime
    const uptimeElement = document.getElementById('serverUptime');
    if (uptimeElement && data.uptime) {
      uptimeElement.textContent = formatUptime(data.uptime);
    }
    
    // Load user stats
    loadUserStats();
  } catch (error) {
    console.error('Error loading system stats:', error);
  }
}

/**
 * Load user statistics
 */
async function loadUserStats() {
  try {
    const response = await fetch('/api/users');
    if (!response.ok) throw new Error('Failed to load user stats');
    
    const data = await response.json();
    
    // Update total users
    const totalElement = document.getElementById('totalUsers');
    if (totalElement) {
      totalElement.textContent = data.length || 0;
    }
    
    // Update active users (simplified - count users with recent activity)
    const activeElement = document.getElementById('activeUsers');
    if (activeElement) {
      const activeUsers = data.filter(user => user.lastActivityDate).length || 0;
      activeElement.textContent = activeUsers;
    }
  } catch (error) {
    console.error('Error loading user stats:', error);
  }
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Setup logout button
 */
function setupLogout() {
  const logoutBtn = document.getElementById('logoutBtn');
  console.log('setupLogout called, logoutBtn found:', !!logoutBtn);
  if (logoutBtn) {
    console.log('Adding click listener to logout button');
    logoutBtn.addEventListener('click', (e) => {
      console.log('Logout button clicked');
      handleLogout(e);
    });
  } else {
    console.warn('Logout button not found in DOM');
  }
  
  // Mobile sidebar toggle
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar);
  }
}

/**
 * Handle logout action
 */
async function handleLogout(e) {
  console.log('handleLogout called, event:', !!e);
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  try {
    console.log('Fetching CSRF token');
    // Get CSRF token from meta tag
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    console.log('CSRF Token found:', !!csrfToken, 'Token:', csrfToken?.substring(0, 20) + '...');
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    // Add CSRF token to headers if available
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    
    console.log('Sending logout request to /api/auth/logout');
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers
    });
    
    console.log('Logout response status:', response.status);
    const data = await response.json().catch(() => ({}));
    console.log('Logout response data:', data);
    
    if (data.success || response.ok) {
      showToast('Logged out successfully', 'success');
      setTimeout(() => {
        window.location.href = '/login';
      }, 800);
    } else {
      console.error('Logout response:', data);
      showToast('Logged out', 'success');
      setTimeout(() => {
        window.location.href = '/login';
      }, 800);
    }
  } catch (error) {
    console.error('Logout error:', error);
    // Still redirect even on error
    showToast('Logged out', 'success');
    setTimeout(() => {
      window.location.href = '/login';
    }, 800);
  }
}

/**
 * Toggle sidebar on mobile
 */
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('active');
  }
}

/**
 * Highlight current navigation item
 */
function highlightCurrentNav() {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link:not(#logoutBtn)');
  
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: var(--spacing-lg);
      right: var(--spacing-lg);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }
  
  // Create toast element
  const toast = document.createElement('div');
  const typeClass = type === 'success' ? 'alert-success' : 
                    type === 'danger' ? 'alert-danger' : 
                    type === 'warning' ? 'alert-warning' : 
                    'alert-info';
  
  toast.className = `alert ${typeClass}`;
  toast.style.cssText = `
    padding: var(--spacing-md) var(--spacing-lg);
    border-radius: var(--border-radius);
    box-shadow: var(--shadow);
    max-width: 400px;
    animation: slideIn 0.3s ease-in-out;
    pointer-events: all;
  `;
  
  // Add icon based on type
  let icon = '✓';
  if (type === 'danger') icon = '✕';
  else if (type === 'warning') icon = '⚠';
  else if (type === 'info') icon = 'ℹ';
  
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  toastContainer.appendChild(toast);
  
  // Remove toast after duration
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-in-out';
    setTimeout(() => {
      toast.remove();
      if (toastContainer.children.length === 0) {
        toastContainer.remove();
        document.getElementById('toast-container')?.remove();
      }
    }, 300);
  }, duration);
}
