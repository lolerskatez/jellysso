const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

let allRequests = [];
let currentFilter = 'all';
let pendingRequestId = null;

async function loadRequests() {
  try {
    const res = await fetch('/api/invite-requests');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    allRequests = data.requests || [];
    updateStats();
    renderTable();
  } catch (err) {
    showAlert('error', 'Failed to load invite requests: ' + err.message);
  } finally {
    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'block';
  }
}

function updateStats() {
  const total    = allRequests.length;
  const pending  = allRequests.filter(r => r.status === 'pending').length;
  const approved = allRequests.filter(r => r.status === 'approved').length;
  const denied   = allRequests.filter(r => r.status === 'denied').length;

  document.getElementById('statTotal').textContent    = total;
  document.getElementById('statPending').textContent  = pending;
  document.getElementById('statApproved').textContent = approved;
  document.getElementById('statDenied').textContent   = denied;
}

function renderTable() {
  const filtered = currentFilter === 'all'
    ? allRequests
    : allRequests.filter(r => r.status === currentFilter);

  const tbody = document.getElementById('requestsTableBody');
  const emptyState = document.getElementById('emptyState');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  tbody.innerHTML = filtered.map(r => {
    const statusClass = `status-${r.status}`;
    const statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    const dateStr = new Date(r.createdAt).toLocaleDateString();
    const email = r.email ? `<a href="mailto:${escHtml(r.email)}">${escHtml(r.email)}</a>` : '<span style="color:var(--text-secondary)">—</span>';
    const reason = r.reason ? `<div class="reason-text">${escHtml(r.reason)}</div>` : '<span style="color:var(--text-secondary)">—</span>';

    let actions = '';
    if (r.status === 'pending') {
      actions = `
        <button class="btn-primary btn-sm" onclick="openApproveModal('${r.id}')">
          <i class="fas fa-check"></i> Approve
        </button>
        <button class="btn-danger btn-sm" onclick="openDenyModal('${r.id}')">
          <i class="fas fa-times"></i> Deny
        </button>`;
    } else {
      actions = `<button class="btn-secondary btn-sm" onclick="deleteRequest('${r.id}')">
          <i class="fas fa-trash"></i>
        </button>`;
    }

    return `<tr>
      <td>${escHtml(r.name)}</td>
      <td>${email}</td>
      <td>${reason}</td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>${dateStr}</td>
      <td><div class="actions-cell">${actions}</div></td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Approve Modal ────────────────────────────────────────────────────────────

async function loadProfilesIntoSelect() {
  const select = document.getElementById('approveProfile');
  if (select.options.length > 1) return; // already loaded
  try {
    const res = await fetch('/api/signup-profiles');
    const data = await res.json();
    const profiles = data.profiles || [];
    profiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });
  } catch (e) {
    // non-fatal
  }
}

const openApproveModal = (window.openApproveModal = function(id) {
  pendingRequestId = id;
  const req = allRequests.find(r => r.id === id);
  document.getElementById('approveRequesterInfo').innerHTML =
    `<strong>${escHtml(req.name)}</strong>` +
    (req.email ? `<p><i class="fas fa-envelope"></i> ${escHtml(req.email)}</p>` : '') +
    (req.reason ? `<p><i class="fas fa-comment"></i> ${escHtml(req.reason)}</p>` : '');
  document.getElementById('approveNote').value = '';
  document.getElementById('approveExpiry').value = '';
  loadProfilesIntoSelect();
  document.getElementById('approveModal').classList.add('show');
});

function closeApproveModal() {
  document.getElementById('approveModal').classList.remove('show');
  pendingRequestId = null;
}

document.getElementById('closeApproveModal').addEventListener('click', closeApproveModal);
document.getElementById('cancelApproveModal').addEventListener('click', closeApproveModal);

document.getElementById('confirmApproveBtn').addEventListener('click', async () => {
  const profileId = document.getElementById('approveProfile').value;
  const expiryDays = document.getElementById('approveExpiry').value;
  const note = document.getElementById('approveNote').value.trim();
  const btn = document.getElementById('confirmApproveBtn');

  if (!profileId) {
    showAlert('error', 'Please select a signup profile.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Approving...';

  try {
    const res = await fetch(`/api/invite-requests/${pendingRequestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ signupProfileId: profileId, expiryDays: expiryDays || null, note: note || null })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    closeApproveModal();

    // Show invite URL dialog
    const req = allRequests.find(r => r.id === pendingRequestId) || {};
    document.getElementById('inviteUrlInput').value = data.invite.signupUrl;
    document.getElementById('urlEmailNote').style.display = req.email ? 'block' : 'none';
    document.getElementById('urlModal').classList.add('show');

    await loadRequests();
  } catch (err) {
    showAlert('error', 'Failed to approve request: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Approve & Generate Invite';
  }
});

// ── Deny Modal ───────────────────────────────────────────────────────────────

const openDenyModal = (window.openDenyModal = function(id) {
  pendingRequestId = id;
  const req = allRequests.find(r => r.id === id);
  document.getElementById('denyRequesterInfo').innerHTML =
    `<strong>${escHtml(req.name)}</strong>` +
    (req.email ? `<p><i class="fas fa-envelope"></i> ${escHtml(req.email)}</p>` : '') +
    (req.reason ? `<p><i class="fas fa-comment"></i> ${escHtml(req.reason)}</p>` : '');
  document.getElementById('denyNote').value = '';
  document.getElementById('denyModal').classList.add('show');
});

function closeDenyModal() {
  document.getElementById('denyModal').classList.remove('show');
  pendingRequestId = null;
}

document.getElementById('closeDenyModal').addEventListener('click', closeDenyModal);
document.getElementById('cancelDenyModal').addEventListener('click', closeDenyModal);

document.getElementById('confirmDenyBtn').addEventListener('click', async () => {
  const note = document.getElementById('denyNote').value.trim();
  const btn = document.getElementById('confirmDenyBtn');
  btn.disabled = true;
  btn.textContent = 'Denying...';

  try {
    const res = await fetch(`/api/invite-requests/${pendingRequestId}/deny`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ note: note || null })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    closeDenyModal();
    await loadRequests();
  } catch (err) {
    showAlert('error', 'Failed to deny request: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Deny Request';
  }
});

// ── Delete ───────────────────────────────────────────────────────────────────

const deleteRequest = (window.deleteRequest = async function(id) {
  if (!confirm('Delete this request?')) return;
  try {
    const res = await fetch(`/api/invite-requests/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    await loadRequests();
  } catch (err) {
    showAlert('error', 'Failed to delete request: ' + err.message);
  }
});

// ── URL Modal ────────────────────────────────────────────────────────────────

document.getElementById('closeUrlModal').addEventListener('click',    () => document.getElementById('urlModal').classList.remove('show'));
document.getElementById('closeUrlModalBtn').addEventListener('click', () => document.getElementById('urlModal').classList.remove('show'));

document.getElementById('copyUrlBtn').addEventListener('click', () => {
  const url = document.getElementById('inviteUrlInput').value;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('copyUrlBtn');
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy Link'; }, 2000);
  });
});

// ── Filter buttons ───────────────────────────────────────────────────────────

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

// ── Alert helper ─────────────────────────────────────────────────────────────

function showAlert(type, message) {
  const container = document.getElementById('alertContainer');
  const cls = type === 'error' ? 'alert-error' : 'alert-success';
  container.innerHTML = `<div class="alert ${cls}">${message}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 5000);
}

// ── Init ─────────────────────────────────────────────────────────────────────

loadRequests();
