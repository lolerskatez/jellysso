/**
 * admin-users.js
 * User management page — fetches merged data from /api/policy/admin/policies
 * and handles Add / Edit (2-tab: Account + Policy) / Delete flows.
 */

console.log('admin-users.js loaded successfully');

let csrfToken = null;
let usersCache = [];
let tiersCache = [];
let currentEditUserId = null;
let pendingDeleteId = null;
let pendingDeleteName = '';

// ─────────────────────────────────────────────────────────────────────────────
// CSRF
// ─────────────────────────────────────────────────────────────────────────────

const getCsrfToken = (window.getCsrfToken = async function() {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    csrfToken = data.csrf_token;
    return csrfToken;
  } catch (err) {
    console.error('Failed to get CSRF token:', err);
    showStatus('Failed to get security token', 'error');
    return null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const escapeHtml = (window.escapeHtml = function(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
});

const formatExpiry = (window.formatExpiry = function(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
});

const statusBadgeHtml = (window.statusBadgeHtml = function(status) {
  const map = {
    active:   ['badge-active',   'fa-circle-check', 'Active'],
    disabled: ['badge-disabled', 'fa-ban',          'Disabled'],
    expired:  ['badge-expired',  'fa-clock',        'Expired']
  };
  const [cls, icon, label] = map[status] || ['badge-user', 'fa-circle', status || 'Unknown'];
  return `<span class="badge ${cls}"><i class="fas ${icon}"></i> ${label}</span>`;
});

const tierBadgeHtml = (window.tierBadgeHtml = function(user) {
  if (!user.tier) return '<span class="badge badge-none">None</span>';
  const tier = tiersCache.find(t => t.id === user.tier);
  const color = tier && tier.badgeColor ? escapeHtml(tier.badgeColor) : '#95a5a6';
  const name  = tier ? escapeHtml(tier.displayName) : escapeHtml(user.tier);
  return `<span class="badge badge-tier" style="background:${color}">${name}</span>`;
});

const roleBadgeHtml = (window.roleBadgeHtml = function(user) {
  if (user.isJellyfinAdmin) {
    return '<span class="badge badge-admin"><i class="fas fa-shield-alt"></i> Admin</span>';
  }
  return '<span class="badge badge-user">User</span>';
});

const showStatus = (window.showStatus = function(message, type) {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = message;
  el.className = 'status-msg ' + (type || 'info');
  if (type === 'success') {
    setTimeout(function() {
      el.className = 'status-msg';
      el.textContent = '';
    }, 5000);
  }
});

const setEl = (window.setEl = function(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
});

const setLoading = (window.setLoading = function(btn, loading, idleHtml) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<i class="fas fa-spinner fa-spin" style="margin-right:6px"></i>Please wait…'
    : idleHtml;
});

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

const loadData = (window.loadData = async function() {
  try {
    const [policiesRes, tiersRes] = await Promise.all([
      fetch('/api/policy/admin/policies'),
      fetch('/api/policy/admin/tiers')
    ]);

    if (!policiesRes.ok) {
      var errText = '';
      try { var errJson = await policiesRes.json(); errText = errJson.message || ''; } catch(_) {}
      showStatus('Failed to load users (HTTP ' + policiesRes.status + ')' + (errText ? ': ' + errText : ''), 'error');
      renderTable([]);
      renderStats([]);
      return;
    }

    const [policiesData, tiersData] = await Promise.all([
      policiesRes.json(),
      tiersRes.ok ? tiersRes.json() : Promise.resolve({ success: false, tiers: [] })
    ]);

    if (!policiesData.success) {
      showStatus('Failed to load users: ' + (policiesData.message || 'Unknown error'), 'error');
      renderTable([]);
      renderStats([]);
      return;
    }

    usersCache = policiesData.policies || [];
    tiersCache = (tiersData.success ? tiersData.tiers : []) || [];

    renderStats(usersCache);
    renderTable(usersCache);
    populateTierSelect();
  } catch (err) {
    console.error('Error loading data:', err);
    showStatus('Failed to load user data: ' + (err.message || 'Network error'), 'error');
    renderTable([]);
    renderStats([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats bar
// ─────────────────────────────────────────────────────────────────────────────

const renderStats = (window.renderStats = function(users) {
  setEl('statTotal',    users.length);
  setEl('statActive',   users.filter(function(u) { return u.accountStatus === 'active';   }).length);
  setEl('statDisabled', users.filter(function(u) { return u.accountStatus === 'disabled'; }).length);
  setEl('statExpired',  users.filter(function(u) { return u.accountStatus === 'expired';  }).length);
  setEl('statAdmins',   users.filter(function(u) { return u.isJellyfinAdmin; }).length);
});

// ─────────────────────────────────────────────────────────────────────────────
// Table rendering
// ─────────────────────────────────────────────────────────────────────────────

const renderTable = (window.renderTable = function(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  if (!users || users.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6">' +
        '<div class="empty-state">' +
          '<i class="fas fa-users"></i>' +
          '<h3>No users found</h3>' +
          '<p>No users match your current filters.</p>' +
        '</div>' +
      '</td></tr>';
    return;
  }

  var rows = users.map(function(u) {
    var uid      = escapeHtml(u.userId);
    var initial  = u.username ? escapeHtml(u.username.charAt(0).toUpperCase()) : '?';
    var name     = escapeHtml(u.username || 'Unknown');
    var idShort  = escapeHtml((u.userId || '').substring(0, 12)) + '&hellip;';
    var expiryStr = formatExpiry(u.expiresAt);
    var expiryCell = expiryStr
      ? escapeHtml(expiryStr)
      : '<span style="color:var(--text-secondary)">\u2014</span>';

    return '<tr data-user-id="' + uid + '" data-name="' + escapeHtml((u.username || '').toLowerCase()) + '" data-status="' + escapeHtml(u.accountStatus || 'active') + '">' +
      '<td>' +
        '<div class="user-cell">' +
          '<div class="user-avatar">' + initial + '</div>' +
          '<div>' +
            '<div class="user-name">' + name + '</div>' +
            '<div class="user-id">' + idShort + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + roleBadgeHtml(u) + '</td>' +
      '<td>' + statusBadgeHtml(u.accountStatus) + '</td>' +
      '<td>' + tierBadgeHtml(u) + '</td>' +
      '<td>' + expiryCell + '</td>' +
      '<td>' +
        '<div class="row-actions">' +
          '<button class="btn-icon" title="Edit user" data-uid="' + uid + '" onclick="openEditModal(this.dataset.uid)">' +
            '<i class="fas fa-edit"></i>' +
          '</button>' +
          '<button class="btn-icon danger" title="Delete user" data-uid="' + uid + '" data-uname="' + escapeHtml(u.username || '') + '" onclick="openDeleteModal(this.dataset.uid, this.dataset.uname)">' +
            '<i class="fas fa-trash"></i>' +
          '</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  });

  tbody.innerHTML = rows.join('');
  applyFilter();
});

// ─────────────────────────────────────────────────────────────────────────────
// Filter
// ─────────────────────────────────────────────────────────────────────────────

const applyFilter = (window.applyFilter = function() {
  var search  = (document.getElementById('searchInput')  ? document.getElementById('searchInput').value.toLowerCase()  : '');
  var statusF = (document.getElementById('statusFilter') ? document.getElementById('statusFilter').value : '');

  document.querySelectorAll('#usersTableBody tr[data-user-id]').forEach(function(row) {
    var name   = row.dataset.name   || '';
    var id     = (row.dataset.userId || '').toLowerCase();
    var status = row.dataset.status || '';
    var matchSearch = !search  || name.includes(search)  || id.includes(search);
    var matchStatus = !statusF || status === statusF;
    row.style.display = (matchSearch && matchStatus) ? '' : 'none';
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Add User Modal
// ─────────────────────────────────────────────────────────────────────────────

const openAddModal = (window.openAddModal = function() {
  ['addUsername', 'addPassword', 'addFirstName', 'addLastName', 'addEmail', 'addDisplayName'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  openModal('addModal');
  var u = document.getElementById('addUsername');
  if (u) u.focus();
});

const submitAddUser = (window.submitAddUser = async function() {
  var username = (document.getElementById('addUsername') ? document.getElementById('addUsername').value.trim() : '');
  if (!username) {
    showStatus('Username is required', 'error');
    return;
  }

  var btn = document.getElementById('addSubmitBtn');
  setLoading(btn, true, '<i class="fas fa-plus"></i> Create User');

  try {
    var token = await getCsrfToken();
    if (!token) return;

    var response = await fetch('/admin/api/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({
        username: username,
        password: document.getElementById('addPassword') ? document.getElementById('addPassword').value : ''
      })
    });

    var data = await response.json();

    if (!data.success) {
      showStatus(data.message || 'Failed to create user', 'error');
      return;
    }

    var firstName   = document.getElementById('addFirstName')   ? document.getElementById('addFirstName').value.trim()   : '';
    var lastName    = document.getElementById('addLastName')    ? document.getElementById('addLastName').value.trim()    : '';
    var email       = document.getElementById('addEmail')       ? document.getElementById('addEmail').value.trim()       : '';
    var displayName = document.getElementById('addDisplayName') ? document.getElementById('addDisplayName').value.trim() : '';

    if (firstName || lastName || email || displayName) {
      await fetch('/admin/api/users/' + data.user.Id + '/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ firstName: firstName, lastName: lastName, email: email, displayName: displayName })
      });
    }

    showStatus('User "' + username + '" created successfully', 'success');
    closeModal('addModal');
    await loadData();
  } catch (err) {
    console.error('Create user error:', err);
    showStatus('An error occurred while creating the user', 'error');
  } finally {
    setLoading(btn, false, '<i class="fas fa-plus"></i> Create User');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Edit User Modal
// ─────────────────────────────────────────────────────────────────────────────

const openEditModal = (window.openEditModal = async function(userId) {
  currentEditUserId = userId;

  // Reset generate-password result
  var genResult = document.getElementById('genPassResult');
  if (genResult) { genResult.style.display = 'none'; genResult.textContent = ''; }
  var genBtn = document.getElementById('genPassBtn');
  if (genBtn) genBtn.innerHTML = '<i class="fas fa-key"></i> Generate &amp; Set New Password';

  switchTab('account');

  var user = usersCache.find(function(u) { return u.userId === userId; });
  if (!user) { showStatus('User not found in cache', 'error'); return; }

  // Update modal title
  var titleEl = document.getElementById('editModalTitle');
  if (titleEl) {
    titleEl.innerHTML = '<i class="fas fa-user-edit" style="margin-right:8px;color:var(--primary)"></i>Edit: ' + escapeHtml(user.username || userId);
  }

  // Account tab — Jellyfin fields
  var usernameEl = document.getElementById('editUsername');
  if (usernameEl) usernameEl.value = '';
  var currentLabel = document.getElementById('editUsernameCurrent');
  if (currentLabel) currentLabel.textContent = 'Current: ' + (user.username || '');
  var passwordEl = document.getElementById('editPassword');
  if (passwordEl) passwordEl.value = '';

  // Account control
  var enabledEl = document.getElementById('editAccountEnabled');
  if (enabledEl) enabledEl.checked = (user.accountEnabled !== false);

  var expiryEl = document.getElementById('editExpiresAt');
  if (expiryEl) {
    if (user.expiresAt) {
      try {
        var d = new Date(user.expiresAt);
        // Convert UTC to local for datetime-local input
        var localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        expiryEl.value = localISO;
      } catch (e) {
        expiryEl.value = '';
      }
    } else {
      expiryEl.value = '';
    }
  }

  // Policy tab
  var tierEl = document.getElementById('editTier');
  if (tierEl) {
    tierEl.value = user.tier || '';
    updateStreamsFromTier();
  }

  var dwlEl = document.getElementById('editDeviceWL');
  if (dwlEl) dwlEl.checked = !!user.deviceWhitelistEnabled;

  var schedEl = document.getElementById('editAccessSched');
  if (schedEl) schedEl.checked = !!user.enforceAccessSchedule;

  openModal('editModal');

  // Fetch SSO profile in background after modal opens
  try {
    var profileRes = await fetch('/admin/api/users/' + userId + '/profile');
    var profileData = await profileRes.json();
    var p = profileData.profile || {};

    var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('editFirstName',   p.first_name);
    setVal('editLastName',    p.last_name);
    setVal('editEmail',       p.email);
    setVal('editDisplayName', p.display_name);
  } catch (err) {
    console.error('Failed to load profile:', err);
    // Non-fatal — modal is already open
  }
});

const switchTab = (window.switchTab = function(tabName) {
  var tabs   = ['account', 'policy'];
  tabs.forEach(function(t) {
    var cap  = t.charAt(0).toUpperCase() + t.slice(1);
    var btn  = document.getElementById('tabBtn'  + cap);
    var pane = document.getElementById('tab'     + cap);
    if (btn)  btn.classList.toggle('active',  t === tabName);
    if (pane) pane.classList.toggle('active', t === tabName);
  });
});

const clearExpiry = (window.clearExpiry = function() {
  var el = document.getElementById('editExpiresAt');
  if (el) el.value = '';
});

const updateStreamsFromTier = (window.updateStreamsFromTier = function() {
  var tierEl    = document.getElementById('editTier');
  var streamsEl = document.getElementById('editMaxStreams');
  if (!tierEl || !streamsEl) return;

  var tier = tiersCache.find(function(t) { return t.id === tierEl.value; });
  if (tier) {
    streamsEl.value = (tier.maxConcurrentStreams >= 999) ? 'Unlimited' : String(tier.maxConcurrentStreams);
  } else {
    streamsEl.value = '';
  }
});

const generatePassword = (window.generatePassword = async function() {
  if (!currentEditUserId) return;

  var btn = document.getElementById('genPassBtn');
  setLoading(btn, true, '<i class="fas fa-key"></i> Generate &amp; Set New Password');

  try {
    var token = await getCsrfToken();
    if (!token) return;

    var res  = await fetch('/admin/api/users/' + currentEditUserId + '/generate-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }
    });

    var data = await res.json();
    var resultEl = document.getElementById('genPassResult');

    if (data.success && resultEl) {
      resultEl.textContent = 'New password: ' + (data.password || '(see audit log)');
      resultEl.style.display = 'block';
    } else {
      showStatus(data.message || 'Failed to generate password', 'error');
    }
  } catch (err) {
    console.error('Generate password error:', err);
    showStatus('Failed to generate password', 'error');
  } finally {
    setLoading(btn, false, '<i class="fas fa-key"></i> Generate &amp; Set New Password');
  }
});

const saveChanges = (window.saveChanges = async function() {
  if (!currentEditUserId) return;

  var btn = document.getElementById('editSaveBtn');
  setLoading(btn, true, '<i class="fas fa-save"></i> Save Changes');

  try {
    var token = await getCsrfToken();
    if (!token) return;

    var promises = [];
    var errors   = [];

    // ── Jellyfin account (username / password) ────────────────────
    var newUsername = document.getElementById('editUsername') ? document.getElementById('editUsername').value.trim() : '';
    var newPassword = document.getElementById('editPassword') ? document.getElementById('editPassword').value        : '';

    if (newUsername || newPassword) {
      var accountBody = {};
      if (newUsername) accountBody.username = newUsername;
      if (newPassword) accountBody.password = newPassword;
      promises.push(
        fetch('/admin/api/users/' + currentEditUserId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify(accountBody)
        })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (!d.success) errors.push('Account: ' + (d.message || 'Failed')); })
      );
    }

    // ── SSO profile ───────────────────────────────────────────────
    var firstName   = document.getElementById('editFirstName')   ? document.getElementById('editFirstName').value.trim()   : '';
    var lastName    = document.getElementById('editLastName')    ? document.getElementById('editLastName').value.trim()    : '';
    var email       = document.getElementById('editEmail')       ? document.getElementById('editEmail').value.trim()       : '';
    var displayName = document.getElementById('editDisplayName') ? document.getElementById('editDisplayName').value.trim() : '';

    promises.push(
      fetch('/admin/api/users/' + currentEditUserId + '/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ firstName: firstName, lastName: lastName, email: email, displayName: displayName })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (!d.success) errors.push('Profile: ' + (d.message || 'Failed')); })
    );

    // ── Account status (enabled + expiry) ─────────────────────────
    var enabled     = document.getElementById('editAccountEnabled') ? document.getElementById('editAccountEnabled').checked : true;
    var expiresAtEl = document.getElementById('editExpiresAt');
    var expiresAt   = null;
    if (expiresAtEl && expiresAtEl.value) {
      var parsedDate = new Date(expiresAtEl.value);
      if (!isNaN(parsedDate)) expiresAt = parsedDate.toISOString();
    }

    promises.push(
      fetch('/api/policy/admin/user/' + currentEditUserId + '/account-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ enabled: enabled, expiresAt: expiresAt })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (!d.success) errors.push('Account status: ' + (d.message || 'Failed')); })
    );

    // ── Tier ──────────────────────────────────────────────────────
    var tier = document.getElementById('editTier') ? document.getElementById('editTier').value : '';
    if (tier) {
      promises.push(
        fetch('/api/policy/admin/user/' + currentEditUserId + '/tier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ tier: tier })
        })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (!d.success) errors.push('Tier: ' + (d.message || 'Failed')); })
      );
    }

    // ── Device whitelist ──────────────────────────────────────────
    var deviceWl = document.getElementById('editDeviceWL') ? document.getElementById('editDeviceWL').checked : false;
    promises.push(
      fetch('/api/policy/admin/user/' + currentEditUserId + '/device-whitelist/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ enabled: deviceWl })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (!d.success) errors.push('Device whitelist: ' + (d.message || 'Failed')); })
    );

    // ── Access schedule ───────────────────────────────────────────
    var schedule = document.getElementById('editAccessSched') ? document.getElementById('editAccessSched').checked : false;
    promises.push(
      fetch('/api/policy/admin/user/' + currentEditUserId + '/access-schedule/enforce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({ enforce: schedule })
      })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (!d.success) errors.push('Access schedule: ' + (d.message || 'Failed')); })
    );

    await Promise.all(promises);

    if (errors.length > 0) {
      showStatus('Some changes failed: ' + errors.join('; '), 'error');
    } else {
      showStatus('User updated successfully', 'success');
      closeModal('editModal');
      await loadData();
    }
  } catch (err) {
    console.error('Save changes error:', err);
    showStatus('An error occurred while saving', 'error');
  } finally {
    setLoading(btn, false, '<i class="fas fa-save"></i> Save Changes');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Delete Modal
// ─────────────────────────────────────────────────────────────────────────────

const openDeleteModal = (window.openDeleteModal = function(userId, name) {
  pendingDeleteId   = userId;
  pendingDeleteName = name;
  var nameEl = document.getElementById('deleteUserName');
  if (nameEl) nameEl.textContent = name || userId;
  openModal('deleteModal');
});

const confirmDelete = (window.confirmDelete = async function() {
  if (!pendingDeleteId) return;

  var btn = document.getElementById('deleteConfirmBtn');
  setLoading(btn, true, '<i class="fas fa-trash"></i> Delete User');

  try {
    var token = await getCsrfToken();
    if (!token) return;

    var res = await fetch('/admin/api/users/' + pendingDeleteId, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }
    });

    var data = await res.json();

    if (data.success || res.ok) {
      showStatus('User deleted successfully', 'success');
      closeModal('deleteModal');
      await loadData();
    } else {
      showStatus(data.message || 'Failed to delete user', 'error');
    }
  } catch (err) {
    console.error('Delete error:', err);
    showStatus('An error occurred while deleting the user', 'error');
  } finally {
    setLoading(btn, false, '<i class="fas fa-trash"></i> Delete User');
    pendingDeleteId   = null;
    pendingDeleteName = '';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier select
// ─────────────────────────────────────────────────────────────────────────────

const populateTierSelect = (window.populateTierSelect = function() {
  var sel = document.getElementById('editTier');
  if (!sel) return;

  var current = sel.value;
  sel.innerHTML = '<option value="">\u2014 Select Tier \u2014</option>' +
    tiersCache.map(function(t) {
      return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml(t.displayName) + '</option>';
    }).join('');

  if (current) sel.value = current;
});

// ─────────────────────────────────────────────────────────────────────────────
// Modal open / close
// ─────────────────────────────────────────────────────────────────────────────

const openModal = (window.openModal = function(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('show');
});

const closeModal = (window.closeModal = function(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('show');
  if (id === 'deleteModal') {
    pendingDeleteId   = null;
    pendingDeleteName = '';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

function initPage() {
  loadData();

  // Search and filter
  var searchInput  = document.getElementById('searchInput');
  var statusFilter = document.getElementById('statusFilter');
  if (searchInput)  searchInput.addEventListener('input',  applyFilter);
  if (statusFilter) statusFilter.addEventListener('change', applyFilter);

  // Refresh
  var refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function() {
      csrfToken = null;
      loadData();
    });
  }

  // Add user button
  var addUserBtn = document.getElementById('addUserBtn');
  if (addUserBtn) addUserBtn.addEventListener('click', openAddModal);

  // Enter key in add modal username field
  var addUsername = document.getElementById('addUsername');
  if (addUsername) {
    addUsername.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); submitAddUser(); }
    });
  }

  // Tier change → update streams display
  var editTier = document.getElementById('editTier');
  if (editTier) editTier.addEventListener('change', updateStreamsFromTier);

  // Backdrop click closes modals
  ['addModal', 'editModal', 'deleteModal'].forEach(function(id) {
    var modal = document.getElementById(id);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target.id === id) closeModal(id);
      });
    }
  });

  // Escape key closes open modal
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      ['editModal', 'addModal', 'deleteModal'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el && el.classList.contains('show')) closeModal(id);
      });
    }
  });
}

// Run immediately if DOM is already ready, otherwise wait
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensure all functions are available globally
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  console.log('admin-users.js initialization complete');
}
