const CSRF = document.querySelector('meta[name="csrf-token"]').content;

async function loadKeys() {
  const wrap = document.getElementById('keysTable');
  try {
    const r = await fetch('/admin/api/api-keys');
    const data = await r.json();
    if (!data.success || !data.keys.length) {
      wrap.innerHTML = '<div class="empty-state"><i class="fas fa-key"></i><p>No API keys yet.</p></div>';
      return;
    }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th>Name</th><th>User ID</th><th>Permissions</th><th>Last Used</th><th>Requests</th><th>Status</th><th>Expires</th><th></th>
      </tr></thead>
      <tbody>${data.keys.map(k => {
        const expired = k.expires_at && new Date(k.expires_at) < new Date();
        const status = expired ? '<span class="status-expired">Expired</span>'
                     : k.active ? '<span class="status-active">Active</span>'
                     : '<span class="status-revoked">Revoked</span>';
        const perms = (k.permissions || []).map(p => `<span class="perm-badge perm-${p}">${p}</span>`).join('');
        return `<tr>
          <td><strong>${escHtml(k.name)}</strong></td>
          <td class="mono">${escHtml(k.user_id)}</td>
          <td>${perms || '<span style="color:var(--text-muted)">—</span>'}</td>
          <td>${k.last_used ? new Date(k.last_used).toLocaleString() : '—'}</td>
          <td>${k.request_count || 0}</td>
          <td>${status}</td>
          <td>${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : '—'}</td>
          <td style="white-space:nowrap">
            ${k.active && !expired ? `<button class="btn-secondary" data-revoke-id="${k.id}" data-revoke-name="${escHtml(k.name)}">Revoke</button> ` : ''}
            <button class="btn-danger" data-delete-id="${k.id}" data-delete-name="${escHtml(k.name)}"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;
  } catch(e) {
    wrap.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load keys.</p></div>';
  }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openCreate() {
  document.getElementById('newKeyDisplay').style.display = 'none';
  document.getElementById('createForm').style.display = 'block';
  document.getElementById('saveKeyBtn').style.display = 'inline-block';
  document.getElementById('keyUserId').value = '';
  document.getElementById('keyName').value = '';
  document.getElementById('permRead').checked = true;
  document.getElementById('permWrite').checked = false;
  document.getElementById('permAdmin').checked = false;
  document.getElementById('keyExpires').value = '';
  document.getElementById('createModal').classList.add('show');
}

function closeCreate() {
  document.getElementById('createModal').classList.remove('show');
  loadKeys();
}

async function createKey() {
  const userId = document.getElementById('keyUserId').value.trim();
  const name = document.getElementById('keyName').value.trim();
  if (!userId || !name) { showToast('User ID and name are required.', 'error'); return; }
  const permissions = [];
  if (document.getElementById('permRead').checked) permissions.push('read');
  if (document.getElementById('permWrite').checked) permissions.push('write');
  if (document.getElementById('permAdmin').checked) permissions.push('admin');
  const expiresAt = document.getElementById('keyExpires').value || null;
  try {
    const r = await fetch('/admin/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify({ userId, name, permissions, expiresAt })
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    document.getElementById('newKeyValue').textContent = data.key.key;
    document.getElementById('newKeyDisplay').style.display = 'block';
    document.getElementById('createForm').style.display = 'none';
    document.getElementById('saveKeyBtn').style.display = 'none';
  } catch(e) { showToast(e.message || 'Create failed.', 'error'); }
}

function copyKey() {
  const text = document.getElementById('newKeyValue').textContent;
  navigator.clipboard.writeText(text).then(() => showToast('Key copied!', 'success'));
}

async function revokeKey(id, name) {
  if (!confirm(`Revoke key "${name}"? It will stop working immediately.`)) return;
  try {
    const r = await fetch(`/admin/api/api-keys/${id}/revoke`, {
      method: 'PATCH',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast('Key revoked.', 'success');
    loadKeys();
  } catch(e) { showToast(e.message || 'Revoke failed.', 'error'); }
}

async function deleteKey(id, name) {
  if (!confirm(`Permanently delete key "${name}"?`)) return;
  try {
    const r = await fetch(`/admin/api/api-keys/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast('Key deleted.', 'success');
    loadKeys();
  } catch(e) { showToast(e.message || 'Delete failed.', 'error'); }
}

function showToast(msg, type) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3500);
}

// Static button wiring
document.getElementById('createKeyBtn')?.addEventListener('click', openCreate);
document.getElementById('cancelCreateBtn')?.addEventListener('click', closeCreate);
document.getElementById('closeCreateModalBtn')?.addEventListener('click', closeCreate);
document.getElementById('saveKeyBtn')?.addEventListener('click', createKey);
document.getElementById('copyKeyBtn')?.addEventListener('click', copyKey);

// Backdrop click
document.getElementById('createModal').addEventListener('click', e => {
  if (e.target === document.getElementById('createModal')) closeCreate();
});

// Event delegation for dynamic table buttons
document.getElementById('keysTable').addEventListener('click', function(e) {
  const revokeBtn = e.target.closest('[data-revoke-id]');
  if (revokeBtn) { revokeKey(revokeBtn.dataset.revokeId, revokeBtn.dataset.revokeName); return; }
  const deleteBtn = e.target.closest('[data-delete-id]');
  if (deleteBtn) { deleteKey(deleteBtn.dataset.deleteId, deleteBtn.dataset.deleteName); }
});

loadKeys();
