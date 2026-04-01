const CSRF = document.querySelector('meta[name="csrf-token"]').content;

const TYPE_ICONS = {
  failed_login: 'fa-sign-in-alt',
  new_device: 'fa-laptop',
  policy_change: 'fa-file-alt',
  password_change: 'fa-key',
  account_locked: 'fa-lock',
  suspicious_activity: 'fa-user-secret',
  permission_change: 'fa-user-cog',
  api_key_created: 'fa-plus-circle',
  api_key_revoked: 'fa-minus-circle'
};

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function loadStats() {
  try {
    const r = await fetch('/admin/api/security-alerts/stats');
    const data = await r.json();
    if (!data.success) return;
    let totalUnread = 0;
    const bySev = {};
    (data.stats || []).forEach(s => { bySev[s.severity] = s; totalUnread += (s.unread || 0); });
    ['critical', 'high', 'medium', 'low'].forEach(sev => {
      document.getElementById(`stat-${sev}`).textContent = bySev[sev] ? bySev[sev].count : '0';
    });
    document.getElementById('stat-unread').textContent = totalUnread;
  } catch (e) {}
}

async function loadAlerts() {
  const wrap = document.getElementById('alertsList');
  wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="font-size:2rem"></i></div>';

  const severity = document.getElementById('filterSeverity').value;
  const type = document.getElementById('filterType').value;
  const unread = document.getElementById('filterRead').value;

  const params = new URLSearchParams({ limit: 200 });
  if (severity) params.append('severity', severity);
  if (type) params.append('type', type);
  if (unread) params.append('unread', unread);

  try {
    const r = await fetch(`/admin/api/security-alerts?${params}`);
    const data = await r.json();
    if (!data.success) throw new Error(data.message);

    if (!data.alerts.length) {
      wrap.innerHTML = '<div class="empty-state"><i class="fas fa-shield-alt"></i><p>No security alerts found.</p></div>';
      return;
    }

    wrap.innerHTML = `<div class="alert-list">${data.alerts.map(a => {
      const icon = TYPE_ICONS[a.alert_type] || 'fa-bell';
      const typeLabel = (a.alert_type || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<div class="alert-item ${a.severity} ${a.read ? 'read' : ''}" id="alert-${a.id}">
        <div class="alert-icon sev-${a.severity}"><i class="fas ${icon}"></i></div>
        <div class="alert-body">
          <p class="alert-title">${escHtml(a.title)}</p>
          <p style="margin:0 0 6px 0;font-size:.9rem;color:var(--text-primary)">${escHtml(a.message)}</p>
          <div class="alert-meta">
            <span class="sev-badge ${a.severity}">${a.severity}</span>
            <span><i class="fas fa-tag"></i> ${escHtml(typeLabel)}</span>
            ${a.user_id ? `<span><i class="fas fa-user"></i> ${escHtml(a.user_id)}</span>` : ''}
            ${a.ip_address ? `<span><i class="fas fa-network-wired"></i> ${escHtml(a.ip_address)}</span>` : ''}
            <span><i class="fas fa-clock"></i> ${new Date(a.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div class="alert-actions">
          ${!a.read ? `<button class="btn-secondary btn-sm" data-mark-read="${a.id}" title="Mark read"><i class="fas fa-check"></i></button>` : ''}
          <button class="btn-danger btn-sm" data-delete-alert="${a.id}" title="Dismiss"><i class="fas fa-times"></i></button>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (e) {
    wrap.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load alerts.</p></div>';
  }
}

async function markRead(id) {
  try {
    const r = await fetch(`/admin/api/security-alerts/${id}/read`, {
      method: 'PATCH',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    const el = document.getElementById(`alert-${id}`);
    if (el) {
      el.classList.add('read');
      const btn = el.querySelector('[data-mark-read]');
      if (btn) btn.remove();
    }
    loadStats();
  } catch (e) { showToast(e.message || 'Failed.', 'error'); }
}

async function deleteAlert(id) {
  try {
    const r = await fetch(`/admin/api/security-alerts/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    document.getElementById(`alert-${id}`)?.remove();
    loadStats();
  } catch (e) { showToast(e.message || 'Failed.', 'error'); }
}

async function markAllRead() {
  try {
    const r = await fetch('/admin/api/security-alerts/read-all', {
      method: 'PATCH',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(`${data.updated} alerts marked as read.`, 'success');
    loadAlerts();
    loadStats();
  } catch (e) { showToast(e.message || 'Failed.', 'error'); }
}

async function clearAlerts() {
  const severity = document.getElementById('filterSeverity').value;
  const msg = severity ? `Clear all ${severity} severity alerts?` : 'Clear all security alerts? This cannot be undone.';
  if (!confirm(msg)) return;
  const url = severity ? `/admin/api/security-alerts?severity=${severity}` : '/admin/api/security-alerts';
  try {
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(`${data.deleted} alerts deleted.`, 'success');
    loadAlerts();
    loadStats();
  } catch (e) { showToast(e.message || 'Failed.', 'error'); }
}

function showToast(msg, type) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3500);
}

// Filter select wiring
['filterSeverity', 'filterType', 'filterRead'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', loadAlerts);
});

// Static button wiring
document.getElementById('refreshAlertsBtn')?.addEventListener('click', loadAlerts);
document.getElementById('markAllReadBtn')?.addEventListener('click', markAllRead);
document.getElementById('clearAlertsBtn')?.addEventListener('click', clearAlerts);

// Event delegation for dynamic alert action buttons
document.getElementById('alertsList').addEventListener('click', function(e) {
  const markBtn = e.target.closest('[data-mark-read]');
  if (markBtn) { markRead(markBtn.dataset.markRead); return; }
  const deleteBtn = e.target.closest('[data-delete-alert]');
  if (deleteBtn) { deleteAlert(deleteBtn.dataset.deleteAlert); }
});

loadStats();
loadAlerts();
