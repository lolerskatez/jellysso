// Login Form Handler
document.addEventListener('DOMContentLoaded', function() {
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginLoading = document.getElementById('loginLoading');
  const loginText = document.getElementById('loginText');
  const messageDiv = document.getElementById('message');
  const usernameField = document.getElementById('username');

  function showMessage(message, type = 'error') {
    messageDiv.style.display = 'flex';
    messageDiv.className = `alert ${type}`;
    const icon = type === 'success' ? 'check-circle' : 'exclamation-circle';
    messageDiv.innerHTML = `
      <i class="fas fa-${icon}"></i>
      <span>${message}</span>
    `;
  }

  function setLoading(loading) {
    if (loading) {
      loginLoading.style.display = 'inline-flex';
      loginText.style.display = 'none';
      loginBtn.disabled = true;
    } else {
      loginLoading.style.display = 'none';
      loginText.style.display = 'inline';
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
      messageDiv.style.display = 'none';
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

        if (result.success) {
          showMessage('Login successful! Redirecting...', 'success');
          setTimeout(() => {
            window.location.href = '/quickconnect';
          }, 1000);
        } else {
          showMessage(result.message || 'Login failed');
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
});
