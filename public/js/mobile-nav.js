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
});
