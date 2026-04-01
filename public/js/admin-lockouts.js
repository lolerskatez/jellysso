const CSRF = document.querySelector('meta[name="csrf-token"]').content;
let allHistory = [];

function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'history' && allHistory.length === 0) loadHistory();
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadLockouts() {
  const wrap = document.getElementById('lockoutsTable');
  try {
    const r = await fetch('/admin/api/lockouts');
    const data = await r.json();
    if (!data.success || !data.lockouts.length) {
      wrap.innerHTML = '<div class="empty-state"><i class="fas fa-unlock"></i><p>No accounts are currently locked.</p></div>';
      return;
    }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Username</th><th>Locked At</th><th>Unlocks At</th><th>Attempts</th><th>Reason</th><th></th>
      </tr></thead>
      <tbody>${data.lockouts.map(l => `<tr>
        <td><strong>${escHtml(l.username)}</strong></td>
        <td>${new Date(l.locked_at).toLocaleString()}</td>
        <td>${new Date(l.unlock_at).toLocaleString()}</td>
        <td>${l.attempts_count || 0}</td>
        <td>${escHtml(l.reason || '—')}</td>
        <td><button class="btn-danger btn-sm" data-unlock-username="${escHtml(l.username)}"><i class="fas fa-unlock"></i> Unlock</button></td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) {
    wrap.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load lockouts.</p></div>';
  }
}

async function unlockAccount(username) {
  if (!confirm(`Unlock account "${username}"?`)) return;
  try {
    const r = await fetch(`/admin/api/lockouts/${encodeURIComponent(username)}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast('Account unlocked.', 'success');
    loadLockouts();
  } catch(e) { showToast(e.message || 'Failed to unlock.', 'error'); }
}

async function loadHistory(username) {
  const wrap = document.getElementById('historyTable');
  wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="font-size:2rem"></i></div>';
  const q = username ? `?username=${encodeURIComponent(username)}&limit=200` : '?limit=200';
  try {
    const r = await fetch(`/admin/api/lockouts/history${q}`);
    const data = await r.json();
    allHistory = data.attempts || [];
    renderHistory(allHistory);
  } catch(e) {
    wrap.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load history.</p></div>';
  }
}

function renderHistory(rows) {
  const wrap = document.getElementById('historyTable');
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No login attempts found.</p></div>';
    return;
  }
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Username</th><th>IP Address</th><th>Timestamp</th><th>Result</th><th>Reason</th>
    </tr></thead>
    <tbody>${rows.map(a => `<tr>
      <td class="mono">${escHtml(a.username)}</td>
      <td class="mono">${escHtml(a.ip_address)}</td>
      <td>${new Date(a.timestamp).toLocaleString()}</td>
      <td>${a.success ? '<span class="badge-success">Success</span>' : '<span class="badge-danger">Failed</span>'}</td>
      <td>${escHtml(a.reason || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

function filterHistory() {
  const q = document.getElementById('historyFilter').value.trim().toLowerCase();
  if (!q) { renderHistory(allHistory); return; }
  renderHistory(allHistory.filter(a => a.username.toLowerCase().includes(q) || (a.ip_address || '').toLowerCase().includes(q)));
}

async function cleanupOld() {
  if (!confirm('Delete login attempt records older than 30 days?')) return;
  try {
    const r = await fetch('/admin/api/lockouts/cleanup', {
      method: 'POST',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(`Deleted ${data.deleted} old records.`, 'success');
    allHistory = [];
    loadHistory();
  } catch(e) { showToast(e.message || 'Cleanup failed.', 'error'); }
}

function showToast(msg, type) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3500);
}

// Tab switching via event delegation
document.querySelector('.tabs').addEventListener('click', function(e) {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab, btn);
});

// Static button wiring
document.getElementById('cleanupOldBtn')?.addEventListener('click', cleanupOld);
document.getElementById('refreshHistoryBtn')?.addEventListener('click', loadHistory);
document.getElementById('historyFilter')?.addEventListener('input', filterHistory);

// Event delegation for dynamic unlock buttons
document.getElementById('lockoutsTable').addEventListener('click', function(e) {
  const btn = e.target.closest('[data-unlock-username]');
  if (btn) unlockAccount(btn.dataset.unlockUsername);
});

loadLockouts();
