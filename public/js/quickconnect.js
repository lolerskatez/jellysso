/**
 * QuickConnect Page JavaScript
 * Handles QuickConnect authorization flow and pending sessions management
 * 
 * Flow:
 * 1. User sees a code on their TV/device
 * 2. User enters the code in this web app or views pending sessions
 * 3. Web app authorizes the code using the logged-in user's session
 * 4. TV/device successfully logs in
 */

document.addEventListener('DOMContentLoaded', function() {
  const quickConnectForm = document.getElementById('quickConnectForm');
  const codeInput = document.getElementById('quickConnectCode');
  const authorizeBtn = document.getElementById('authorizeBtn');
  const btnText = document.getElementById('btnText');
  const btnLoading = document.getElementById('btnLoading');
  const statusMessage = document.getElementById('statusMessage');
  const sidebarToggle = document.getElementById('sidebarToggle');

  // Get CSRF token
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  // Sidebar toggle for mobile
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.classList.toggle('show');
    });
  }

  // ========== QUICK CONNECT FORM ==========
  // Show status message
  function showStatus(message, type) {
    if (!statusMessage) return;
    statusMessage.className = 'status-message status-' + type;
    statusMessage.style.display = 'block';
    
    let icon = '';
    switch (type) {
      case 'success': icon = '<i class="fas fa-check-circle"></i>'; break;
      case 'error': icon = '<i class="fas fa-exclamation-triangle"></i>'; break;
      case 'info': icon = '<i class="fas fa-spinner fa-spin"></i>'; break;
      default: icon = '<i class="fas fa-info-circle"></i>';
    }
    statusMessage.innerHTML = icon + ' ' + message;
  }

  // Hide status message
  function hideStatus() {
    if (statusMessage) {
      statusMessage.style.display = 'none';
    }
  }

  // Set loading state
  function setLoading(loading) {
    if (loading) {
      if (btnText) btnText.style.display = 'none';
      if (btnLoading) btnLoading.style.display = 'inline-flex';
      if (authorizeBtn) authorizeBtn.disabled = true;
    } else {
      if (btnText) btnText.style.display = 'inline-flex';
      if (btnLoading) btnLoading.style.display = 'none';
      if (authorizeBtn) authorizeBtn.disabled = false;
    }
  }

  // Handle form submission
  if (quickConnectForm) {
    quickConnectForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      hideStatus();

      const code = codeInput.value.trim();
      if (!code || code.length < 4) {
        showStatus('Please enter a valid QuickConnect code', 'error');
        codeInput.focus();
        return;
      }

      setLoading(true);
      showStatus('Authorizing device...', 'info');

      try {
        const response = await fetch('/api/quickconnect/authorize', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'csrf-token': getCsrfToken()
          },
          body: JSON.stringify({ code: code })
        });

        const data = await response.json();

        if (data.success) {
          showStatus('Device authorized successfully! The device can now log in.', 'success');
          codeInput.value = '';
        } else {
          showStatus(data.message || 'Authorization failed. Please check the code and try again.', 'error');
        }
      } catch (error) {
        console.error('Authorization error:', error);
        showStatus('Authorization failed. Please try again.', 'error');
      } finally {
        setLoading(false);
      }
    });
  }

  // Auto-format code input
  if (codeInput) {
    codeInput.addEventListener('input', function(e) {
      // Allow alphanumeric characters
      let value = e.target.value.toUpperCase();
      e.target.value = value;
    });

    // Focus on load
    codeInput.focus();
  }

});
