// Login Form Handler
document.addEventListener('DOMContentLoaded', function() {
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginLoading = document.getElementById('loginLoading');
  const loginText = document.getElementById('loginText');
  const messageDiv = document.getElementById('message');
  const usernameField = document.getElementById('username');

  function showMessage(message, type = 'error') {
    messageDiv.classList.remove('hidden');
    messageDiv.className = `alert ${type}`;
    const icon = type === 'success' ? 'check-circle' : 'exclamation-circle';
    messageDiv.innerHTML = `
      <i class="fas fa-${icon}"></i>
      <span>${message}</span>
    `;
  }

  function setLoading(loading) {
    if (loading) {
      loginLoading.classList.remove('hidden');
      loginText.classList.add('hidden');
      loginBtn.disabled = true;
    } else {
      loginLoading.classList.add('hidden');
      loginText.classList.remove('hidden');
      loginBtn.disabled = false;
    }
  }

  // Function to get CSRF token - tries meta tag first, then fetches if needed
  async function getCsrfToken() {
    let token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    
    // If no token in meta, try to fetch one
    if (!token) {
      try {
        const response = await fetch('/api/csrf-token', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (response.ok) {
          const data = await response.json();
          token = data.csrf_token;
          // Update the meta tag for future requests
          let metaTag = document.querySelector('meta[name="csrf-token"]');
          if (!metaTag) {
            metaTag = document.createElement('meta');
            metaTag.name = 'csrf-token';
            document.head.appendChild(metaTag);
          }
          metaTag.content = token;
        }
      } catch (e) {
        console.warn('Failed to fetch CSRF token:', e);
      }
    }
    
    return token || '';
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      messageDiv.classList.add('hidden');
      setLoading(true);

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);
      
      // Get CSRF token (try meta first, then fetch if needed)
      const csrfToken = await getCsrfToken();

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          credentials: 'include', // Important: send cookies with cross-origin requests
          body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success && result.requireTotp) {
          // Show TOTP step — credentials verified, 2FA code needed
          setLoading(false);
          showTotpStep();
          return;
        }

        if (result.success) {
          showMessage('Login successful! Redirecting...', 'success');
          setTimeout(() => {
            window.location.href = '/quickconnect';
          }, 1000);
        } else {
          showMessage(result.error?.message || result.message || 'Login failed');
          setLoading(false);
          
          // If CSRF error, try to fetch a fresh token for next attempt
          if (response.status === 403 && result.error?.includes('CSRF')) {
            console.log('CSRF token invalid, attempting to fetch fresh token...');
            await getCsrfToken();
          }
        }
      } catch (error) {
        console.error('Login error:', error);
        showMessage('Network error. Please try again.');
        setLoading(false);
      }
    });

    // Fetch initial CSRF token to ensure session is established
    getCsrfToken().catch(e => console.warn('Failed to initialize CSRF token:', e));
  }

  // Auto-focus username field
  if (usernameField) {
    usernameField.focus();
  }

  // TOTP submit button
  const totpSubmitBtn = document.getElementById('totpSubmitBtn');
  const totpLoading = document.getElementById('totpLoading');
  const totpText = document.getElementById('totpText');
  const totpTokenInput = document.getElementById('totpToken');

  if (totpSubmitBtn) {
    totpSubmitBtn.addEventListener('click', submitTotpCode);
  }
  if (totpTokenInput) {
    totpTokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitTotpCode();
    });
  }

  async function submitTotpCode() {
    const token = totpTokenInput?.value?.trim();
    if (!token || !/^\d{6}$/.test(token)) {
      showMessage('Enter the 6-digit code from your authenticator app.');
      return;
    }
    messageDiv.classList.add('hidden');
    totpLoading.classList.remove('hidden');
    totpText.classList.add('hidden');
    totpSubmitBtn.disabled = true;

    try {
      const csrfToken = await getCsrfToken();
      const response = await fetch('/api/auth/totp-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify({ token })
      });
      const result = await response.json();
      if (result.success) {
        showMessage('Verified! Redirecting...', 'success');
        setTimeout(() => { window.location.href = '/quickconnect'; }, 800);
      } else {
        showMessage(result.error?.message || 'Invalid code. Please try again.');
        totpLoading.classList.add('hidden');
        totpText.classList.remove('hidden');
        totpSubmitBtn.disabled = false;
        if (totpTokenInput) { totpTokenInput.value = ''; totpTokenInput.focus(); }
      }
    } catch (err) {
      showMessage('Network error. Please try again.');
      totpLoading.classList.add('hidden');
      totpText.classList.remove('hidden');
      totpSubmitBtn.disabled = false;
    }
  }

  // Forgot password modal
  const forgotModal = document.getElementById('forgotPasswordModal');
  const forgotLink = document.querySelector('a[href="#forgotPasswordModal"]');
  if (forgotLink && forgotModal) {
    forgotLink.addEventListener('click', function(e) {
      e.preventDefault();
      forgotModal.style.display = 'flex';
      document.getElementById('forgotUsername').focus();
    });
    forgotModal.addEventListener('click', function(e) {
      if (e.target === forgotModal) closeForgotPassword();
    });
  }

  // Close and submit handlers for forgot password
  document.getElementById('closeAnnouncementsBtn')?.addEventListener('click', closeAnnouncements);
  document.getElementById('forgotPasswordForm')?.addEventListener('submit', handleForgotPassword);
  document.getElementById('closeForgotPasswordBtn')?.addEventListener('click', closeForgotPassword);

  // Load announcements on login page
  loadAnnouncements();
});

const showTotpStep = (window.showTotpStep = function() {
  const loginForm = document.getElementById('loginForm');
  const totpStep = document.getElementById('totpStep');
  const messageDiv = document.getElementById('message');
  if (loginForm) loginForm.style.display = 'none';
  if (totpStep) totpStep.style.display = 'block';
  if (messageDiv) messageDiv.classList.add('hidden');
  const totpTokenInput = document.getElementById('totpToken');
  if (totpTokenInput) totpTokenInput.focus();
});

function closeForgotPassword() {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) modal.style.display = 'none';
  document.getElementById('forgotPasswordForm')?.reset();
  const alertDiv = document.getElementById('forgotPasswordAlert');
  if (alertDiv) alertDiv.style.display = 'none';
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const username = document.getElementById('forgotUsername').value;
  const alertDiv = document.getElementById('forgotPasswordAlert');

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const data = await response.json();

    if (data.success) {
      alertDiv.innerHTML = '<div style="background: rgba(16,185,129,0.1); color: #065f46; padding: var(--spacing-md); border-radius: var(--border-radius);">\u2713 Check your email for a password reset link</div>';
      alertDiv.style.display = 'block';
      setTimeout(() => closeForgotPassword(), 3000);
    } else {
      throw new Error(data.message);
    }
  } catch (err) {
    alertDiv.innerHTML = '<div style="background: rgba(239,68,68,0.1); color: #b91c1c; padding: var(--spacing-md); border-radius: var(--border-radius);">\u2717 ' + (err.message || 'Failed to send reset link') + '</div>';
    alertDiv.style.display = 'block';
  }
}

function closeAnnouncements() {
  const banner = document.getElementById('announcementsBanner');
  if (banner) banner.style.display = 'none';
  document.body.classList.remove('has-announcements');
}

async function loadAnnouncements() {
  try {
    const response = await fetch('/api/announcements');
    const data = await response.json();

    if (data.success && data.announcements && data.announcements.length > 0) {
      const container = document.getElementById('announcementsContainer');
      if (!container) return;
      container.innerHTML = data.announcements.map(a => `
        <div style="margin-bottom: var(--spacing-md); padding-bottom: var(--spacing-md); border-bottom: 1px solid #bfdbfe;">
          <h3 style="margin: 0 0 var(--spacing-sm) 0; color: #0066cc; font-size: 1rem;">${a.title || 'Announcement'}</h3>
          <p style="margin: 0; color: #333; font-size: 0.9rem;">${a.message}</p>
        </div>
      `).join('');
      const banner = document.getElementById('announcementsBanner');
      if (banner) banner.style.display = 'block';
      document.body.classList.add('has-announcements');
    }
  } catch (err) {
    console.error('Failed to load announcements:', err);
  }
}
