const inviteCode = new URLSearchParams(window.location.search).get('invite');

// Password policy fetched from server on load
let passwordPolicy = { minLength: 8, requireUppercase: false, requireNumbers: false, requireSpecial: false };

if (!inviteCode) {
  showAlert('error', 'This link is incomplete. Please use the full signup link from your invite.');
  document.getElementById('signupForm').style.display = 'none';
  document.getElementById('loadingContainer').style.display = 'none';
}

// Validate invite on page load
async function validateInvite() {
  try {
    // Fetch password policy in parallel with invite validation
    const [inviteResponse, policyResponse] = await Promise.all([
      fetch(`/api/invites/${inviteCode}`),
      fetch('/api/auth/password-policy')
    ]);
    const data = await inviteResponse.json();

    if (!data.success) {
      showAlert('error', data.error || 'Invalid invite code');
      return;
    }

    // Store the policy globally
    if (policyResponse.ok) {
      passwordPolicy = await policyResponse.json();
    }

    // Render policy requirements hint
    const policyHints = [];
    if (passwordPolicy.minLength > 8) policyHints.push(`At least ${passwordPolicy.minLength} characters`);
    if (passwordPolicy.requireUppercase) policyHints.push('One uppercase letter (A–Z)');
    if (passwordPolicy.requireNumbers)   policyHints.push('One number (0–9)');
    if (passwordPolicy.requireSpecial)   policyHints.push('One special character');
    if (policyHints.length) {
      const el = document.getElementById('passwordError');
      if (el) {
        el.textContent = 'Requirements: ' + policyHints.join(' · ');
        el.style.color = 'var(--text-muted)';
        el.style.display = 'block';
      }
    }

    // Load signup profile
    await loadSignupProfile(data.invite.signupProfileId);
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';

    // Track that this page was viewed
    await fetch(`/api/invites/${inviteCode}/usage-stats`);

  } catch (error) {
    showAlert('error', 'Failed to validate invite. Please try again.');
  }
}

// Load signup profile details
async function loadSignupProfile(profileId) {
  try {
    const response = await fetch(`/api/signup-profiles/${profileId}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error('Profile not found');
    }

    const profile = data.profile;
    const details = document.getElementById('profileDetails');

    let html = `
      <div class="profile-info-item"><strong>${profile.name}</strong></div>
      <div class="profile-info-item">${profile.description || 'Standard account'}</div>
    `;

    if (profile.jellyfinTier) {
      html += `<div class="profile-info-item">Tier: <strong>${profile.jellyfinTier}</strong></div>`;
    }

    if (profile.jellyfinLibraryAccess) {
      const libraries = Array.isArray(profile.jellyfinLibraryAccess)
        ? profile.jellyfinLibraryAccess.join(', ')
        : 'All';
      html += `<div class="profile-info-item">Access: <strong>${libraries}</strong></div>`;
    }

    details.innerHTML = html;

    // Store profile in session for later
    window.signupProfile = profile;

  } catch (error) {
    showAlert('error', 'Failed to load profile information');
  }
}

// Password strength checker
document.getElementById('password').addEventListener('input', function () {
  const password = this.value;
  let strength = 0;

  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;

  const strengthPercentages = [20, 40, 60, 80, 100];
  const strengthTexts = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const strengthColors = ['#d32f2f', '#f57c00', '#fbc02d', '#388e3c', '#1976d2'];

  strength = Math.min(strength, 5);
  const bar = document.getElementById('strengthBar');
  bar.style.width = strengthPercentages[strength - 1] + '%';
  bar.style.backgroundColor = strengthColors[strength - 1];
  document.getElementById('strengthText').textContent = strengthTexts[strength - 1];
  document.getElementById('strengthText').style.color = strengthColors[strength - 1];
});

// Form submission
document.getElementById('signupForm').addEventListener('submit', async function (e) {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  // Validation
  let hasError = false;

  if (!username) {
    showFieldError('usernameError', 'Username is required');
    hasError = true;
  }

  if (password.length < 8) {
    showFieldError('passwordError', 'Password must be at least 8 characters');
    hasError = true;
  }

  if (password !== confirmPassword) {
    showFieldError('confirmPasswordError', 'Passwords do not match');
    hasError = true;
  }

  if (hasError) return;

  // Collect CAPTCHA token if enabled
  let captchaToken = null;
  const captchaConfig = window.CAPTCHA_CONFIG || {};
  if (captchaConfig.enabled) {
    if (captchaConfig.provider === 'recaptcha') {
      captchaToken = typeof grecaptcha !== 'undefined' ? grecaptcha.getResponse() : null;
    } else {
      captchaToken = typeof hcaptcha !== 'undefined' ? hcaptcha.getResponse() : null;
    }
    if (!captchaToken) {
      showAlert('error', 'Please complete the CAPTCHA before signing up.');
      return;
    }
  }

  // Submit to signup endpoint
  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  const originalText = submitBtn.textContent;
  submitBtn.innerHTML = '<span class="loading"></span> Creating account...';

  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email: email || null,
        password,
        inviteCode,
        captchaToken
      })
    });

    const data = await response.json();

    if (!data.success) {
      showAlert('error', data.error || 'Failed to create account');
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }

    // Accept the invite
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    await fetch(`/api/invites/${inviteCode}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ userId: data.user.id })
    });

    // Success!
    showAlert('success', 'Account created! Redirecting to login...');
    setTimeout(() => {
      window.location.href = '/login';
    }, 2000);

  } catch (error) {
    showAlert('error', error.message || 'An error occurred');
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

function showAlert(type, message) {
  const container = document.getElementById('alertContainer');
  const alertClass = type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-warning';
  container.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
}

function showFieldError(fieldId, message) {
  document.getElementById(fieldId).textContent = message;
  document.getElementById(fieldId).style.display = 'block';
}

// Clear field errors on input
['username', 'email', 'password', 'confirmPassword'].forEach(field => {
  document.getElementById(field).addEventListener('input', function () {
    const errorId = this.id + 'Error';
    const errorEl = document.getElementById(errorId);
    if (errorEl) errorEl.style.display = 'none';
  });
});

// Validate invite on load
validateInvite();
