// User Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function() {
  // Initialize dashboard
  initializeDashboard();

  // Setup logout functionality
  setupLogout();

  // Setup sidebar toggle for mobile
  setupSidebarToggle();
});

function initializeDashboard() {
  // Load dashboard data (system status and published URL)
  loadDashboardData();

  // Load server information
  loadServerInfo();

  // Load user statistics
  loadUserStats();

  // Update timestamps
  updateTimestamps();
}

async function loadDashboardData() {
  try {
    const response = await fetch('/api/dashboard');
    if (response.ok) {
      const data = await response.json();

      // Update system status
      if (data.systemStatus !== undefined) {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        const statusTime = document.getElementById('statusTime');

        if (statusIndicator) {
          if (data.systemStatus === 'online') {
            statusIndicator.classList.remove('offline');
          } else {
            statusIndicator.classList.add('offline');
          }
        }
        if (statusText) {
          statusText.textContent = data.systemStatus === 'online' ? 'Online' : 'Offline';
        }
        if (statusTime && data.lastStatusCheck) {
          statusTime.textContent = data.lastStatusCheck;
        }
      }

      // Update published URL
      if (data.publishedUrl) {
        const publishedUrlEl = document.getElementById('publishedUrl');
        if (publishedUrlEl) {
          publishedUrlEl.textContent = data.publishedUrl;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
  }
}

async function loadServerInfo() {
  try {
    const response = await fetch('/api/server-info');
    if (response.ok) {
      const data = await response.json();

      // Update server version
      const versionElement = document.getElementById('serverVersion');
      if (versionElement && data.version) {
        versionElement.textContent = `Version ${data.version}`;
      }

      // Update server status
      const statusElement = document.getElementById('serverStatus');
      const statusDot = document.getElementById('serverStatusDot');
      const statusText = document.getElementById('serverStatusText');

      if (statusElement && statusDot && statusText) {
        if (data.online) {
          statusElement.innerHTML = '<i class="fas fa-circle" style="color: var(--success); font-size: 1.5rem;"></i>';
          statusDot.className = 'status-dot';
          statusText.textContent = 'Server Online';
        } else {
          statusElement.innerHTML = '<i class="fas fa-circle" style="color: var(--danger); font-size: 1.5rem;"></i>';
          statusDot.className = 'status-dot offline';
          statusText.textContent = 'Server Offline';
        }
      }
    }
  } catch (error) {
    console.error('Failed to load server info:', error);
  }
}

async function loadUserStats() {
  try {
    // Load device count
    const devicesElement = document.getElementById('devicesCount');
    if (devicesElement) {
      // This would typically come from an API call
      // For now, show a placeholder
      devicesElement.textContent = '1';
    }

    // Load last login
    const lastLoginElement = document.getElementById('lastLogin');
    if (lastLoginElement) {
      lastLoginElement.textContent = 'Today';
    }
  } catch (error) {
    console.error('Failed to load user stats:', error);
  }
}

function updateTimestamps() {
  const loginTimeElement = document.getElementById('loginTime');
  if (loginTimeElement) {
    loginTimeElement.textContent = 'Just now';
  }
}

function setupLogout() {
  const logoutButtons = document.querySelectorAll('#logoutBtn');

  logoutButtons.forEach(button => {
    button.addEventListener('click', async function(e) {
      e.preventDefault();

      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
          }
        });

        if (response.ok) {
          window.location.href = '/login';
        } else {
          console.error('Logout failed');
          // Fallback: redirect anyway
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Logout error:', error);
        // Fallback: redirect anyway
        window.location.href = '/login';
      }
    });
  });
}

function setupSidebarToggle() {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.querySelector('.sidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', function() {
      sidebar.classList.toggle('sidebar-open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', function(e) {
      if (window.innerWidth <= 768 &&
          !sidebar.contains(e.target) &&
          !sidebarToggle.contains(e.target)) {
        sidebar.classList.remove('sidebar-open');
      }
    });
  }
}

// Auto-refresh server status every 30 seconds
setInterval(loadServerInfo, 30000);