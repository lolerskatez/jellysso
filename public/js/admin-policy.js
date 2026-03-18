/**
 * admin-policy.js
 * Tier management UI for Policy Management page.
 * Handles CRUD for tiers via /api/policy/admin/tiers
 */

let csrfToken = null;
let tiersCache = [];
let pendingDeleteId = null;

// ─────────────────────────────────────────────────────────────────────────────
// CSRF
// ─────────────────────────────────────────────────────────────────────────────

async function getCsrfToken() {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Status
// ─────────────────────────────────────────────────────────────────────────────

function showStatus(message, type = 'info') {
  const el = document.getElementById('statusMsg');
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg ${type}`;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status-msg'; }, 5000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Load & render tiers
// ─────────────────────────────────────────────────────────────────────────────

async function loadTiers() {
  try {
    const res = await fetch('/api/policy/admin/tiers');
    const data = await res.json();
    if (!data.success) {
      showStatus('Failed to load tiers: ' + data.message, 'error');
      return;
    }
    tiersCache = data.tiers || [];
    renderTierGrid(tiersCache);
  } catch (err) {
    console.error('Error loading tiers:', err);
    showStatus('Failed to load tiers', 'error');
  }
}

function renderTierGrid(tiers) {
  const grid = document.getElementById('tierGrid');
  if (!grid) return;

  let html = '';

  tiers.forEach(tier => {
    const color = tier.badgeColor || '#95a5a6';
    const streams = tier.maxConcurrentStreams >= 999 ? 'Unlimited' : tier.maxConcurrentStreams;
    const dwl = tier.deviceWhitelistEnabled
      ? '<span class="tier-flag on"><i class="fas fa-check-circle"></i> Enabled</span>'
      : '<span class="tier-flag off"><i class="fas fa-times-circle"></i> Off</span>';
    const sched = tier.enforceAccessSchedule
      ? '<span class="tier-flag on"><i class="fas fa-check-circle"></i> Enabled</span>'
      : '<span class="tier-flag off"><i class="fas fa-times-circle"></i> Off</span>';
    const userLabel = tier.userCount === 1 ? '1 user' : `${tier.userCount} users`;

    html += `
      <div class="tier-card" data-tier-id="${escapeHtml(tier.id)}">
        <div class="tier-card-accent" style="background:${escapeHtml(color)}"></div>
        <div class="tier-card-body">
          <div class="tier-card-header">
            <span class="tier-badge-large" style="background:${escapeHtml(color)}">
              ${escapeHtml(tier.displayName)}
            </span>
            <span class="tier-user-count">
              <i class="fas fa-users" style="margin-right:4px"></i>${escapeHtml(userLabel)}
            </span>
          </div>
          <div class="tier-stat-row">
            <span class="tier-stat-label">Max Concurrent Streams</span>
            <span class="tier-stat-value">${escapeHtml(String(streams))}</span>
          </div>
          <div class="tier-stat-row">
            <span class="tier-stat-label">Device Whitelist</span>
            <span class="tier-stat-value">${dwl}</span>
          </div>
          <div class="tier-stat-row">
            <span class="tier-stat-label">Access Schedule</span>
            <span class="tier-stat-value">${sched}</span>
          </div>
        </div>
        <div class="tier-card-actions">
          <button class="btn-tier-edit" onclick="openEditModal('${escapeHtml(tier.id)}')">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="btn-tier-delete"
            onclick="openDeleteModal('${escapeHtml(tier.id)}')"
            ${tier.userCount > 0 ? 'disabled title="Cannot delete: users are assigned to this tier"' : ''}>
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </div>
    `;
  });

  // "Add tier" placeholder card
  html += `
    <div class="tier-card-add" onclick="openCreateModal()">
      <i class="fas fa-plus-circle"></i>
      <span>Add New Tier</span>
    </div>
  `;

  grid.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────────────────────

function openCreateModal() {
  document.getElementById('createId').value = '';
  document.getElementById('createDisplayName').value = '';
  document.getElementById('createMaxStreams').value = 1;
  document.getElementById('createColor').value = '#95a5a6';
  document.getElementById('createColorPreview').style.background = '#95a5a6';
  document.getElementById('createColorPreview').textContent = 'TIER';
  document.getElementById('createDeviceWL').checked = false;
  document.getElementById('createSchedule').checked = false;
  document.getElementById('createModal').classList.add('show');
  document.getElementById('createId').focus();
}

function syncCreatePreview() {
  const color = document.getElementById('createColor').value;
  const name = document.getElementById('createDisplayName').value ||
               document.getElementById('createId').value || 'TIER';
  const preview = document.getElementById('createColorPreview');
  preview.style.background = color;
  preview.textContent = name.toUpperCase().substring(0, 10);
}

async function submitCreateTier(event) {
  event.preventDefault();
  const token = await getCsrfToken();
  if (!token) return;

  const payload = {
    id: document.getElementById('createId').value.trim(),
    displayName: document.getElementById('createDisplayName').value.trim(),
    maxConcurrentStreams: parseInt(document.getElementById('createMaxStreams').value),
    badgeColor: document.getElementById('createColor').value,
    deviceWhitelistEnabled: document.getElementById('createDeviceWL').checked,
    enforceAccessSchedule: document.getElementById('createSchedule').checked,
    sortOrder: tiersCache.length
  };

  try {
    const res = await fetch('/api/policy/admin/tiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) {
      showStatus('Failed to create tier: ' + data.message, 'error');
      return;
    }
    showStatus(`Tier "${payload.displayName}" created`, 'success');
    closeModal('createModal');
    loadTiers();
  } catch (err) {
    console.error('Create tier error:', err);
    showStatus('Failed to create tier', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit modal
// ─────────────────────────────────────────────────────────────────────────────

function openEditModal(tierId) {
  const tier = tiersCache.find(t => t.id === tierId);
  if (!tier) { showStatus('Tier not found', 'error'); return; }

  document.getElementById('editId').value = tier.id;
  document.getElementById('editDisplayName').value = tier.displayName;
  document.getElementById('editMaxStreams').value = tier.maxConcurrentStreams;
  document.getElementById('editColor').value = tier.badgeColor || '#95a5a6';
  document.getElementById('editDeviceWL').checked = !!tier.deviceWhitelistEnabled;
  document.getElementById('editSchedule').checked = !!tier.enforceAccessSchedule;

  syncEditPreview();
  document.getElementById('editModal').classList.add('show');
  document.getElementById('editDisplayName').focus();
}

function syncEditPreview() {
  const color = document.getElementById('editColor').value;
  const name = document.getElementById('editDisplayName').value || 'TIER';
  const preview = document.getElementById('editColorPreview');
  preview.style.background = color;
  preview.textContent = name.toUpperCase().substring(0, 10);
}

async function submitEditTier(event) {
  event.preventDefault();
  const token = await getCsrfToken();
  if (!token) return;

  const tierId = document.getElementById('editId').value;
  const payload = {
    displayName: document.getElementById('editDisplayName').value.trim(),
    maxConcurrentStreams: parseInt(document.getElementById('editMaxStreams').value),
    badgeColor: document.getElementById('editColor').value,
    deviceWhitelistEnabled: document.getElementById('editDeviceWL').checked,
    enforceAccessSchedule: document.getElementById('editSchedule').checked
  };

  try {
    const res = await fetch(`/api/policy/admin/tiers/${encodeURIComponent(tierId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) {
      showStatus('Failed to update tier: ' + data.message, 'error');
      return;
    }
    showStatus(`Tier "${payload.displayName}" updated`, 'success');
    closeModal('editModal');
    loadTiers();
  } catch (err) {
    console.error('Edit tier error:', err);
    showStatus('Failed to update tier', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete modal
// ─────────────────────────────────────────────────────────────────────────────

function openDeleteModal(tierId) {
  const tier = tiersCache.find(t => t.id === tierId);
  if (!tier) return;

  pendingDeleteId = tierId;

  const warnEl = document.getElementById('deleteWarnText');
  const nameEl = document.getElementById('deleteTargetName');

  nameEl.textContent = `"${tier.displayName}"`;

  if (tier.userCount > 0) {
    warnEl.textContent = `This tier has ${tier.userCount} user(s) assigned and cannot be deleted.`;
    document.getElementById('confirmDeleteBtn').disabled = true;
  } else {
    warnEl.textContent = 'This tier will be permanently deleted.';
    document.getElementById('confirmDeleteBtn').disabled = false;
  }

  document.getElementById('deleteModal').classList.add('show');
}

async function confirmDeleteTier() {
  if (!pendingDeleteId) return;
  const token = await getCsrfToken();
  if (!token) return;

  try {
    const res = await fetch(`/api/policy/admin/tiers/${encodeURIComponent(pendingDeleteId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }
    });
    const data = await res.json();
    if (!data.success) {
      showStatus('Failed to delete tier: ' + data.message, 'error');
      closeModal('deleteModal');
      return;
    }
    showStatus(data.message || 'Tier deleted', 'success');
    closeModal('deleteModal');
    pendingDeleteId = null;
    loadTiers();
  } catch (err) {
    console.error('Delete tier error:', err);
    showStatus('Failed to delete tier', 'error');
    closeModal('deleteModal');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal helpers
// ─────────────────────────────────────────────────────────────────────────────

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('show');
}

// Close modals on backdrop click
document.addEventListener('click', function(e) {
  ['createModal', 'editModal', 'deleteModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el && e.target === el) closeModal(id);
  });
});

// Close modals on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    ['createModal', 'editModal', 'deleteModal'].forEach(closeModal);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Security helper
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}