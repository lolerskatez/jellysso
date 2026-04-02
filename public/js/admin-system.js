function switchTab(tab, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tabs button').forEach(el => el.classList.remove('active'));
  document.getElementById(tab).classList.add('active');
  btn.classList.add('active');

  if (tab === 'sessions') refreshSessionStats();
  else if (tab === 'cache') refreshCacheStats();
  else if (tab === 'plugins') refreshPluginStats();
}

function showAlert(type, message) {
  const alert = document.getElementById(type + 'Alert');
  alert.textContent = message;
  alert.classList.add('show');
  setTimeout(() => alert.classList.remove('show'), 5000);
}

async function refreshSessionStats() {
  try {
    const res = await fetch('/admin/api/sessions/stats');
    const data = await res.json();
    if (data.success) {
      const s = data.sessions || {};
      document.getElementById('totalSessions').textContent = s.total || 0;
      document.getElementById('activeSessions').textContent = s.active || 0;
      document.getElementById('expiredSessions').textContent = s.expired || 0;
    }
  } catch (error) {
    showAlert('error', 'Failed to load session stats: ' + error.message);
  }
}

async function cleanupSessions() {
  if (!confirm('Clean up all expired sessions?')) return;
  try {
    const res = await fetch('/admin/api/sessions/cleanup', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAlert('success', data.message);
      refreshSessionStats();
    } else {
      showAlert('error', data.message);
    }
  } catch (error) {
    showAlert('error', 'Cleanup failed: ' + error.message);
  }
}

async function refreshCacheStats() {
  try {
    const res = await fetch('/admin/api/cache/stats');
    const data = await res.json();
    if (data.success) {
      const cache = data.cache;
      document.getElementById('cacheSize').textContent = cache.size;
      document.getElementById('hitRate').textContent = cache.hitRate;
      document.getElementById('hits').textContent = cache.hits;
      document.getElementById('misses').textContent = cache.misses;
    }
  } catch (error) {
    showAlert('error', 'Failed to load cache stats: ' + error.message);
  }
}

async function clearCache() {
  if (!confirm('Clear all cache entries?')) return;
  try {
    const res = await fetch('/admin/api/cache/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      showAlert('success', data.message);
      refreshCacheStats();
    } else {
      showAlert('error', data.message);
    }
  } catch (error) {
    showAlert('error', 'Clear failed: ' + error.message);
  }
}

async function resetCacheStats() {
  try {
    const res = await fetch('/admin/api/cache/reset-stats', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAlert('success', data.message);
      refreshCacheStats();
    } else {
      showAlert('error', data.message);
    }
  } catch (error) {
    showAlert('error', 'Reset failed: ' + error.message);
  }
}

async function refreshPluginStats() {
  try {
    const res = await fetch('/admin/api/plugins');
    const data = await res.json();
    if (data.success) {
      document.getElementById('pluginsCount').textContent = data.summary.total;
      document.getElementById('hooksCount').textContent = data.summary.hooks;
      document.getElementById('middlewareCount').textContent = data.summary.middleware;

      const tbody = document.querySelector('#pluginsList tbody');
      if (data.plugins.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">No plugins loaded</td></tr>';
      } else {
        tbody.innerHTML = data.plugins.map(p => `
          <tr>
            <td>${p.name}</td>
            <td>${p.version}</td>
            <td><span style="background: #d4edda; color: #155724; padding: 2px 8px; border-radius: 3px;">${p.status}</span></td>
            <td>${new Date(p.loadedAt).toLocaleString()}</td>
            <td><button class="btn" style="padding: 5px 10px; font-size: 12px;" data-unload-plugin="${p.name}">Unload</button></td>
          </tr>
        `).join('');
      }
    }
  } catch (error) {
    showAlert('error', 'Failed to load plugin stats: ' + error.message);
  }
}

async function reloadPlugins() {
  if (!confirm('Reload all plugins?')) return;
  try {
    const res = await fetch('/admin/api/plugins/reload', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAlert('success', data.message);
      refreshPluginStats();
    } else {
      showAlert('error', data.message);
    }
  } catch (error) {
    showAlert('error', 'Reload failed: ' + error.message);
  }
}

async function unloadPlugin(name) {
  if (!confirm(`Unload plugin ${name}?`)) return;
  try {
    const res = await fetch(`/admin/api/plugins/${name}/unload`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAlert('success', data.message);
      refreshPluginStats();
    } else {
      showAlert('error', data.message);
    }
  } catch (error) {
    showAlert('error', 'Unload failed: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshSessionStats();

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) switchTab(btn.dataset.tab, btn);
  });

  document.getElementById('btnRefreshSessions').addEventListener('click', refreshSessionStats);
  document.getElementById('btnCleanupSessions').addEventListener('click', cleanupSessions);
  document.getElementById('btnRefreshCache').addEventListener('click', refreshCacheStats);
  document.getElementById('btnClearCache').addEventListener('click', clearCache);
  document.getElementById('btnResetCacheStats').addEventListener('click', resetCacheStats);
  document.getElementById('btnRefreshPlugins').addEventListener('click', refreshPluginStats);
  document.getElementById('btnReloadPlugins').addEventListener('click', reloadPlugins);

  document.querySelector('#pluginsList tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unload-plugin]');
    if (btn) unloadPlugin(btn.dataset.unloadPlugin);
  });
});
