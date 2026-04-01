/**
 * Account Page - Frontend Logic
 * Handles user account management, security, and preferences
 */

const AccountManager = {
  userId: null,
  csrfToken: null,
  isDirty: false,
  currentPage: 0,
  pageSize: 25,

  /**
   * Initialize the account page
   */
  async init() {
    this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    
    // Load user profile
    await this.loadProfile();
    
    // Load account status
    await this.loadAccountStatus();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Load initial data
    await this.loadSessions();
    await this.loadNotificationPreferences();
  },

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Navigation tabs
    document.querySelectorAll('.account-nav-item').forEach(item => {
      item.addEventListener('click', (e) => this.switchSection(e));
    });

    // Add Contact Method button
    const addContactBtn = document.getElementById('addContactBtn');
    if (addContactBtn) {
      addContactBtn.addEventListener('click', () => this.showAddContactMethodModal());
    }

    // Copy referral link button
    const copyReferralBtn = document.getElementById('copyReferralBtn');
    if (copyReferralBtn) {
      copyReferralBtn.addEventListener('click', () => this.copyReferralLink());
    }

    // Profile form
    ['firstName', 'lastName', 'email', 'displayName'].forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('change', () => {
          document.getElementById('saveProfileBtn').disabled = false;
          this.isDirty = true;
        });
      }
    });
    document.getElementById('saveProfileBtn')?.addEventListener('click', () => this.saveProfile());

    // Password change
    ['currentPassword', 'newPassword', 'confirmPassword'].forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('input', () => this.validatePasswordForm());
      }
    });
    document.getElementById('changePasswordBtn')?.addEventListener('click', () => this.changePassword());

    // Email change
    document.getElementById('email')?.addEventListener('change', () => {
      document.getElementById('saveProfileBtn').disabled = false;
    });

    // Notifications
    document.getElementById('saveNotificationsBtn')?.addEventListener('click', () => this.saveNotificationPreferences());
    document.querySelectorAll('[data-channel-toggle]').forEach(toggle => {
      toggle.addEventListener('change', () => {
        document.getElementById('saveNotificationsBtn').disabled = false;
      });
    });
    document.getElementById('notificationDigest')?.addEventListener('change', () => {
      document.getElementById('saveNotificationsBtn').disabled = false;
    });

    // Generate password (SSO)
    document.getElementById('generatePasswordBtn')?.addEventListener('click', () => this.generateOTP());

    // Data export
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
  },

  /**
   * Switch between account sections
   */
  switchSection(e) {
    e.preventDefault();
    const section = e.currentTarget.dataset.section;

    // Update active nav item
    document.querySelectorAll('.account-nav-item').forEach(item => {
      item.classList.remove('active');
    });
    e.currentTarget.classList.add('active');

    // Update visible sections
    document.querySelectorAll('.account-section').forEach(sec => {
      sec.classList.remove('active');
    });
    document.getElementById(section)?.classList.add('active');
  },

  /**
   * Load user profile data
   */
  async loadProfile() {
    try {
      const response = await fetch('/api/me', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load profile');

      const data = await response.json();
      this.userId = data.user.id;

      // Populate form fields
      document.getElementById('username').value = data.user.name || '';
      document.getElementById('userId').value = data.user.id || '';
      document.getElementById('authMethod').value = this.formatAuthMethod(data.authMethod || 'local');

      // Load local profile if available
      if (data.profile) {
        document.getElementById('firstName').value = data.profile.first_name || '';
        document.getElementById('lastName').value = data.profile.last_name || '';
        document.getElementById('email').value = data.profile.email || '';
        document.getElementById('displayName').value = data.profile.display_name || '';
      }

      // Show/hide password form for SSO users
      if (data.authMethod === 'oidc') {
        document.getElementById('passwordWarning').style.display = 'block';
        document.getElementById('passwordForm').style.display = 'none';
        document.getElementById('otpCard').style.display = 'block';
        this.loadOTPStatus();
      } else {
        document.getElementById('passwordWarning').style.display = 'none';
        document.getElementById('passwordForm').style.display = 'block';
        document.getElementById('otpCard').style.display = 'none';
      }
    } catch (err) {
      this.showError('profile', `Failed to load profile: ${err.message}`);
    }
  },

  /**
   * Save profile changes
   */
  async saveProfile() {
    try {
      const formData = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        displayName: document.getElementById('displayName').value
      };

      const response = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save profile');
      }

      this.showSuccess('profile', 'Profile saved successfully');
      document.getElementById('saveProfileBtn').disabled = true;
      this.isDirty = false;
    } catch (err) {
      this.showError('profile', err.message);
    }
  },

  /**
   * Validate password form and enable button
   */
  validatePasswordForm() {
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    const isValid = current && newPass && confirm && newPass.length >= 8 && newPass === confirm;
    document.getElementById('changePasswordBtn').disabled = !isValid;
  },

  /**
   * Change user password
   */
  async changePassword() {
    try {
      const current = document.getElementById('currentPassword').value;
      const newPass = document.getElementById('newPassword').value;
      const confirm = document.getElementById('confirmPassword').value;

      if (newPass !== confirm) {
        throw new Error('Passwords do not match');
      }

      const response = await fetch('/api/me/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken
        },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: newPass
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to change password');
      }

      this.showSuccess('password', 'Password changed successfully. Please sign in again.');
      
      // Clear form
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmPassword').value = '';
      document.getElementById('changePasswordBtn').disabled = true;

      // Redirect to login after delay
      setTimeout(() => window.location.href = '/login', 2000);
    } catch (err) {
      this.showError('password', err.message);
    }
  },

  /**
   * Load notification preferences
   */
  async loadNotificationPreferences() {
    try {
      const response = await fetch('/api/me/notifications/preferences', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load preferences');

      const data = await response.json();
      const channelsGrid = document.getElementById('availableChannels');
      
      if (!channelsGrid) return;

      channelsGrid.innerHTML = '';

      // Create channel toggle cards
      data.availableChannels.forEach(channel => {
        const pref = data.preferences;
        const isEnabled = pref[`${channel}_enabled`];
        const verified = pref[`${channel}_verified`];

        const card = document.createElement('div');
        card.className = 'channel-card';
        card.innerHTML = `
          <div class="channel-header">
            <h4>${this.getChannelLabel(channel)}</h4>
            <label class="toggle-switch">
              <input type="checkbox" class="channel-toggle" data-channel="${channel}" data-channel-toggle 
                ${isEnabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="channel-description">${this.getChannelDescription(channel)}</p>
          ${verified ? `<span class="badge badge-success">Verified</span>` : ''}
          ${!verified && isEnabled ? `<span class="badge badge-warning">Pending verification</span>` : ''}
        `;

        channelsGrid.appendChild(card);
      });

      // Load digest preference
      if (data.preferences.notification_digest) {
        document.getElementById('notificationDigest').checked = true;
      }
    } catch (err) {
      console.error('Failed to load notification preferences:', err);
    }
  },

  /**
   * Save notification preferences
   */
  async saveNotificationPreferences() {
    try {
      const preferences = {
        email_enabled: true, // Email always on
        telegram_enabled: document.querySelector('[data-channel="telegram"]')?.checked || false,
        discord_enabled: document.querySelector('[data-channel="discord"]')?.checked || false,
        matrix_enabled: document.querySelector('[data-channel="matrix"]')?.checked || false,
        notification_digest: document.getElementById('notificationDigest').checked
      };

      const response = await fetch('/api/me/notifications/preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': this.csrfToken
        },
        body: JSON.stringify({ preferences })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      this.showSuccess('notifications', 'Notification preferences saved');
      document.getElementById('saveNotificationsBtn').disabled = true;
    } catch (err) {
      this.showError('notifications', err.message);
    }
  },

  /**
   * Load active sessions
   */
  async loadSessions() {
    try {
      const response = await fetch('/api/me/sessions', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load sessions');

      const data = await response.json();
      const sessionList = document.getElementById('activeSessions');

      if (!sessionList) return;

      if (data.sessions.length === 0) {
        sessionList.innerHTML = '<p class="no-data">No active sessions found</p>';
        return;
      }

      sessionList.innerHTML = data.sessions.map(session => `
        <div class="session-item">
          <div class="session-info">
            <h4>${this.getDeviceInfo(session.user_agent)}</h4>
            <p class="session-details">
              IP: ${session.ip_address} | Signed in: ${new Date(session.login_time).toLocaleString()}
            </p>
          </div>
          <div class="session-actions">
            ${session.current ? '<span class="badge badge-primary">Current Session</span>' : 
              `<button class="btn btn-sm btn-danger" onclick="AccountManager.terminateSession('${session.session_id}')">
                Logout
              </button>`}
          </div>
        </div>
      `).join('');

      // Load session history
      await this.loadSessionHistory();
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  },

  /**
   * Load session history with pagination
   */
  async loadSessionHistory() {
    try {
      const response = await fetch(`/api/me/login-history?limit=${this.pageSize}&offset=${this.currentPage * this.pageSize}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load history');

      const data = await response.json();
      const tbody = document.getElementById('sessionHistory');

      if (!tbody) return;

      if (data.loginHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data">No login history found</td></tr>';
        return;
      }

      tbody.innerHTML = data.loginHistory.map(entry => `
        <tr>
          <td>${new Date(entry.loginTime).toLocaleString()}</td>
          <td>${entry.logoutTime ? new Date(entry.logoutTime).toLocaleString() : 'Still active'}</td>
          <td>${entry.ipAddress}</td>
          <td>${entry.durationMinutes ? entry.durationMinutes + ' min' : '-'}</td>
          <td><span class="badge ${entry.status === 'active' ? 'badge-success' : 'badge-default'}">${entry.status}</span></td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load login history:', err);
    }
  },

  /**
   * Terminate a session (logout from other device)
   */
  async terminateSession(sessionId) {
    if (!confirm('Log out this session?')) return;

    try {
      const response = await fetch(`/api/me/sessions/${sessionId}/terminate`, {
        method: 'POST',
        headers: {
          'X-CSRF-Token': this.csrfToken
        }
      });

      if (!response.ok) throw new Error('Failed to terminate session');

      this.showSuccess('sessions', 'Session logged out');
      await this.loadSessions();
    } catch (err) {
      this.showError('sessions', err.message);
    }
  },

  /**
   * Load OTP status for SSO accounts
   */
  async loadOTPStatus() {
    try {
      const response = await fetch('/api/me/otp', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return;

      const data = await response.json();
      if (data.hasPassword) {
        document.getElementById('otpStatus').innerHTML = 
          `<p class="alert alert-info">Generated password created on: ${new Date(data.createdAt).toLocaleString()}</p>`;
        document.getElementById('generatePasswordBtn').textContent = 'Regenerate Password';
      }
    } catch (err) {
      console.error('Failed to load OTP status:', err);
    }
  },

  /**
   * Generate OTP for SSO account
   */
  async generateOTP() {
    if (!confirm('Generate a new password? Previous passwords will no longer work.')) return;

    try {
      const response = await fetch('/api/me/otp', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': this.csrfToken
        }
      });

      if (!response.ok) throw new Error('Failed to generate password');

      const data = await response.json();
      
      // Show password in alert so user can copy it
      alert(`Your app password has been generated. It will not be shown again:\n\n${data.password}\n\nCopy this password before closing this dialog.`);
      
      this.loadOTPStatus();
    } catch (err) {
      this.showError('otp', err.message);
    }
  },

  /**
   * Load account status (expiry, contact methods, referral)
   */
  async loadAccountStatus() {
    try {
      const response = await fetch('/api/user/account-status', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) throw new Error('Failed to load account status');

      const data = await response.json();
      if (data.success && data.accountStatus) {
        this.displayAccountStatus(data.accountStatus);
      }
    } catch (err) {
      console.error('Failed to load account status:', err);
    }
  },

  /**
   * Display account status information
   */
  displayAccountStatus(status) {
    // Update account status card
    const accountStatusValue = document.getElementById('accountStatusValue');
    const accountStatusMessage = document.getElementById('accountStatusMessage');
    
    if (accountStatusValue) {
      accountStatusValue.textContent = status.expiry.status === 'expired' ? 'Expired' : 'Active';
      accountStatusValue.className = `account-expiry-${status.expiry.status === 'expired' ? 'expired' : 'active'}`;
    }

    if (accountStatusMessage) {
      accountStatusMessage.textContent = status.expiry.message;
    }

    // Update expiry card
    const expiryDateValue = document.getElementById('expiryDateValue');
    const expiryDaysValue = document.getElementById('expiryDaysValue');

    if (status.expiry.expiresAt) {
      const expiryDate = new Date(status.expiry.expiresAt);
      if (expiryDateValue) {
        expiryDateValue.textContent = expiryDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });
        
        // Color code based on days remaining
        if (status.expiry.daysRemaining > 30) {
          expiryDateValue.className = 'card-value account-expiry-active';
        } else if (status.expiry.daysRemaining > 7) {
          expiryDateValue.className = 'card-value account-expiry-warning';
        } else if (status.expiry.daysRemaining > 0) {
          expiryDateValue.className = 'card-value account-expiry-warning';
        } else {
          expiryDateValue.className = 'card-value account-expiry-expired';
        }
      }

      if (expiryDaysValue) {
        expiryDaysValue.textContent = `${status.expiry.daysRemaining} days remaining`;
        if (status.expiry.daysRemaining <= 0) {
          expiryDaysValue.textContent = 'Your account has expired';
        }
      }
    } else {
      if (expiryDateValue) expiryDateValue.textContent = 'No expiry';
      if (expiryDaysValue) expiryDaysValue.textContent = 'Your account does not expire';
    }

    // Update verified contacts count
    const verifiedContactsCount = document.getElementById('verifiedContactsCount');
    if (verifiedContactsCount && status.verifiedMethods) {
      verifiedContactsCount.textContent = status.verifiedMethods.length;
    }

    // Display contact methods
    this.displayContactMethods(status.contactMethods);

    // Display referral info if enabled
    if (status.referral && status.referral.enabled) {
      this.displayReferralInfo(status.referral);
    }

    // Update account information
    if (status.profile) {
      const createdDate = document.getElementById('accountCreatedDate');
      const lastLogin = document.getElementById('lastLoginDate');
      
      if (status.profile.created_date && createdDate) {
        const created = new Date(status.profile.created_date);
        createdDate.textContent = created.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      if (status.profile.last_login && lastLogin) {
        const lastLoginDate = new Date(status.profile.last_login);
        lastLogin.textContent = lastLoginDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
  },

  /**
   * Display contact methods
   */
  displayContactMethods(contactMethods) {
    const contactMethodsList = document.getElementById('contactMethodsList');
    if (!contactMethodsList) return;

    const methods = ['email', 'discord', 'telegram', 'matrix'];
    const icons = {
      email: 'fa-envelope',
      discord: 'fa-discord',
      telegram: 'fa-telegram',
      matrix: 'fa-cube'
    };

    const labels = {
      email: 'Email',
      discord: 'Discord',
      telegram: 'Telegram',
      matrix: 'Matrix'
    };

    contactMethodsList.innerHTML = '';

    methods.forEach(method => {
      const data = contactMethods[method];
      if (!data) return;

      const statusClass = data.verified ? 'verified' : (data.enabled ? 'unverified' : 'disabled');
      const statusText = data.verified ? '✓ Verified' : (data.enabled ? 'Pending' : 'Disabled');
      const icon = icons[method];

      const card = document.createElement('div');
      card.className = 'contact-method-item';
      card.innerHTML = `
        <div class="contact-method-header">
          <div class="contact-method-title">
            <i class="fas ${icon}"></i>
            <span>${labels[method]}</span>
          </div>
          <span class="contact-method-status ${statusClass}">
            ${statusText}
          </span>
        </div>
        ${data.enabled && method !== 'email' ? `
          <div class="contact-method-info">
            ${method === 'discord' ? `Discord ID: ${data.userId || 'Not set'}` : ''}
            ${method === 'telegram' ? `Chat ID: ${data.chatId || 'Not set'}` : ''}
            ${method === 'matrix' ? `Matrix ID: ${data.userId || 'Not set'}` : ''}
          </div>
        ` : ''}
        <div class="contact-method-actions">
          ${method !== 'email' ? `
            ${!data.enabled ? `<button class="btn btn-secondary btn-sm" onclick="AccountManager.enableContactMethod('${method}')"><i class="fas fa-plus"></i> Enable</button>` : ''}
            ${data.enabled && !data.verified ? `<button class="btn btn-primary btn-sm" onclick="AccountManager.verifyContactMethod('${method}')"><i class="fas fa-check"></i> Verify</button>` : ''}
            ${data.enabled ? `<button class="btn btn-danger btn-sm" onclick="AccountManager.removeContactMethod('${method}')"><i class="fas fa-trash"></i> Remove</button>` : ''}
          ` : ''}
        </div>
      `;

      contactMethodsList.appendChild(card);
    });
  },

  /**
   * Display referral information
   */
  displayReferralInfo(referral) {
    const referralCard = document.getElementById('referralCard');
    if (!referralCard) return;

    referralCard.style.display = 'block';

    const referralLink = document.getElementById('referralLink');
    const referralCode = document.getElementById('referralCode');
    const referralCount = document.getElementById('referralCount');

    if (referralLink) referralLink.value = referral.referralLink || '';
    if (referralCode) referralCode.value = referral.referralCode || '';
    if (referralCount) referralCount.textContent = referral.referralsUsed || 0;
  },

  /**
   * Copy referral link to clipboard
   */
  async copyReferralLink() {
    const referralLink = document.getElementById('referralLink');
    if (!referralLink) return;

    try {
      await navigator.clipboard.writeText(referralLink.value);
      this.showSuccess('referral', 'Referral link copied to clipboard');
      
      // Reset button text
      const btn = document.getElementById('copyReferralBtn');
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
          btn.innerHTML = originalText;
        }, 2000);
      }
    } catch (err) {
      this.showError('referral', 'Failed to copy to clipboard');
    }
  },

  /**
   * Show modal to add a new contact method
   */
  async showAddContactMethodModal() {
    this._showContactMethodModal(null);
  },

  /**
   * Enable a contact method — open the add-contact modal pre-selecting the given method.
   */
  async enableContactMethod(method) {
    this._showContactMethodModal(method);
  },

  /**
   * Internal: renders a lightweight inline modal for adding a contact method.
   * @param {string|null} preselect - 'discord', 'telegram', 'matrix', or null
   */
  _showContactMethodModal(preselect) {
    // Remove any existing modal
    document.getElementById('_cmModal')?.remove();

    const labels = { discord: 'Discord User ID', telegram: 'Telegram Chat ID', matrix: 'Matrix User ID (@user:server)' };
    const placeholders = { discord: 'e.g. 123456789012345678', telegram: 'e.g. -100123456789', matrix: 'e.g. @you:matrix.org' };

    const modal = document.createElement('div');
    modal.id = '_cmModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--card-bg,#1e1e2e);border-radius:12px;padding:32px;min-width:340px;max-width:460px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 16px;font-size:1.1rem;">Add Contact Method</h3>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:6px;font-size:.875rem;">Method</label>
          <select id="_cmMethod" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color,#333);background:var(--input-bg,#2a2a3a);color:inherit;">
            <option value="discord" ${preselect === 'discord' ? 'selected' : ''}>Discord</option>
            <option value="telegram" ${preselect === 'telegram' ? 'selected' : ''}>Telegram</option>
            <option value="matrix" ${preselect === 'matrix' ? 'selected' : ''}>Matrix</option>
          </select>
        </div>
        <div style="margin-bottom:20px;">
          <label id="_cmIdLabel" style="display:block;margin-bottom:6px;font-size:.875rem;">${labels[preselect || 'discord']}</label>
          <input id="_cmContactId" type="text" placeholder="${placeholders[preselect || 'discord']}"
            style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid var(--border-color,#333);background:var(--input-bg,#2a2a3a);color:inherit;box-sizing:border-box;">
        </div>
        <div id="_cmError" style="color:var(--danger,#e53e3e);font-size:.875rem;margin-bottom:12px;display:none;"></div>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button id="_cmCancelBtn" class="btn btn-secondary">Cancel</button>
          <button id="_cmSaveBtn" class="btn btn-primary">Add &amp; Send Code</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const methodSel = modal.querySelector('#_cmMethod');
    const idInput = modal.querySelector('#_cmContactId');
    const label = modal.querySelector('#_cmIdLabel');
    const errEl = modal.querySelector('#_cmError');

    methodSel.addEventListener('change', () => {
      const m = methodSel.value;
      label.textContent = labels[m];
      idInput.placeholder = placeholders[m];
    });

    modal.querySelector('#_cmCancelBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelector('#_cmSaveBtn').addEventListener('click', async () => {
      const method = methodSel.value;
      const contactId = idInput.value.trim();
      if (!contactId) { errEl.textContent = 'Please enter a contact ID.'; errEl.style.display = ''; return; }
      errEl.style.display = 'none';
      const saveBtn = modal.querySelector('#_cmSaveBtn');
      saveBtn.disabled = true; saveBtn.textContent = 'Sending...';

      try {
        const resp = await fetch('/api/contact-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrfToken },
          body: JSON.stringify({ method, contactId })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Failed to add contact method');

        modal.remove();
        // Show verification code input
        this._showVerifyModal(method, data.verification.id);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        saveBtn.disabled = false; saveBtn.textContent = 'Add & Send Code';
      }
    });
  },

  /**
   * Verify a contact method that is pending verification.
   * Re-sends a new verification code by re-registering the method.
   */
  async verifyContactMethod(method) {
    // Fetch raw contact methods to get the stored ID
    try {
      const resp = await fetch('/api/contact-methods');
      const data = await resp.json();
      if (!data.success) throw new Error('Failed to load contact methods');

      const idMap = {
        discord: data.methods?.discord_user_id,
        telegram: data.methods?.telegram_chat_id,
        matrix: data.methods?.matrix_user_id
      };
      const contactId = idMap[method];

      if (!contactId) {
        this.showError('contact', `No ${method} ID found. Please add the method first.`);
        return;
      }

      // Re-POST to get a fresh verification code
      const postResp = await fetch('/api/contact-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrfToken },
        body: JSON.stringify({ method, contactId })
      });
      const postData = await postResp.json();
      if (!postData.success) throw new Error(postData.error || 'Failed to send verification');

      this._showVerifyModal(method, postData.verification.id);
    } catch (err) {
      this.showError('contact', err.message);
    }
  },

  /**
   * Show inline verification code modal.
   */
  _showVerifyModal(method, verificationId) {
    document.getElementById('_vfModal')?.remove();

    const modal = document.createElement('div');
    modal.id = '_vfModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--card-bg,#1e1e2e);border-radius:12px;padding:32px;min-width:320px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 12px;font-size:1.1rem;">Verify ${method.charAt(0).toUpperCase() + method.slice(1)}</h3>
        <p style="color:var(--text-secondary);font-size:.875rem;margin:0 0 16px;">
          A 6-digit code has been sent to your ${method} account. Enter it below.
        </p>
        <div style="margin-bottom:16px;">
          <input id="_vfCode" type="text" inputmode="numeric" maxlength="6" placeholder="000000"
            style="width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border-color,#333);background:var(--input-bg,#2a2a3a);color:inherit;font-size:1.25rem;text-align:center;letter-spacing:.3em;box-sizing:border-box;">
        </div>
        <div id="_vfError" style="color:var(--danger,#e53e3e);font-size:.875rem;margin-bottom:12px;display:none;"></div>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button id="_vfCancelBtn" class="btn btn-secondary">Cancel</button>
          <button id="_vfVerifyBtn" class="btn btn-primary">Verify</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.querySelector('#_vfCode').focus();

    const errEl = modal.querySelector('#_vfError');
    modal.querySelector('#_vfCancelBtn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    const doVerify = async () => {
      const code = modal.querySelector('#_vfCode').value.trim();
      if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code.'; errEl.style.display = ''; return; }
      errEl.style.display = 'none';
      const btn = modal.querySelector('#_vfVerifyBtn');
      btn.disabled = true; btn.textContent = 'Verifying...';

      try {
        const resp = await fetch('/api/contact-methods/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrfToken },
          body: JSON.stringify({ verificationId, code })
        });
        const data = await resp.json();
        if (!data.success) throw new Error(data.error || 'Verification failed');

        modal.remove();
        this.showSuccess('contact', `${method.charAt(0).toUpperCase() + method.slice(1)} verified successfully!`);
        await this.loadAccountStatus();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        btn.disabled = false; btn.textContent = 'Verify';
      }
    };

    modal.querySelector('#_vfVerifyBtn').addEventListener('click', doVerify);
    modal.querySelector('#_vfCode').addEventListener('keydown', e => { if (e.key === 'Enter') doVerify(); });
  },

  /**
   * Remove a contact method.
   */
  async removeContactMethod(method) {
    if (!confirm(`Remove ${method} contact method?`)) return;

    try {
      const resp = await fetch(`/api/contact-methods/${encodeURIComponent(method)}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': this.csrfToken }
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error || 'Failed to remove contact method');

      this.showSuccess('contact', `${method.charAt(0).toUpperCase() + method.slice(1)} removed.`);
      await this.loadAccountStatus();
    } catch (err) {
      this.showError('contact', err.message);
    }
  },

  /**
   * Helper: Show success message
   */
  showSuccess(section, message) {
    const statusEl = document.getElementById(`${section}Status`);
    if (statusEl) {
      statusEl.className = 'form-status success';
      statusEl.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
      setTimeout(() => statusEl.innerHTML = '', 5000);
    }
  },

  /**
   * Helper: Show error message
   */
  showError(section, message) {
    const statusEl = document.getElementById(`${section}Status`);
    if (statusEl) {
      statusEl.className = 'form-status error';
      statusEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    }
  },

  /**
   * Helper: Format authentication method display
   */
  formatAuthMethod(method) {
    const methods = {
      'oidc': 'Single Sign-On (OIDC)',
      'local': 'Local Account',
      'ldap': 'LDAP'
    };
    return methods[method] || method;
  },

  /**
   * Helper: Get channel label
   */
  getChannelLabel(channel) {
    const labels = {
      'email': '✉️ Email',
      'discord': '<i class="fab fa-discord"></i> Discord',
      'telegram': '📱 Telegram',
      'matrix': '🔐 Matrix'
    };
    return labels[channel] || channel;
  },

  /**
   * Helper: Get channel description
   */
  getChannelDescription(channel) {
    const descriptions = {
      'email': 'Receive notifications via email',
      'discord': 'Receive notifications in Discord direct messages',
      'telegram': 'Receive notifications via Telegram bot',
      'matrix': 'Receive notifications via Matrix client'
    };
    return descriptions[channel] || '';
  },

  /**
   * Helper: Extract device info from user agent
   */
  getDeviceInfo(userAgent) {
    if (!userAgent) return 'Unknown Device';
    
    if (userAgent.includes('Chrome')) return '🔵 Chrome';
    if (userAgent.includes('Firefox')) return '🔥 Firefox';
    if (userAgent.includes('Safari')) return '🧭 Safari';
    if (userAgent.includes('Edge')) return '🌐 Edge';
    if (userAgent.includes('Mobile')) return '📱 Mobile';
    return '💻 Other Device';
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  AccountManager.init();

  // Account deletion button
  document.getElementById('requestDeletionBtn')?.addEventListener('click', () => {
    alert('Please contact an administrator to delete your account.');
  });

  // Renewal section (only active when window._renewalConfig is set)
  const renewalConfig = window._renewalConfig;
  if (renewalConfig) {
    const observer = new MutationObserver(() => {
      const daysEl = document.getElementById('expiryDaysValue');
      if (!daysEl) return;
      const match = daysEl.textContent.match(/^(-?\d+)/);
      if (match) {
        const days = parseInt(match[1]);
        const section = document.getElementById('renewalSection');
        const msg = document.getElementById('renewalMessage');
        if (section) {
          if (days <= renewalConfig.windowDays) {
            section.style.display = '';
            if (msg) {
              msg.textContent = days < 0
                ? 'Your account has expired. Contact the server administrator or request a renewal.'
                : `Your account expires in ${days} day${days === 1 ? '' : 's'}. Request a renewal from the server administrator.`;
            }
          } else {
            section.style.display = 'none';
          }
        }
      }
    });
    const target = document.getElementById('expiryDaysValue');
    if (target) observer.observe(target, { characterData: true, childList: true, subtree: true });

    document.getElementById('renewalRequestBtn')?.addEventListener('click', submitRenewalRequest);
  }
});

async function submitRenewalRequest() {
  const btn = document.getElementById('renewalRequestBtn');
  const statusEl = document.getElementById('renewalStatus');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Sending request...';
  try {
    const resp = await fetch('/api/user/renewal-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': window._renewalConfig?.csrfToken || document.querySelector('meta[name="csrf-token"]')?.content || ''
      }
    });
    const data = await resp.json();
    if (data.success) {
      if (statusEl) { statusEl.textContent = '\u2705 ' + data.message; statusEl.style.color = 'var(--success)'; }
      if (btn) btn.style.display = 'none';
    } else {
      if (statusEl) { statusEl.textContent = '\u274c ' + (data.error || 'Failed to send request'); statusEl.style.color = 'var(--danger)'; }
      if (btn) btn.disabled = false;
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '\u274c ' + e.message; statusEl.style.color = 'var(--danger)'; }
    if (btn) btn.disabled = false;
  }
}
