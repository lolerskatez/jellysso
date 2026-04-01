let allItems = [];
let startIndex = 0;
let hasMore = true;

function getLimit() { return parseInt(document.getElementById('perPage').value) || 50; }

async function loadActivity(reset) {
  if (reset) { startIndex = 0; allItems = []; hasMore = true; }
  if (!hasMore) return;

  document.getElementById('spinner').style.display = '';
  try {
    const limit = getLimit();
    const r = await fetch(`/api/activity?startIndex=${startIndex}&limit=${limit}`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Failed to load activity');

    const items = d.items || d.data || [];
    allItems = allItems.concat(items);
    hasMore = items.length >= limit;
    renderRows();
    updatePagination();
  } catch (e) {
    document.getElementById('activityTbody').innerHTML =
      `<tr><td colspan="6" style="color:#dc3545;text-align:center;padding:20px">${escH(e.message)}</td></tr>`;
  } finally {
    document.getElementById('spinner').style.display = 'none';
  }
}

function renderRows() {
  const search = document.getElementById('filterSearch').value.toLowerCase();
  let rows = allItems;
  if (search) {
    rows = rows.filter(r =>
      (r.Name || '').toLowerCase().includes(search) ||
      (r.Type || '').toLowerCase().includes(search) ||
      (r.UserName || '').toLowerCase().includes(search) ||
      (r.Client || '').toLowerCase().includes(search)
    );
  }

  const tbody = document.getElementById('activityTbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><i class="fas fa-list-alt"></i><br>No activity found</div></td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const sev = r.Severity || '';
    const sevColor = sev === 'Error' ? '#dc3545' : sev === 'Warning' ? '#ffc107' : 'var(--text-muted)';
    return `
      <tr>
        <td style="white-space:nowrap;font-size:.82rem">${formatDate(r.Date || r.ActivityDate)}</td>
        <td><span class="type-badge">${escH(r.Type || r.Name || '—')}</span></td>
        <td>${escH(r.UserName || r.UserId || '—')}</td>
        <td>${escH(r.Client || '—')}</td>
        <td>${escH(r.DeviceName || '—')}</td>
        <td class="severity-col" style="color:${sevColor}">${escH(sev || 'Info')}</td>
      </tr>`;
  }).join('');
}

function filterRows() { renderRows(); }

function onPerPageChange() { loadActivity(true); }

function updatePagination() {
  document.getElementById('prevBtn').disabled = startIndex === 0;
  document.getElementById('nextBtn').disabled = !hasMore;
  document.getElementById('pageInfo').textContent = `Loaded ${allItems.length} entries`;
}

async function nextPage() {
  startIndex += getLimit();
  await loadActivity(false);
}

function prevPage() {
  startIndex = Math.max(0, startIndex - getLimit());
  renderRows();
  updatePagination();
}

function formatDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

function escH(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

loadActivity(true);
