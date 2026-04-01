const CSRF = () => document.querySelector('meta[name="csrf-token"]').content;
let templates = [];
let currentKey = null;

async function loadTemplates() {
  try {
    const res = await fetch('/api/admin/templates');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    templates = data.templates;
    renderList();
  } catch (e) {
    showAlert('Failed to load templates: ' + e.message, 'error');
  }
}

function renderList() {
  const container = document.getElementById('templateListItems');
  container.innerHTML = '';
  templates.forEach(t => {
    const item = document.createElement('div');
    item.className = 'template-item' + (t.key === currentKey ? ' active' : '');
    item.dataset.key = t.key;
    item.onclick = () => openTemplate(t.key);
    item.innerHTML = `
      <div>
        <div class="template-item-name">${escHtml(t.title || t.key)}</div>
        <div class="template-item-key">{{${escHtml(t.key)}}}</div>
      </div>
      <i class="fas fa-circle ${t.is_active ? 'badge-active' : 'badge-inactive'}" title="${t.is_active ? 'Active' : 'Inactive'}"></i>
    `;
    container.appendChild(item);
  });
}

function openTemplate(key) {
  currentKey = key;
  const t = templates.find(x => x.key === key);
  if (!t) return;

  renderList(); // re-render to update active state

  const vars = Array.isArray(t.variables) ? t.variables : (t.variables ? JSON.parse(t.variables) : []);

  document.getElementById('editorPanel').className = 'editor-panel';
  document.getElementById('editorPanel').innerHTML = `
    <div class="editor-header">
      <div class="editor-title">
        <h2>${escHtml(t.title || t.key)}</h2>
        <small>key: ${escHtml(t.key)}</small>
      </div>
      <div class="editor-actions">
        <label class="toggle-switch" title="${t.is_active ? 'Click to disable' : 'Click to enable'}">
          <input type="checkbox" id="toggleActiveChk" data-toggle-key="${escHtml(t.key)}" ${t.is_active ? 'checked' : ''}>
          <span class="toggle-track"></span>
          <span id="toggleActiveLabel" style="font-size:0.85rem;font-weight:500">${t.is_active ? 'Active' : 'Inactive'}</span>
        </label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Title</label>
      <input type="text" id="fieldTitle" class="form-control" value="${escHtml(t.title || '')}">
    </div>

    <div class="form-group">
      <label class="form-label">Subject</label>
      <input type="text" id="fieldSubject" class="form-control" value="${escHtml(t.subject || '')}">
    </div>

    <div class="form-group">
      <label class="form-label">Body</label>
      <div class="tabs">
        <button class="tab-btn active" data-tab="edit"><i class="fas fa-pen"></i> Edit</button>
        <button class="tab-btn" data-tab="preview"><i class="fas fa-eye"></i> Preview</button>
      </div>
      <div id="tab-edit" class="tab-content active">
        <textarea id="fieldBody" class="form-control" rows="12">${escHtml(t.body || '')}</textarea>
        ${vars.length ? `
          <div style="margin-top:8px;">
            <small style="color:var(--text-secondary)">Available variables — click to insert:</small>
            <div class="variable-chips">
              ${vars.map(v => `<span class="variable-chip" data-insert-var="{{${escHtml(v)}}}">{{${escHtml(v)}}}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <div id="tab-preview" class="tab-content">
        <div id="previewBox" class="preview-box" style="white-space:pre-wrap">Click the Preview tab to render a preview.</div>
      </div>
    </div>

    <div style="display:flex;gap:var(--spacing-md);justify-content:flex-end;margin-top:var(--spacing-xl);">
      <button class="btn btn-secondary" data-action="cancel-edit">Cancel</button>
      <button class="btn btn-primary" data-save-key="${escHtml(t.key)}">
        <i class="fas fa-save"></i> Save Template
      </button>
    </div>
  `;
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');

  if (tab === 'preview') {
    loadPreview();
  }
}

async function loadPreview() {
  const body = document.getElementById('fieldBody')?.value || '';
  const previewBox = document.getElementById('previewBox');
  previewBox.textContent = 'Rendering…';

  // Build sample variables from var chips
  const vars = {};
  document.querySelectorAll('.variable-chip').forEach(chip => {
    const v = chip.textContent.trim().replace(/[{}]/g, '');
    vars[v] = `[${v}]`;
  });

  try {
    const res = await fetch(`/api/admin/templates/${encodeURIComponent(currentKey)}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF() },
      body: JSON.stringify({ body, variables: vars })
    });
    const data = await res.json();
    previewBox.textContent = data.success ? data.rendered : ('Error: ' + data.error);
  } catch (e) {
    previewBox.textContent = 'Preview failed: ' + e.message;
  }
}

function insertVar(text) {
  const ta = document.getElementById('fieldBody');
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}

async function saveTemplate(key) {
  const title = document.getElementById('fieldTitle')?.value?.trim();
  const subject = document.getElementById('fieldSubject')?.value?.trim();
  const body = document.getElementById('fieldBody')?.value?.trim();

  if (!title || !subject || !body) {
    showAlert('Title, subject, and body are required', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/admin/templates/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF() },
      body: JSON.stringify({ title, subject, body, format: 'markdown' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showAlert('Template saved successfully!', 'success');
    await loadTemplates();
    openTemplate(key); // Re-open to keep editing
  } catch (e) {
    showAlert('Save failed: ' + e.message, 'error');
  }
}

async function toggleActive(key, isActive) {
  try {
    const res = await fetch(`/api/admin/templates/${encodeURIComponent(key)}/toggle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CSRF() },
      body: JSON.stringify({ isActive })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const label = document.getElementById('toggleActiveLabel');
    if (label) label.textContent = isActive ? 'Active' : 'Inactive';

    // Update local cache
    const t = templates.find(x => x.key === key);
    if (t) t.is_active = isActive ? 1 : 0;
    renderList();
    showAlert(`Template ${isActive ? 'enabled' : 'disabled'}`, 'success');
  } catch (e) {
    showAlert('Toggle failed: ' + e.message, 'error');
  }
}

function cancelEdit() {
  currentKey = null;
  renderList();
  document.getElementById('editorPanel').className = 'editor-panel empty-state';
  document.getElementById('editorPanel').innerHTML = `
    <i class="fas fa-envelope-open-text"></i>
    <p>Select a template to edit</p>
  `;
}

function showAlert(message, type) {
  const container = document.getElementById('alertContainer');
  container.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${escHtml(message)}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 5000);
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

window.addEventListener('DOMContentLoaded', () => {
  loadTemplates();

  const editorPanel = document.getElementById('editorPanel');

  // Delegated change: toggle active
  editorPanel.addEventListener('change', (e) => {
    const el = e.target.closest('[data-toggle-key]');
    if (el) toggleActive(el.dataset.toggleKey, el.checked);
  });

  // Delegated click: tab buttons, variable chips, cancel, save
  editorPanel.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { switchTab(tabBtn.dataset.tab, tabBtn); return; }

    const chip = e.target.closest('[data-insert-var]');
    if (chip) { insertVar(chip.dataset.insertVar); return; }

    if (e.target.closest('[data-action="cancel-edit"]')) { cancelEdit(); return; }

    const saveBtn = e.target.closest('[data-save-key]');
    if (saveBtn) { saveTemplate(saveBtn.dataset.saveKey); return; }
  });
});
