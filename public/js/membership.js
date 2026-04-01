/**
 * Membership Page - Frontend Logic
 * Handles profile, password, and Jellyfin SSO password management
 */

const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
const { isOidc: IS_OIDC, userId: USER_ID, currentUsername: CURRENT_USERNAME } = window._MEMBERSHIP_CONFIG || {};

function showAlert(containerId, message, type) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type} show`;
  setTimeout(() => { el.classList.remove('show'); }, 5000);
}

/* ── Save Profile ─────────────────────────────────────── */
async function saveProfile(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;

  const body = {
    firstName:    document.getElementById('firstName').value.trim(),
    lastName:     document.getElementById('lastName').value.trim(),
    displayName:  document.getElementById('displayName').value.trim(),
    email:        document.getElementById('email').value.trim()
  };

  if (!IS_OIDC) {
    body.jellyfinUsername = document.getElementById('jellyfinUsername').value.trim();
  }

  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    showAlert('profileAlert', 'Please enter a valid email address.', 'error');
    btn.disabled = false;
    return;
  }

  try {
    const res = await fetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      showAlert('profileAlert', 'Profile saved successfully.', 'success');
      if (!IS_OIDC && body.jellyfinUsername && body.jellyfinUsername !== CURRENT_USERNAME) {
        showAlert('globalAlert', 'Username changed — you will be logged out shortly.', 'success');
        setTimeout(() => { window.location.href = '/login'; }, 2500);
      }
    } else {
      showAlert('profileAlert', data.message || 'Failed to save profile.', 'error');
    }
  } catch (err) {
    showAlert('profileAlert', 'Network error — please try again.', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ── Change Password ──────────────────────────────────── */
async function changePassword(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const newPw  = document.getElementById('newPassword').value;
  const confPw = document.getElementById('confirmPassword').value;

  if (newPw.length < 8) {
    showAlert('passwordAlert', 'New password must be at least 8 characters.', 'error');
    return;
  }
  if (newPw !== confPw) {
    showAlert('passwordAlert', 'Passwords do not match.', 'error');
    return;
  }

  btn.disabled = true;
  try {
    const res = await fetch('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN },
      body: JSON.stringify({
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: newPw
      })
    });
    const data = await res.json();
    if (data.success) {
      showAlert('passwordAlert', 'Password updated successfully.', 'success');
      resetPasswordForm();
    } else {
      showAlert('passwordAlert', data.message || 'Failed to update password.', 'error');
    }
  } catch (err) {
    showAlert('passwordAlert', 'Network error — please try again.', 'error');
  } finally {
    btn.disabled = false;
  }
}

function resetPasswordForm() {
  document.getElementById('passwordForm').reset();
  document.getElementById('strengthBar').style.width = '0%';
  document.getElementById('strengthLabel').textContent = '';
}

/* ── Password strength meter ─────────────────────────── */
function checkPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw))   score++;
  if (/[0-9]/.test(pw))   score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const bar   = document.getElementById('strengthBar');
  const label = document.getElementById('strengthLabel');
  const levels = [
    { w: '20%',  bg: '#ef4444', text: 'Very weak'  },
    { w: '40%',  bg: '#f97316', text: 'Weak'       },
    { w: '60%',  bg: '#eab308', text: 'Fair'       },
    { w: '80%',  bg: '#22c55e', text: 'Good'       },
    { w: '100%', bg: '#16a34a', text: 'Strong'     }
  ];
  const level = levels[Math.min(score, 4)];
  bar.style.width      = pw.length ? level.w  : '0%';
  bar.style.background = pw.length ? level.bg : '';
  label.textContent    = pw.length ? level.text : '';
}

/* ── Generated Jellyfin Password (SSO users only) ──────── */
function _otpShowState(state) { // 'none' | 'new' | 'active'
  document.getElementById('otpStateNone').style.display   = state === 'none'   ? '' : 'none';
  document.getElementById('otpStateNew').style.display    = state === 'new'    ? '' : 'none';
  document.getElementById('otpStateActive').style.display = state === 'active' ? '' : 'none';
}

async function generateOTP() {
  const btn = document.getElementById('generateOtpBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/me/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF_TOKEN }
    });
    const data = await res.json();
    if (!data.success) {
      showAlert('otpAlert', data.message || 'Failed to generate password.', 'error');
      return;
    }
    document.getElementById('otpCodeText').textContent = data.password;
    _otpShowState('new');
  } catch (err) {
    showAlert('otpAlert', 'Network error — please try again.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyOTP() {
  const code = document.getElementById('otpCodeText')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    showAlert('otpAlert', 'Password copied to clipboard.', 'success');
  }).catch(() => {
    showAlert('otpAlert', `Password: ${code}`, 'success');
  });
}

function dismissOTP() {
  _otpShowState('active');
}

// Wire up event listeners and run OTP check
document.addEventListener('DOMContentLoaded', function () {
  // Mobile sidebar toggle
  const mobileToggle = document.getElementById('mobileMenuToggle');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('open');
      document.getElementById('sidebarOverlay')?.classList.toggle('active');
    });
  }

  document.getElementById('profileForm')?.addEventListener('submit', saveProfile);
  document.getElementById('passwordForm')?.addEventListener('submit', changePassword);
  document.getElementById('newPassword')?.addEventListener('input', (e) => checkPasswordStrength(e.target.value));
  document.getElementById('cancelPasswordBtn')?.addEventListener('click', resetPasswordForm);
  document.getElementById('generateOtpBtn')?.addEventListener('click', generateOTP);
  document.getElementById('copyOtpBtn')?.addEventListener('click', copyOTP);
  document.getElementById('dismissOtpBtn')?.addEventListener('click', dismissOTP);
  document.getElementById('regenerateOtpBtn')?.addEventListener('click', generateOTP);

  if (IS_OIDC) {
    (async () => {
      try {
        const res = await fetch('/api/me/otp');
        const data = await res.json();
        if (data.hasPassword) {
          const el = document.getElementById('otpCreatedText');
          if (el && data.createdAt) {
            el.textContent = new Date(data.createdAt).toLocaleDateString();
          }
          _otpShowState('active');
        } else {
          _otpShowState('none');
        }
      } catch (_) {
        _otpShowState('none');
      }
    })();
  }
});
