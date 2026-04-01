const CSRF = document.querySelector('meta[name="csrf-token"]').content;
const PRESET_COLORS = ['#0066CC','#28a745','#dc3545','#ffc107','#17a2b8','#6f42c1','#e83e8c','#fd7e14','#6c757d','#20c997'];
let labelsCache = [];

// Build preset swatches
const presetsEl = document.getElementById('colorPresets');
PRESET_COLORS.forEach(c => {
  const s = document.createElement('div');
  s.className = 'color-preset';
  s.style.background = c;
  s.title = c;
  s.onclick = null;
  s.addEventListener('click', () => document.getElementById('labelColor').value = c);
  presetsEl.appendChild(s);
});

async function loadLabels() {
  const grid = document.getElementById('labelsGrid');
  try {
    const r = await fetch('/api/labels?includeStats=true');
    const data = await r.json();
    if (!data.success || !data.labels.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-tags"></i><p>No labels yet. Create one to start organising users.</p></div>';
      return;
    }
    labelsCache = data.labels;
    grid.innerHTML = data.labels.map(l => `
      <div class="label-card" style="border-left-color:${escHtml(l.color || '#0066cc')}">
        <div class="label-card-header">
          <div class="label-name">
            <span class="label-dot" style="background:${escHtml(l.color || '#0066cc')}"></span>
            ${escHtml(l.name)}
          </div>
          <div class="label-actions">
            <button class="btn-secondary" data-edit-id="${l.id}"><i class="fas fa-edit"></i></button>
            <button class="btn-danger" data-delete-id="${l.id}" data-delete-name="${escHtml(l.name)}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        ${l.description ? `<p class="label-desc">${escHtml(l.description)}</p>` : ''}
        <div class="label-meta">
          <span class="user-count-badge"><i class="fas fa-users"></i> ${l.userCount || 0} user${l.userCount !== 1 ? 's' : ''}</span>
          &nbsp;&bull;&nbsp;Created ${new Date(l.createdAt).toLocaleDateString()}
        </div>
      </div>`).join('');
  } catch(e) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-exclamation-circle"></i><p>Failed to load labels.</p></div>';
  }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openCreate() {
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'New Label';
  document.getElementById('editId').value = '';
  document.getElementById('labelName').value = '';
  document.getElementById('labelColor').value = '#0066CC';
  document.getElementById('labelDesc').value = '';
  document.getElementById('labelModal').classList.add('show');
}

function openEdit(l) {
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'Edit Label';
  document.getElementById('editId').value = l.id;
  document.getElementById('labelName').value = l.name;
  document.getElementById('labelColor').value = l.color || '#0066CC';
  document.getElementById('labelDesc').value = l.description || '';
  document.getElementById('labelModal').classList.add('show');
}

function closeModal() { document.getElementById('labelModal').classList.remove('show'); }

async function saveLabel() {
  const id = document.getElementById('editId').value;
  const name = document.getElementById('labelName').value.trim();
  if (!name) { showToast('Label name is required.', 'error'); return; }
  const body = {
    name,
    color: document.getElementById('labelColor').value,
    description: document.getElementById('labelDesc').value.trim() || null
  };
  try {
    const r = await fetch(id ? `/api/labels/${id}` : '/api/labels', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': CSRF },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast(id ? 'Label updated.' : 'Label created.', 'success');
    closeModal();
    loadLabels();
  } catch(e) { showToast(e.message || 'Save failed.', 'error'); }
}

async function deleteLabel(id, name) {
  if (!confirm(`Delete label "${name}"? Users will be untagged.`)) return;
  try {
    const r = await fetch(`/api/labels/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': CSRF }
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    showToast('Label deleted.', 'success');
    loadLabels();
  } catch(e) { showToast(e.message || 'Delete failed.', 'error'); }
}

function showToast(msg, type) {
  const t = document.getElementById('toastMsg');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3000);
}

document.getElementById('labelModal').addEventListener('click', e => { if (e.target === document.getElementById('labelModal')) closeModal(); });
document.getElementById('newLabelBtn')?.addEventListener('click', openCreate);
document.getElementById('cancelLabelBtn')?.addEventListener('click', closeModal);
document.getElementById('closeLabelModalBtn')?.addEventListener('click', closeModal);
document.getElementById('saveLabelBtn')?.addEventListener('click', saveLabel);

// Event delegation for dynamically rendered label cards
document.getElementById('labelsGrid')?.addEventListener('click', e => {
  const editBtn = e.target.closest('[data-edit-id]');
  if (editBtn) {
    const id = editBtn.dataset.editId;
    const label = labelsCache.find(l => String(l.id) === String(id));
    if (label) openEdit(label);
    return;
  }
  const delBtn = e.target.closest('[data-delete-id]');
  if (delBtn) deleteLabel(delBtn.dataset.deleteId, delBtn.dataset.deleteName);
});

loadLabels();
