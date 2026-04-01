async function loadAnnouncements() {
  document.getElementById('loading').style.display = '';
  try {
    const r = await fetch('/api/announcements');
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Failed to load');
    renderAnnouncements(d.announcements || []);
  } catch (e) {
    document.getElementById('annList').innerHTML =
      `<div style="color:#dc3545;text-align:center;padding:20px">${escH(e.message)}</div>`;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function renderAnnouncements(items) {
  const el = document.getElementById('annList');
  if (items.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-check-circle"></i>
        <p>No announcements right now. Check back later.</p>
      </div>`;
    return;
  }

  // Sort: higher displayPriority first, then newest first
  items.sort((a, b) => (b.displayPriority || 0) - (a.displayPriority || 0) || new Date(b.createdAt) - new Date(a.createdAt));

  el.innerHTML = items.map(ann => {
    const prio = priorityLabel(ann.displayPriority);
    const cardCls = prio === 'Urgent' ? 'priority-urgent' : prio === 'High' ? 'priority-high' : prio === 'Low' ? 'priority-low' : '';
    return `
      <div class="ann-card ${cardCls}">
        <div class="ann-header">
          <h2 class="ann-title">${escH(ann.title || 'Announcement')}</h2>
          <span class="priority-badge ${prio.toLowerCase()}">${prio}</span>
        </div>
        <div class="ann-meta">
          <i class="fas fa-clock"></i> ${formatDate(ann.createdAt)}
          ${ann.expiresAt ? ` &nbsp;·&nbsp; <i class="fas fa-hourglass-end"></i> Expires ${formatDate(ann.expiresAt)}` : ''}
        </div>
        <div class="ann-body">${escH(ann.message || '')}</div>
      </div>`;
  }).join('');
}

function priorityLabel(p) {
  if (p >= 10) return 'Urgent';
  if (p >= 5)  return 'High';
  if (p <= -1) return 'Low';
  return 'Normal';
}

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

loadAnnouncements();
