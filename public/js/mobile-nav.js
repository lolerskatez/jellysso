/**
 * Mobile Navigation Handler
 * Handles sidebar toggle, overlay, and responsive behavior
 */

document.addEventListener('DOMContentLoaded', function() {
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebarOverlay');
  const mobileMenuToggle = document.getElementById('mobileMenuToggle');
  const logoutBtn = document.getElementById('logoutBtn');

  // Toggle sidebar
  function toggleSidebar() {
    if (sidebar) {
      sidebar.classList.toggle('show');
    }
    if (sidebarOverlay) {
      sidebarOverlay.classList.toggle('active');
    }
    document.body.classList.toggle('sidebar-open');
  }

  // Close sidebar
  function closeSidebar() {
    if (sidebar) {
      sidebar.classList.remove('show');
    }
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove('active');
    }
    document.body.classList.remove('sidebar-open');
  }

  // Mobile menu toggle click
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', function(e) {
      e.preventDefault();
      toggleSidebar();
    });
  }

  // Close sidebar when clicking overlay
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeSidebar);
  }

  // Close sidebar when clicking a nav link (on mobile)
  const navLinks = document.querySelectorAll('.sidebar .nav-link');
  navLinks.forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 768) {
        closeSidebar();
      }
    });
  });

  // Close sidebar on escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && sidebar && sidebar.classList.contains('show')) {
      closeSidebar();
    }
  });

  // Handle window resize
  let resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      if (window.innerWidth > 768) {
        closeSidebar();
      }
    }, 100);
  });

  // Logout handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async function() {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (response.ok) {
          window.location.href = '/login';
        }
      } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
      }
    });
  }

  // Nav group toggle with auto-open for current page
  var groupMap = {
    usersSubnav:    ['admin-users', 'admin-invites', 'admin-profiles', 'admin-expiry', 'admin-labels', 'admin-policy'],
    commsSubnav:    ['admin-notifications', 'admin-message-templates', 'admin-announcements'],
    securitySubnav: ['admin-oidc', 'admin-lockouts', 'admin-security-alerts'],
    devSubnav:      ['admin-api-keys', 'admin-webhooks'],
    systemSubnav:   ['admin-settings', 'admin-audit-logs', 'admin-backups', 'admin-plugins', 'admin-troubleshoot', 'admin-playback-sessions', 'admin-system', 'admin-monitoring', 'admin-activity-log', 'admin-policy-audit', 'admin-device-whitelist']
  };
  var currentPage = window._currentPage || '';

  document.querySelectorAll('.nav-group-btn').forEach(function (btn) {
    var subnavId = btn.getAttribute('data-toggle');
    var subnav = document.getElementById(subnavId);
    if (!subnav) return;

    function openGroup() {
      subnav.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
    function closeGroup() {
      subnav.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    if (groupMap[subnavId] && groupMap[subnavId].includes(currentPage)) {
      openGroup();
    }

    btn.addEventListener('click', function () {
      subnav.classList.contains('open') ? closeGroup() : openGroup();
    });
  });
});
