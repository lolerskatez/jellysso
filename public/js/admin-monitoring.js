let refreshTimer = null;

async function loadMetrics() {
  const hours = document.getElementById('hoursSelect').value;
  try {
    const [mRes, hRes, cRes] = await Promise.all([
      fetch(`/api/monitoring/metrics?hours=${hours}`),
      fetch('/api/monitoring/health'),
      fetch('/api/monitoring/cache')
    ]);
    const [mData, hData, cData] = await Promise.all([mRes.json(), hRes.json(), cRes.json()]);

    if (mData.success) renderMetrics(mData.metrics, mData.historical);
    if (hData.success) renderHealth(hData);
    if (cData.success) renderCache(cData.cache);

    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString();
    document.getElementById('liveDot').style.color = '#28a745';
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { document.getElementById('liveDot').style.color = '#dc3545'; }, 5000);
  } catch (e) {
    console.error('Failed to load metrics', e);
  }
}

function renderMetrics(m, historical) {
  document.getElementById('mUptime').textContent = m.uptime || '—';
  document.getElementById('mReqPerHr').textContent = fmt(m.requestsPerHour);
  document.getElementById('mAvgResp').textContent = m.avgResponseTime != null ? m.avgResponseTime.toFixed(1) : '—';
  document.getElementById('mErrorRate').textContent = m.errorRate != null ? m.errorRate.toFixed(2) : '—';
  document.getElementById('mTotalReq').textContent = fmt(m.totalRequests);
  document.getElementById('mDbSize').textContent = fmtBytes(m.dbSize);

  // Response time distribution
  const dist = m.responseTimeDistribution || {};
  const total = (dist.fast || 0) + (dist.medium || 0) + (dist.slow || 0) || 1;
  const fp = ((dist.fast || 0) / total * 100).toFixed(1);
  const mp = ((dist.medium || 0) / total * 100).toFixed(1);
  const sp = ((dist.slow || 0) / total * 100).toFixed(1);
  document.getElementById('rtFast').style.width = fp + '%';
  document.getElementById('rtMed').style.width = mp + '%';
  document.getElementById('rtSlow').style.width = sp + '%';
  document.getElementById('rtFast').textContent = fp > 5 ? `${fp}%` : '';
  document.getElementById('rtMed').textContent = mp > 5 ? `${mp}%` : '';
  document.getElementById('rtSlow').textContent = sp > 5 ? `${sp}%` : '';
  document.getElementById('rtFastPct').textContent = fp;
  document.getElementById('rtMedPct').textContent = mp;
  document.getElementById('rtSlowPct').textContent = sp;

  // Memory
  const mem = m.memory || {};
  const used = mem.heapUsed || 0;
  const tot = mem.heapTotal || 1;
  const ext = mem.external || 0;
  const pct = Math.min(100, (used / tot * 100)).toFixed(1);
  const memColor = pct > 85 ? '#dc3545' : pct > 65 ? '#ffc107' : '#28a745';
  document.getElementById('memDetails').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px">
        <span>Heap Used</span><span>${fmtBytes(used)} / ${fmtBytes(tot)} (${pct}%)</span>
      </div>
      <div class="mem-bar-wrap"><div class="mem-bar" style="width:${pct}%;background:${memColor}"></div></div>
    </div>
    <div style="font-size:.83rem;color:var(--text-muted)">External: ${fmtBytes(ext)} &nbsp;|&nbsp; CPU: ${m.cpuUsage != null ? m.cpuUsage.toFixed(1) + '%' : '—'}</div>
  `;

  // Top errors
  const errs = m.topErrors || [];
  if (errs.length === 0) {
    document.getElementById('topErrors').innerHTML = '<p style="color:var(--text-muted)">No errors recorded.</p>';
  } else {
    document.getElementById('topErrors').innerHTML = errs.map(e =>
      `<div class="error-item"><span class="error-path">${escH(e.path || e.error || String(e))}</span><span class="error-count">${e.count || ''}</span></div>`
    ).join('');
  }

  // Historical bar chart
  if (historical && historical.length > 0) {
    const maxVal = Math.max(...historical.map(h => h.count || 0), 1);
    document.getElementById('barChart').innerHTML = historical.map(h => {
      const pct = ((h.count || 0) / maxVal * 100).toFixed(1);
      return `<div class="col" style="height:${pct}%" title="${escH(h.hour || h.bucket || '')}: ${h.count || 0} req"></div>`;
    }).join('');
  } else {
    document.getElementById('barChart').innerHTML = '<p style="color:var(--text-muted)">No historical data available.</p>';
  }
}

function renderHealth(h) {
  const comps = h.components || {};
  const statusDot = status => `<span class="health-dot ${status === true || status === 'healthy' ? 'healthy' : 'degraded'}"></span>`;
  document.getElementById('healthStatus').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:.9rem">
      <div>${statusDot(h.status === 'healthy')} Overall: <strong>${h.status || '—'}</strong></div>
      ${Object.entries(comps).map(([name, c]) => `
        <div>${statusDot(c.healthy)} ${escH(name)}: <strong>${c.healthy ? 'Healthy' : 'Degraded'}</strong>
          ${c.status ? `<span style="color:var(--text-muted);font-size:.8rem;margin-left:6px">${escH(JSON.stringify(c.status))}</span>` : ''}
        </div>
      `).join('')}
    </div>`;
}

function renderCache(cache) {
  document.getElementById('cacheStats').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;font-size:.88rem">
      <div><div style="font-weight:700;font-size:1.4rem">${fmt(cache.size || 0)}</div><div style="color:var(--text-muted)">Entries</div></div>
      <div><div style="font-weight:700;font-size:1.4rem">${fmt(cache.hits || 0)}</div><div style="color:var(--text-muted)">Cache Hits</div></div>
      <div><div style="font-weight:700;font-size:1.4rem">${fmt(cache.misses || 0)}</div><div style="color:var(--text-muted)">Cache Misses</div></div>
      <div><div style="font-weight:700;font-size:1.4rem">${cache.hitRate != null ? Number(cache.hitRate).toFixed(1) : '—'}%</div><div style="color:var(--text-muted)">Hit Rate</div></div>
      <div><div style="font-weight:700;font-size:1.4rem">${fmt(cache.maxSize || 0)}</div><div style="color:var(--text-muted)">Max Size</div></div>
    </div>`;
}

function fmt(n) { if (n == null) return '—'; return Number(n).toLocaleString(); }

function fmtBytes(b) {
  if (b == null || b === 0) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return b.toFixed(1) + ' ' + units[i];
}

function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

loadMetrics();
// Auto-refresh every 30 seconds
setInterval(loadMetrics, 30000);
