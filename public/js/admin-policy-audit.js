let offset = 0;
let hasMore = false;
let debTimer = null;

function getLimit() { return parseInt(document.getElementById('perPage').value) || 100; }

async function loadLogs(reset) {
  if (reset) offset = 0;
  const userId = document.getElementById('filterUserId').value.trim();
  const action = document.getElementById('filterAction').value;
  const limit = getLimit();

  const params = new URLSearchParams({ limit, offset });
  if (userId) params.set('userId', userId);
  if (action) params.set('action', action);

  try {
    const r = await fetch(`/api/policy/admin/audit-log?${params}`);
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Failed to load logs');

    hasMore = d.logs.length >= limit;
    renderRows(d.logs);
    document.getElementById('pageInfo').textContent =
      `Showing ${offset + 1}–${offset + d.logs.length}${hasMore ? '+' : ''}`;
    document.getElementById('prevBtn').disabled = offset === 0;
    document.getElementById('nextBtn').disabled = !hasMore;
  } catch (e) {
    document.getElementById('logsTbody').innerHTML =
      `<tr><td colspan="7" style="color:#dc3545;text-align:center;padding:20px">${escH(e.message)}</td></tr>`;
  }
}

function renderRows(logs) {
  const tbody = document.getElementById('logsTbody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fas fa-clipboard-list"></i><br>No audit entries found</div></td></tr>';
    return;
  }
  tbody.innerHTML = logs.map(l => {
    const act = (l.action || '').toLowerCase();
    const cls = act === 'allow' ? 'action-allow' : act === 'deny' ? 'action-deny' : act === 'warn' ? 'action-warn' : 'action-other';
    return `
      <tr>
        <td style="white-space:nowrap;font-size:.8rem">${formatDate(l.timestamp)}</td>
        <td class="uid-cell" title="${escH(l.userId || '')}">${escH(l.userId || '—')}</td>
        <td>${escH(l.type || '—')}</td>
        <td><span class="action-badge ${cls}">${escH(l.action || '—')}</span></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escH(l.reason || '—')}</td>
        <td class="mono">${escH(l.device || '—')}</td>
        <td class="mono">${escH(l.ipAddress || '—')}</td>
      </tr>`;
  }).join('');
}

function debounceLoad() {
  clearTimeout(debTimer);
  debTimer = setTimeout(() => loadLogs(true), 350);
}

function prevPage() { offset = Math.max(0, offset - getLimit()); loadLogs(false); }
function nextPage() { offset += getLimit(); loadLogs(false); }

function formatDate(s) { if (!s) return '—'; return new Date(s).toLocaleString(); }
function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

loadLogs(true);
