/**
 * Dashboard page JavaScript
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

// Update active nav link
const currentPath = window.location.pathname;
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === currentPath) {
    link.classList.add('active');
  } else {
    link.classList.remove('active');
  }
});

// Load dashboard data
async function loadDashboardData() {
  try {
    const response = await fetch('/api/dashboard', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
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
      
      // Legacy dashboard data
      if (data.totalUsers) {
        const totalUsersEl = document.getElementById('totalUsers');
        if (totalUsersEl) totalUsersEl.textContent = data.totalUsers;
      }
      if (data.serverVersion) {
        const serverVersionEl = document.getElementById('serverVersion');
        if (serverVersionEl) serverVersionEl.textContent = data.serverVersion;
      }
      if (data.lastActivity) {
        const lastActivityEl = document.getElementById('lastActivity');
        if (lastActivityEl) lastActivityEl.textContent = data.lastActivity;
      }
    }
  } catch (error) {
    console.error('Error loading dashboard data:', error);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Load data if user is logged in
  const isLoggedIn = document.querySelector('.profile-card') !== null;
  if (isLoggedIn) {
    loadDashboardData();
  }
});
