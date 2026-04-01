// Get token from URL
const params = new URLSearchParams(window.location.search);
const token = params.get('token');

if (!token) {
  showAlert('Invalid or missing reset token. <a href="/login">Back to login</a>', 'error');
  document.getElementById('formContainer').style.display = 'none';
} else {
  // Validate token immediately
  validateToken();
}

function showAlert(message, type) {
  const alertEl = document.getElementById('alert');
  alertEl.innerHTML = message;
  alertEl.className = `alert show alert-${type}`;
  if (type === 'success') {
    setTimeout(() => {
      window.location.href = '/login';
    }, 2000);
  }
}

function checkPasswordStrength(password) {
  const bar = document.getElementById('strengthBar');
  const hint = document.getElementById('strengthHint');

  let strength = 0;
  if (password.length >= 8) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  const widths = ['0%', '20%', '40%', '60%', '80%', '100%'];
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];
  const hints = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];

  bar.style.width = widths[Math.min(strength, 5)];
  bar.style.background = colors[Math.min(strength - 1, 4)] || '#ef4444';
  hint.textContent = hints[strength] || '';
}

async function validateToken() {
  try {
    const response = await fetch(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`);
    const data = await response.json();

    if (!data.valid) {
      showAlert('This reset link has expired or is invalid. <a href="/login">Request a new one</a>', 'error');
      document.getElementById('formContainer').style.display = 'none';
    }
  } catch (err) {
    showAlert('Failed to validate reset link. ' + err.message, 'error');
    document.getElementById('formContainer').style.display = 'none';
  }
}

async function handleReset(event) {
  event.preventDefault();

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword.length < 8) {
    showAlert('Password must be at least 8 characters', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showAlert('Passwords do not match', 'error');
    return;
  }

  document.getElementById('formContainer').style.display = 'none';
  document.getElementById('loadingContainer').style.display = 'block';

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        newPassword
      })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Password reset successful! Redirecting to login...', 'success');
    } else {
      throw new Error(data.message || 'Password reset failed');
    }
  } catch (err) {
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('formContainer').style.display = 'block';
    showAlert(err.message, 'error');
  }
}

// Add password strength checking
document.getElementById('newPassword')?.addEventListener('input', (e) => {
  checkPasswordStrength(e.target.value);
});
document.getElementById('resetForm')?.addEventListener('submit', handleReset);
