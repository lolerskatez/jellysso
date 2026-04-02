const csrf = document.querySelector('meta[name="csrf-token"]').content;
let allWebhooks = [];

async function loadWebhooks() {
  try {
    const r = await fetch('/admin/api/webhooks');
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    allWebhooks = d.webhooks;
    renderStats();
    renderTable();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderStats() {
  document.getElementById('statTotal').textContent = allWebhooks.length;
  document.getElementById('statActive').textContent = allWebhooks.filter(w => w.active).length;
  document.getElementById('statFailed').textContent = allWebhooks.reduce((s, w) => s + (w.failed_count || 0), 0);
}

function renderTable() {
  const search = document.getElementById('filterSearch').value.toLowerCase();
  const status = document.getElementById('filterStatus').value;
  const tbody = document.getElementById('webhookTbody');

  let rows = allWebhooks;
  if (search) rows = rows.filter(w => w.url.toLowerCase().includes(search) || (w.user_id || '').toLowerCase().includes(search));
  if (status !== '') rows = rows.filter(w => String(w.active ? 1 : 0) === status);

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><i class="fas fa-plug"></i><br>No webhooks found</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(w => `
    <tr>
      <td>${w.id}</td>
      <td class="url-cell" title="${escHtml(w.url)}">${escHtml(w.url.length > 50 ? w.url.substring(0, 47) + '…' : w.url)}</td>
      <td style="font-family:monospace;font-size:.8rem">${escHtml(w.user_id || '—')}</td>
      <td>${(w.events || []).map(e => `<span class="badge badge-event">${escHtml(e)}</span>`).join('')}</td>
      <td><span class="badge ${w.active ? 'badge-active' : 'badge-inactive'}">${w.active ? 'Active' : 'Inactive'}</span></td>
      <td>${w.event_count || 0} total${w.failed_count ? ` / <span style="color:#dc3545">${w.failed_count} failed</span>` : ''}</td>
      <td style="font-size:.82rem;white-space:nowrap">${formatDate(w.created_at)}</td>
      <td class="actions-cell">
        <button class="btn-secondary btn-sm" data-edit-id="${w.id}" title="Edit"><i class="fas fa-edit"></i></button>
        <button class="btn-secondary btn-sm" data-toggle-id="${w.id}" data-toggle-active="${w.active ? 0 : 1}" title="${w.active ? 'Disable' : 'Enable'}"><i class="fas fa-power-off"></i></button>
        <button class="btn-secondary btn-sm" data-test-id="${w.id}" title="Send test"><i class="fas fa-vial"></i></button>
        <button class="btn-secondary btn-sm" data-history-id="${w.id}" data-history-url="${escHtml(w.url)}"><i class="fas fa-history"></i></button>
        <button class="btn-danger btn-sm" data-delete-id="${w.id}"><i class="fas fa-trash"></i></button>
      </td>
    </tr>
  `).join('');
}

function openCreateModal() {
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'New Webhook';
  document.getElementById('editId').value = '';
  document.getElementById('wUserId').value = '';
  document.getElementById('wUrl').value = '';
  document.getElementById('wSecret').value = '';
  document.getElementById('wRetry').value = 3;
  document.getElementById('wTimeout').value = 30;
  document.getElementById('wUserId').disabled = false;
  document.querySelectorAll('#eventsGrid input').forEach(cb => cb.checked = false);
  document.getElementById('modalError').style.display = 'none';
  document.getElementById('webhookModal').classList.add('open');
}

function openEditModal(id) {
  const w = allWebhooks.find(x => x.id === id);
  if (!w) return;
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'Edit Webhook';
  document.getElementById('editId').value = id;
  document.getElementById('wUserId').value = w.user_id;
  document.getElementById('wUserId').disabled = true;
  document.getElementById('wUrl').value = w.url;
  document.getElementById('wSecret').value = w.secret || '';
  document.getElementById('wRetry').value = w.retry_count ?? 3;
  document.getElementById('wTimeout').value = w.timeout_seconds ?? 30;
  document.querySelectorAll('#eventsGrid input').forEach(cb => {
    cb.checked = (w.events || []).includes(cb.value);
  });
  document.getElementById('modalError').style.display = 'none';
  document.getElementById('webhookModal').classList.add('open');
}

function closeModal() {
  document.getElementById('webhookModal').classList.remove('open');
}

async function saveWebhook() {
  const btn = document.getElementById('modalSaveBtn');
  const errEl = document.getElementById('modalError');
  const editId = document.getElementById('editId').value;
  const url = document.getElementById('wUrl').value.trim();
  const userId = document.getElementById('wUserId').value.trim();
  const secret = document.getElementById('wSecret').value.trim();
  const retryCount = parseInt(document.getElementById('wRetry').value) || 3;
  const timeoutSeconds = parseInt(document.getElementById('wTimeout').value) || 30;
  const events = Array.from(document.querySelectorAll('#eventsGrid input:checked')).map(cb => cb.value);

  errEl.style.display = 'none';
  if (!url) { errEl.textContent = 'URL is required.'; errEl.style.display = ''; return; }
  if (!editId && !userId) { errEl.textContent = 'User ID is required.'; errEl.style.display = ''; return; }
  if (events.length === 0) { errEl.textContent = 'Select at least one event.'; errEl.style.display = ''; return; }

  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    let r, d;
    if (editId) {
      r = await fetch(`/admin/api/webhooks/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ url, events, secret: secret || null, retryCount, timeoutSeconds })
      });
    } else {
      r = await fetch('/admin/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ userId, url, events, secret: secret || null, retryCount, timeoutSeconds })
      });
    }
    d = await r.json();
    if (!d.success) throw new Error(d.error);
    closeModal();
    showToast(editId ? 'Webhook updated' : 'Webhook created', 'success');
    await loadWebhooks();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

async function toggleWebhook(id, newActive) {
  try {
    const r = await fetch(`/admin/api/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ active: !!newActive })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    showToast(newActive ? 'Webhook enabled' : 'Webhook disabled', 'success');
    await loadWebhooks();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function sendTest(id) {
  try {
    const r = await fetch(`/admin/api/webhooks/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    showToast('Test event sent', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteWebhook(id) {
  if (!confirm('Delete this webhook and all its delivery history?')) return;
  try {
    const r = await fetch(`/admin/api/webhooks/${id}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf }
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    showToast('Webhook deleted', 'success');
    await loadWebhooks();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function openDrawer(id, url) {
  document.getElementById('drawerTitle').textContent = `Delivery History — #${id}`;
  document.getElementById('drawerContent').innerHTML = '<p style="color:var(--text-muted)">Loading…</p>';
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('eventsDrawer').classList.add('open');
  try {
    const r = await fetch(`/admin/api/webhooks/${id}/events?limit=100`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error);
    if (d.events.length === 0) {
      document.getElementById('drawerContent').innerHTML = '<p style="color:var(--text-muted)">No deliveries yet.</p>';
      return;
    }
    document.getElementById('drawerContent').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.85rem">
        <thead><tr>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color)">Type</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color)">Status</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color)">Code</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color)">Attempts</th>
          <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border-color)">Date</th>
        </tr></thead>
        <tbody>
          ${d.events.map(e => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid var(--border-color)">${escHtml(e.event_type)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--border-color)"><span class="status-${e.status}">${e.status}</span></td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--border-color)">${e.response_code || '—'}</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--border-color)">${e.attempts}</td>
              <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);white-space:nowrap">${formatDate(e.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById('drawerContent').innerHTML = `<p style="color:#dc3545">${escHtml(e.message)}</p>`;
  }
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('eventsDrawer').classList.remove('open');
}

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type) {
  const el = document.getElementById('toastMsg');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3000);
}

document.getElementById('webhookModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('webhookModal')) closeModal();
});

// Static button wiring
document.getElementById('newWebhookBtn')?.addEventListener('click', openCreateModal);
document.getElementById('cancelWebhookBtn')?.addEventListener('click', closeModal);
document.getElementById('closeWebhookModalBtn')?.addEventListener('click', closeModal);
document.getElementById('modalSaveBtn')?.addEventListener('click', saveWebhook);
document.getElementById('refreshWebhooksBtn')?.addEventListener('click', loadWebhooks);
document.getElementById('closeDrawerBtn')?.addEventListener('click', closeDrawer);
document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
document.getElementById('filterSearch')?.addEventListener('input', renderTable);
document.getElementById('filterStatus')?.addEventListener('change', renderTable);

// Event delegation for dynamic table buttons
document.getElementById('webhookTbody').addEventListener('click', function(e) {
  const editBtn = e.target.closest('[data-edit-id]');
  if (editBtn) { openEditModal(parseInt(editBtn.dataset.editId)); return; }
  const toggleBtn = e.target.closest('[data-toggle-id]');
  if (toggleBtn) { toggleWebhook(parseInt(toggleBtn.dataset.toggleId), parseInt(toggleBtn.dataset.toggleActive)); return; }
  const testBtn = e.target.closest('[data-test-id]');
  if (testBtn) { sendTest(parseInt(testBtn.dataset.testId)); return; }
  const histBtn = e.target.closest('[data-history-id]');
  if (histBtn) { openDrawer(parseInt(histBtn.dataset.historyId), histBtn.dataset.historyUrl); return; }
  const deleteBtn = e.target.closest('[data-delete-id]');
  if (deleteBtn) { deleteWebhook(parseInt(deleteBtn.dataset.deleteId)); }
});

loadWebhooks();
