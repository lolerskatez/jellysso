const csrf = document.querySelector('meta[name="csrf-token"]').content;
let allDevices = [];
let debTimer = null;

async function loadDevices() {
  const userId = document.getElementById('filterUserId').value.trim();
  const url = userId ? `/api/policy/admin/devices?userId=${encodeURIComponent(userId)}` : '/api/policy/admin/devices';
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Failed to load');
    allDevices = d.devices || [];
    renderTable();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function renderTable() {
  const tbody = document.getElementById('deviceTbody');
  if (allDevices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-laptop"></i><br>No whitelisted devices found</div></td></tr>';
    return;
  }
  tbody.innerHTML = allDevices.map(d => `
    <tr>
      <td class="uid-cell" title="${escH(d.userId)}">${escH(d.userId)}</td>
      <td style="font-family:monospace;font-size:.8rem">${escH(d.deviceId)}</td>
      <td>${escH(d.deviceName || '—')}</td>
      <td>${escH(d.deviceType || '—')}</td>
      <td style="white-space:nowrap;font-size:.82rem">${formatDate(d.addedAt)}</td>
      <td>
        <button class="btn-danger btn-sm" data-remove-user="${escH(d.userId)}" data-remove-device="${escH(d.deviceId)}">
          <i class="fas fa-trash"></i> Remove
        </button>
      </td>
    </tr>`).join('');
}

function openAddModal() {
  document.getElementById('mUserId').value = '';
  document.getElementById('mDeviceId').value = '';
  document.getElementById('mDeviceName').value = '';
  document.getElementById('mDeviceType').value = '';
  document.getElementById('addModalError').style.display = 'none';
  document.getElementById('addModal').classList.add('open');
}

function closeModal() { document.getElementById('addModal').classList.remove('open'); }

async function saveDevice() {
  const userId = document.getElementById('mUserId').value.trim();
  const deviceId = document.getElementById('mDeviceId').value.trim();
  const deviceName = document.getElementById('mDeviceName').value.trim();
  const deviceType = document.getElementById('mDeviceType').value.trim();
  const errEl = document.getElementById('addModalError');
  errEl.style.display = 'none';

  if (!userId) { errEl.textContent = 'User ID is required.'; errEl.style.display = ''; return; }
  if (!deviceId) { errEl.textContent = 'Device ID is required.'; errEl.style.display = ''; return; }

  const btn = document.getElementById('addSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch(`/api/policy/admin/user/${encodeURIComponent(userId)}/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ deviceId, deviceName: deviceName || null, deviceType: deviceType || null })
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Failed to add device');
    closeModal();
    showToast('Device whitelisted', 'success');
    await loadDevices();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Add Device';
  }
}

async function removeDevice(userId, deviceId) {
  if (!confirm(`Remove device "${deviceId}" from whitelist for user "${userId}"?`)) return;
  try {
    const r = await fetch(`/api/policy/admin/user/${encodeURIComponent(userId)}/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrf }
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Failed to remove');
    showToast('Device removed', 'success');
    await loadDevices();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function debounceLoad() {
  clearTimeout(debTimer);
  debTimer = setTimeout(loadDevices, 350);
}

function formatDate(s) { if (!s) return '—'; return new Date(s).toLocaleString(); }
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showToast(msg, type) {
  const el = document.getElementById('toastMsg');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3000);
}

document.getElementById('addModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('addModal')) closeModal();
});

// Event delegation for dynamic table buttons
document.getElementById('deviceTbody')?.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-remove-user]');
  if (btn) removeDevice(btn.dataset.removeUser, btn.dataset.removeDevice);
});

// Button wiring
document.getElementById('addDeviceBtn')?.addEventListener('click', openAddModal);
document.getElementById('refreshDevicesBtn')?.addEventListener('click', loadDevices);
document.getElementById('filterUserId')?.addEventListener('input', debounceLoad);
document.getElementById('cancelAddBtn')?.addEventListener('click', closeModal);
document.getElementById('closeAddModalBtn')?.addEventListener('click', closeModal);
document.getElementById('addSaveBtn')?.addEventListener('click', saveDevice);

loadDevices();
