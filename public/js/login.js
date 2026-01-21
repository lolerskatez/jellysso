// Login Form Handler
document.addEventListener('DOMContentLoaded', function() {
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginLoading = document.getElementById('loginLoading');
  const loginText = document.getElementById('loginText');
  const messageDiv = document.getElementById('message');
  const usernameField = document.getElementById('username');

  function showMessage(message, type = 'error') {
    messageDiv.style.display = 'block';
    messageDiv.className = `alert alert-${type}`;
    const icon = type === 'success' ? 'check-circle' : 'exclamation-circle';
    messageDiv.innerHTML = `
      <i class="fas fa-${icon}"></i>
      <div style="flex: 1;">${message}</div>
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

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      messageDiv.style.display = 'none';
      setLoading(true);

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-csrf-token': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
          },
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
        }
      } catch (error) {
        showMessage('Network error. Please try again.');
        setLoading(false);
      }
    });
  }

  // Auto-focus username field
  if (usernameField) {
    usernameField.focus();
  }
});
