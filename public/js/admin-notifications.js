const CSRF_TOKEN = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
let queuePage = 1;
let logsPage = 1;

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(name + 'Tab').classList.add('active');

  if (name === 'logs') loadLogs();
  if (name === 'send') loadTemplates();
}

async function loadStats() {
  try {
    const res = await fetch('/api/admin/notifications/stats');
    const data = await res.json();
    if (data.success && data.stats) {
      const s = data.stats;
      document.getElementById('statPending').textContent = s.pending ?? '-';
      document.getElementById('statSent').textContent    = s.sent    ?? '-';
      document.getElementById('statFailed').textContent  = s.failed  ?? '-';
      document.getElementById('statSkipped').textContent = s.skipped ?? '-';
    }
  } catch (err) {
    console.error('Stats load error:', err);
  }
}

async function loadChannelStatus() {
  const grid = document.getElementById('channelsGrid');
  try {
    const res = await fetch('/api/admin/notifications/channels/status');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const channels = [
      { key: 'email',    icon: 'fa-envelope',    label: 'Email' },
      { key: 'discord',  icon: 'fa-discord',     label: 'Discord',  brand: true },
      { key: 'telegram', icon: 'fa-telegram',    label: 'Telegram', brand: true },
      { key: 'matrix',   icon: 'fa-comments',    label: 'Matrix' }
    ];

    grid.innerHTML = channels.map(ch => {
      const s = data.status[ch.key] || {};
      const dotClass = !s.enabled ? 'disabled' : (s.connected ? 'connected' : 'disconnected');
      const statusText = !s.enabled ? 'Disabled' : (s.connected ? 'Connected' : 'Disconnected');
      const iconClass = ch.brand ? 'fab' : 'fas';
      const sub = s.botTag || s.userId || s.botUserId || '';
      return `
        <div class="channel-card">
          <div class="channel-icon" style="color:${dotClass === 'connected' ? '#10b981' : dotClass === 'disabled' ? '#9ca3af' : '#ef4444'}">
            <i class="${iconClass} ${ch.icon}"></i>
          </div>
          <div class="channel-info">
            <p class="channel-name">${ch.label}</p>
            <p class="channel-status">
              <span class="status-dot ${dotClass}"></span>${statusText}
              ${sub ? `<br><small style="color:var(--text-secondary)">${sub}</small>` : ''}
            </p>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    grid.innerHTML = `<div class="alert alert-error">Failed to load channel status: ${err.message}</div>`;
  }
}

async function loadQueue() {
  const status = document.getElementById('queueStatusFilter').value;
  const tbody = document.getElementById('queueTableBody');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

  try {
    const params = new URLSearchParams({ page: queuePage, limit: 25 });
    if (status) params.set('status', status);

    const res = await fetch('/api/admin/notifications/queue?' + params);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.entries.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No queue entries found</td></tr>';
      document.getElementById('queuePagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.entries.map(e => `
      <tr>
        <td class="truncate-text" title="${e.user_id}">${e.user_id}</td>
        <td>${e.template_key}</td>
        <td>${(e.channels || []).join(', ')}</td>
        <td>${e.priority || 'normal'}</td>
        <td><span class="badge badge-${e.status}">${e.status}</span></td>
        <td>${e.retry_count}/${e.max_retries}</td>
        <td>${formatDate(e.created_at)}</td>
        <td>
          ${e.status === 'pending'
            ? `<button class="btn-small btn-cancel" data-cancel-id="${e.id}">Cancel</button>`
            : '-'}
        </td>
      </tr>`).join('');

    renderPagination('queuePagination', data.total, 25, queuePage, (p) => {
      queuePage = p;
      loadQueue();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:#ef4444">Error: ${err.message}</td></tr>`;
  }
}

async function cancelQueueEntry(id) {
  if (!confirm('Cancel this queue entry?')) return;
  try {
    const res = await fetch(`/api/admin/notifications/queue/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': CSRF_TOKEN }
    });
    const data = await res.json();
    if (data.success) {
      showAlert('Entry cancelled', 'success');
      loadQueue();
      loadStats();
    } else {
      showAlert(data.message, 'error');
    }
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
}

async function clearQueue() {
  if (!confirm('Clear all completed, failed, and skipped queue entries?')) return;
  try {
    const res = await fetch('/api/admin/notifications/queue', {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': CSRF_TOKEN }
    });
    const data = await res.json();
    if (data.success) {
      showAlert(data.message, 'success');
      loadQueue();
      loadStats();
    } else {
      showAlert(data.message, 'error');
    }
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
}

async function loadLogs() {
  const channel = document.getElementById('logsChannelFilter').value;
  const status  = document.getElementById('logsStatusFilter').value;
  const tbody   = document.getElementById('logsTableBody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

  try {
    const params = new URLSearchParams({ page: logsPage, limit: 25 });
    if (channel) params.set('channel', channel);
    if (status)  params.set('status', status);

    const res  = await fetch('/api/admin/notifications/logs?' + params);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    if (!data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No delivery logs found</td></tr>';
      document.getElementById('logsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = data.logs.map(l => `
      <tr>
        <td class="truncate-text" title="${l.user_id || ''}">${l.user_id || '-'}</td>
        <td>${l.template_key || '-'}</td>
        <td>${l.channel || '-'}</td>
        <td><span class="badge badge-${l.status}">${l.status}</span></td>
        <td class="truncate-text" title="${l.error_message || ''}">${l.error_message || '-'}</td>
        <td>${l.delivered_at ? formatDate(l.delivered_at) : '-'}</td>
        <td>${formatDate(l.created_at)}</td>
      </tr>`).join('');

    renderPagination('logsPagination', data.total, 25, logsPage, (p) => {
      logsPage = p;
      loadLogs();
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#ef4444">Error: ${err.message}</td></tr>`;
  }
}

async function clearLogs() {
  if (!confirm('Delete ALL notification delivery logs? This cannot be undone.')) return;
  try {
    const res  = await fetch('/api/admin/notifications/logs', {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': CSRF_TOKEN }
    });
    const data = await res.json();
    if (data.success) {
      showAlert(`${data.deleted} log entries deleted`, 'success');
      loadLogs();
    } else {
      showAlert(data.message, 'error');
    }
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
}

async function loadTemplates() {
  const sel = document.getElementById('sendTemplate');
  if (sel.dataset.loaded) return;
  try {
    const res  = await fetch('/api/admin/notifications/templates');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    sel.innerHTML = data.templates.map(t =>
      `<option value="${t.key}">${t.name || t.key}</option>`
    ).join('');
    sel.dataset.loaded = '1';
  } catch (err) {
    sel.innerHTML = '<option value="">Failed to load templates</option>';
  }
}

async function sendManualNotification() {
  const userId      = document.getElementById('sendUserId').value.trim();
  const templateKey = document.getElementById('sendTemplate').value;
  const channels    = [...document.querySelectorAll('input[name="sendChannel"]:checked')].map(c => c.value);
  const varText     = document.getElementById('sendVariables').value.trim();

  if (!userId) return showAlert('User ID is required', 'error');
  if (!templateKey) return showAlert('Please select a template', 'error');
  if (!channels.length) return showAlert('Select at least one channel', 'error');

  let variables = {};
  if (varText) {
    try { variables = JSON.parse(varText); }
    catch { return showAlert('Variables must be valid JSON', 'error'); }
  }

  try {
    const res = await fetch('/api/admin/notifications/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': CSRF_TOKEN
      },
      body: JSON.stringify({ userId, templateKey, channels, variables })
    });
    const data = await res.json();
    if (data.success) {
      showAlert('Notification queued successfully', 'success');
      loadStats();
      loadQueue();
    } else {
      showAlert(data.message || 'Failed to send', 'error');
    }
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
}

function refreshAll() {
  loadStats();
  loadChannelStatus();
  // Reload active tab
  if (document.getElementById('queueTab').classList.contains('active')) loadQueue();
  if (document.getElementById('logsTab').classList.contains('active'))  loadLogs();
}

function formatDate(str) {
  if (!str) return '-';
  try {
    return new Date(str).toLocaleString();
  } catch {
    return str;
  }
}

function renderPagination(containerId, total, perPage, currentPage, onPage) {
  const totalPages = Math.ceil(total / perPage);
  const el = document.getElementById(containerId);
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = `<span style="color:var(--text-secondary);font-size:0.85rem;">${total} total</span>`;
  html += `<button class="page-btn" data-pagination="${containerId}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Prev</button>`;
  const start = Math.max(1, currentPage - 2);
  const end   = Math.min(totalPages, currentPage + 2);
  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-pagination="${containerId}" data-page="${i}">${i}</button>`;
  }
  html += `<button class="page-btn" data-pagination="${containerId}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
  el.innerHTML = html;
}

function showAlert(msg, type) {
  const el = document.getElementById('alertContainer');
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 6000);
}

window.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadChannelStatus();
  loadQueue();

  // Static button listeners
  document.getElementById('btnRefreshAll').addEventListener('click', refreshAll);
  document.getElementById('btnClearQueue').addEventListener('click', clearQueue);
  document.getElementById('btnClearLogs').addEventListener('click', clearLogs);
  document.getElementById('btnSendManual').addEventListener('click', sendManualNotification);

  // Tab buttons (delegated on .tabs container)
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab, btn);
  });

  // Filter selects
  document.getElementById('queueStatusFilter').addEventListener('change', () => { queuePage = 1; loadQueue(); });
  document.getElementById('logsChannelFilter').addEventListener('change', () => { logsPage = 1; loadLogs(); });
  document.getElementById('logsStatusFilter').addEventListener('change', () => { logsPage = 1; loadLogs(); });

  // Dynamic queue cancel buttons (delegated on tbody)
  document.getElementById('queueTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cancel-id]');
    if (btn) cancelQueueEntry(btn.dataset.cancelId);
  });

  // Pagination buttons (delegated on page-content since pagination divs are dynamic)
  document.querySelector('.page-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pagination]');
    if (!btn || btn.disabled) return;
    const containerId = btn.dataset.pagination;
    const page = parseInt(btn.dataset.page, 10);
    if (!page) return;
    if (containerId === 'queuePagination') { queuePage = page; loadQueue(); }
    if (containerId === 'logsPagination')  { logsPage  = page; loadLogs(); }
  });
});
