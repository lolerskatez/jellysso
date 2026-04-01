const CSRF = document.querySelector('meta[name="csrf-token"]').content;

async function loadAnnouncements() {
  const list = document.getElementById('announcementsList');
  try {
    const r = await fetch('/api/announcements/admin');
    const data = await r.json();
    if (!data.success || !data.announcements.length) {
      list.innerHTML = '<div class="empty-state"><i class="fas fa-bullhorn"></i><p>No announcements yet. Create one to get started.</p></div>';
      return;
    }
    list.innerHTML = data.announcements.map(a => {
      const expired = a.expires_at && new Date(a.expires_at) < new Date();
      const badgeClass = expired ? 'badge-expired' : (a.is_active ? 'badge-active' : 'badge-inactive');
      const badgeText = expired ? 'Expired' : (a.is_active ? 'Active' : 'Inactive');
      const expiryStr = a.expires_at ? `Expires ${new Date(a.expires_at).toLocaleString()}` : 'No expiry';
      return `
        <div class="announcement-card ${a.is_active && !expired ? '' : 'inactive'}">
          <div class="announcement-header">
            <div>
              <p class="announcement-title">${escHtml(a.title)}</p>
              <div class="announcement-meta">
                <span class="badge ${badgeClass}">${badgeText}</span>
                &nbsp;&bull;&nbsp;Priority: ${a.display_priority || 0}
                &nbsp;&bull;&nbsp;Created ${new Date(a.created_at).toLocaleString()}
                &nbsp;&bull;&nbsp;${expiryStr}
              </div>
            </div>
            <div class="announcement-actions">
              <button class="btn-secondary" onclick="openEdit(${JSON.stringify(a).replace(/"/g,'&quot;')})"><i class="fas fa-edit"></i></button>
              <button class="btn-secondary" onclick="toggleAnnouncement(${a.id}, ${a.is_active})">
                <i class="fas ${a.is_active ? 'fa-eye-slash' : 'fa-eye'}"></i>
              </button>
              <button class="btn-danger" onclick="deleteAnnouncement(${a.id}, '${escHtml(a.title)}')"><i class="fas fa-trash"></i></button>
            </div>
          </div>
          <p class="announcement-body">${escHtml(a.message)}</p>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load announcements.</p></div>';
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openCreate() {
  document.getElementById('modalTitle').textContent = 'New Announcement';
  document.getElementById('editId').value = '';
  document.getElementById('annTitle').value = '';
  document.getElementById('annMessage').value = '';
  document.getElementById('annPriority').value = '0';
  document.getElementById('annExpires').value = '';
  document.getElementById('activeToggleGroup').style.display = 'none';
  document.getElementById('announcementModal').classList.add('show');
}

function openEdit(ann) {
  document.getElementById('modalTitle').textContent = 'Edit Announcement';
  document.getElementById('editId').value = ann.id;
  document.getElementById('annTitle').value = ann.title;
  document.getElementById('annMessage').value = ann.message;
  document.getElementById('annPriority').value = ann.display_priority || 0;
  document.getElementById('annExpires').value = ann.expires_at ? new Date(ann.expires_at).toISOString().slice(0,16) : '';
  document.getElementById('annActive').checked = !!ann.is_active;
  document.getElementById('activeToggleGroup').style.display = 'block';
  document.getElementById('announcementModal').classList.add('show');
}

function closeModal() {
  document.getElementById('announcementModal').classList.remove('show');
}

async function saveAnnouncement() {
  const id = document.getElementById('editId').value;
  const title = document.getElementById('annTitle').value.trim();
  const message = document.getElementById('annMessage').value.trim();
  if (!title || !message) { showToast('Title and message are required.', 'error'); return; }

  const body = {
    title,
    message,
    displayPriority: parseInt(document.getElementById('annPriority').value) || 0,
    expiresAt: document.getElementById('annExpires').value || null,
    isActive: document.getElementById('annActive').checked
  };

  try {
    const r = await fetch(id ? `/api/announcements/${id}` : '/api/announcements', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(id ? 'Announcement updated.' : 'Announcement created.', 'success');
    closeModal();
    loadAnnouncements();
  } catch (e) {
    showToast(e.message || 'Save failed.', 'error');
  }
}

async function toggleAnnouncement(id, currentlyActive) {
  try {
    const r = await fetch(`/api/announcements/${id}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(currentlyActive ? 'Announcement hidden.' : 'Announcement shown.', 'success');
    loadAnnouncements();
  } catch (e) {
    showToast(e.message || 'Toggle failed.', 'error');
  }
}

async function deleteAnnouncement(id, title) {
  if (!confirm(`Delete announcement "${title}"? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/announcements/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast('Announcement deleted.', 'success');
    loadAnnouncements();
  } catch (e) {
    showToast(e.message || 'Delete failed.', 'error');
  }
}

function showToast(msg, type) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3000);
}

// Close modal on backdrop click
document.getElementById('announcementModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

loadAnnouncements();
