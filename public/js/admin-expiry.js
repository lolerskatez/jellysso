async function loadStats() {
  try {
    const response = await fetch('/api/users/expiry/stats');
    const data = await response.json();

    if (data.success) {
      document.getElementById('statTotal').textContent = data.stats.totalWithExpiry || 0;
      document.getElementById('statActive').textContent = data.stats.active || 0;
      document.getElementById('statExpiring').textContent = data.stats.expiringWithin7Days || 0;
      document.getElementById('statExpired').textContent = data.stats.expired || 0;
    }
  } catch (error) {
    showAlert('Failed to load statistics: ' + error.message, 'error');
  }
}

async function loadExpiringUsers() {
  try {
    const response = await fetch('/api/users/expiry?filter=expiring_soon');
    const data = await response.json();

    document.getElementById('expiringLoading').style.display = 'none';

    if (data.success) {
      populateExpiringTable(data.users);
    } else {
      showAlert('Failed to load expiring users', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

async function loadExpiredUsers() {
  try {
    const response = await fetch('/api/users/expiry?filter=expired');
    const data = await response.json();

    document.getElementById('expiredLoading').style.display = 'none';

    if (data.success) {
      populateExpiredTable(data.users);
    } else {
      showAlert('Failed to load expired users', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

function populateExpiringTable(users) {
  const tbody = document.getElementById('expiringTableBody');
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: var(--spacing-2xl);">No users expiring soon</td></tr>';
    return;
  }

  users.forEach(user => {
    const expiresDate = new Date(user.expiresAt);
    const now = new Date();
    const daysRemaining = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.username || user.id}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${expiresDate.toLocaleDateString()}</td>
      <td><span class="days-remaining ${daysRemaining <= 3 ? 'critical' : ''}">${daysRemaining} days</span></td>
      <td>
        <button class="btn-small btn-action" data-clear-expiry="${user.id}">Clear Expiry</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function populateExpiredTable(users) {
  const tbody = document.getElementById('expiredTableBody');
  tbody.innerHTML = '';

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: var(--spacing-2xl);">No expired users</td></tr>';
    return;
  }

  users.forEach(user => {
    const expiredDate = new Date(user.expiresAt);
    const now = new Date();
    const daysAgo = Math.floor((now - expiredDate) / (1000 * 60 * 60 * 24));

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${user.username || user.id}</td>
      <td>${user.email || 'N/A'}</td>
      <td>${expiredDate.toLocaleDateString()}</td>
      <td>${daysAgo} days ago</td>
      <td>
        <button class="btn-small btn-action" data-clear-expiry="${user.id}">Re-activate</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  if (tab === 'expiring') {
    loadExpiringUsers();
    document.getElementById('expiringTab').classList.add('active');
  } else if (tab === 'expired') {
    loadExpiredUsers();
    document.getElementById('expiredTab').classList.add('active');
  } else if (tab === 'settings') {
    loadExpirySettings();
    document.getElementById('settingsTab').classList.add('active');
  }
}

async function loadExpirySettings() {
  try {
    const res = await fetch('/admin/api/settings');
    const data = await res.json();
    if (!data.success) return;
    const s = data.expirySettings || {};
    document.getElementById('expiryReminderDays').value = s.expiryReminderDays || 7;
    document.getElementById('expiryAction').value = s.expiryAction || 'disable';
    document.getElementById('expiryGraceDays').value = s.expiryGraceDays || 0;
    toggleGraceDaysRow();
    // Renewal settings
    const r = data.renewalSettings || {};
    const t = document.getElementById('renewalEnabledToggle');
    if (r.renewalEnabled) t.classList.add('active');
    else t.classList.remove('active');
    document.getElementById('renewalWindowDays').value = r.renewalWindowDays || 30;
  } catch (e) {
    console.warn('Could not load expiry settings:', e.message);
  }
}

async function saveRenewalSettings() {
  const renewalEnabled = document.getElementById('renewalEnabledToggle').classList.contains('active');
  const renewalWindowDays = parseInt(document.getElementById('renewalWindowDays').value) || 30;
  try {
    const res = await fetch('/admin/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
      body: JSON.stringify({ section: 'renewal', settings: { renewalEnabled, renewalWindowDays } })
    });
    const data = await res.json();
    const alertEl = document.getElementById('renewalAlert');
    alertEl.innerHTML = data.success
      ? '<div class="alert alert-success">Renewal settings saved!</div>'
      : `<div class="alert alert-error">${data.message || 'Save failed'}</div>`;
    setTimeout(() => { alertEl.innerHTML = ''; }, 4000);
  } catch (e) {
    document.getElementById('renewalAlert').innerHTML = `<div class="alert alert-error">Save failed: ${e.message}</div>`;
  }
}

function toggleGraceDaysRow() {
  const action = document.getElementById('expiryAction')?.value;
  const row = document.getElementById('graceDaysRow');
  if (row) row.style.display = action === 'disable_then_delete' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('expiryAction');
  if (sel) sel.addEventListener('change', toggleGraceDaysRow);
  const renewalToggle = document.getElementById('renewalEnabledToggle');
  if (renewalToggle) renewalToggle.addEventListener('click', () => renewalToggle.classList.toggle('active'));
});

async function saveExpirySettings() {
  const body = {
    section: 'expiry',
    settings: {
      expiryReminderDays: parseInt(document.getElementById('expiryReminderDays').value) || 7,
      expiryAction: document.getElementById('expiryAction').value,
      expiryGraceDays: parseInt(document.getElementById('expiryGraceDays').value) || 0
    }
  };
  try {
    const res = await fetch('/admin/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    const alertEl = document.getElementById('settingsAlert');
    alertEl.innerHTML = data.success
      ? '<div class="alert alert-success">Settings saved!</div>'
      : `<div class="alert alert-error">${data.message}</div>`;
    setTimeout(() => { alertEl.innerHTML = ''; }, 4000);
  } catch (e) {
    showAlert('Save failed: ' + e.message, 'error');
  }
}

async function clearExpiry(userId) {
  if (!confirm('Are you sure you want to clear the expiry for this user?')) return;

  try {
    const response = await fetch(`/api/users/${userId}/expiry`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Expiry cleared', 'success');
      loadStats();
      loadExpiringUsers();
      loadExpiredUsers();
    } else {
      showAlert(data.error || 'Failed to clear expiry', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

async function triggerWarnings(btn) {
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const response = await fetch('/api/users/expiry/send-warnings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (data.success) {
      showAlert(`Sent ${data.count} warning notification(s)`, 'success');
    } else {
      showAlert(data.error || 'Failed to send warnings', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Expiry Warnings';
  }
}

async function triggerDisable(btn) {
  btn.disabled = true;
  btn.textContent = 'Disabling...';

  try {
    const response = await fetch('/api/users/expiry/disable-expired', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (data.success) {
      showAlert(`Disabled ${data.count} expired user(s)`, 'success');
      loadStats();
      loadExpiringUsers();
      loadExpiredUsers();
    } else {
      showAlert(data.error || 'Failed to disable users', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Disable Expired Users';
  }
}

function showAlert(message, type) {
  const container = document.getElementById('alertContainer');
  const alertClass = type === 'error' ? 'alert-error' : 'alert-success';
  container.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
  setTimeout(() => {
    container.innerHTML = '';
  }, 5000);
}

window.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadExpiringUsers();

  // Tab delegation
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab, btn);
  });

  // Static buttons
  document.getElementById('btnTriggerWarnings').addEventListener('click', function() { triggerWarnings(this); });
  document.getElementById('btnTriggerDisable').addEventListener('click', function() { triggerDisable(this); });
  document.getElementById('btnSaveExpirySettings').addEventListener('click', saveExpirySettings);
  document.getElementById('btnSaveRenewalSettings').addEventListener('click', saveRenewalSettings);

  // Dynamic clear expiry buttons (delegated)
  document.querySelector('.page-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-clear-expiry]');
    if (btn) clearExpiry(btn.dataset.clearExpiry);
  });
});
