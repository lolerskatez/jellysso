/**
 * Admin Dashboard Page JavaScript
 * Loads and displays summary widgets from various admin sections
 */

document.addEventListener('DOMContentLoaded', function() {
  // Load all dashboard data
  loadDashboardData();

  // Refresh button
  const refreshBtn = document.getElementById('refreshDashboard');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadDashboardData);
  }

  // Cleanup logs button
  const cleanupBtn = document.getElementById('cleanupLogsBtn');
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', cleanupLogs);
  }

  // Create backup button
  const createBackupBtn = document.getElementById('createBackupBtn');
  if (createBackupBtn) {
    createBackupBtn.addEventListener('click', createBackup);
  }
});

// Load all dashboard data
async function loadDashboardData() {
  const refreshBtn = document.getElementById('refreshDashboard');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }

  try {
    await Promise.all([
      loadStatistics(),
      loadAnalytics(),
      loadBackupStatus(),
      loadRecentActivity()
    ]);
  } catch (error) {
    console.error('Dashboard load error:', error);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }
    // Update last refresh time
    const lastUpdate = document.getElementById('lastUpdate');
    if (lastUpdate) {
      lastUpdate.textContent = new Date().toLocaleTimeString();
    }
  }
}

// Load statistics summary
async function loadStatistics() {
  try {
    const response = await fetch('/admin/api/statistics?range=7d');
    const data = await response.json();
    
    if (data.success && data.stats) {
      const stats = data.stats;
      updateElement('statTotalRequests', stats.totalRequests?.toLocaleString() || '0');
      updateElement('statSuccessRate', (stats.successRate || 0) + '%');
      updateElement('statFailedRequests', stats.failedRequests?.toLocaleString() || '0');
      updateElement('statTotalUsers', stats.totalUsers?.toLocaleString() || '0');
      updateElement('statUserLogins', stats.userLogins?.toLocaleString() || '0');
      updateElement('statDbSize', stats.dbSize || '0 MB');
    }
  } catch (error) {
    console.error('Statistics load error:', error);
  }
}

// Load analytics summary
async function loadAnalytics() {
  try {
    const response = await fetch('/admin/api/analytics?period=7');
    const data = await response.json();
    
    if (data.success && data.report) {
      const report = data.report;
      
      // Update analytics stats
      updateElement('analyticsActivities', report.actionFrequency?.total?.toLocaleString() || '0');
      updateElement('analyticsFailedLogins', report.securityEvents?.failedLogins?.toLocaleString() || '0');
      updateElement('analyticsNewUsers', report.userCreationTrends?.total?.toLocaleString() || '0');
      
      // Update mini activity chart if exists
      updateMiniChart(report);
    }
  } catch (error) {
    console.error('Analytics load error:', error);
  }
}

// Load backup status
async function loadBackupStatus() {
  try {
    const response = await fetch('/admin/api/backups');
    const data = await response.json();
    
    if (data.success) {
      const backups = data.backups || [];
      updateElement('backupCount', backups.length.toString());
      
      if (backups.length > 0) {
        const latest = backups[0];
        updateElement('lastBackupDate', new Date(latest.date).toLocaleDateString());
        updateElement('lastBackupSize', latest.size || 'Unknown');
      } else {
        updateElement('lastBackupDate', 'Never');
        updateElement('lastBackupSize', '-');
      }
    }
  } catch (error) {
    console.error('Backup status load error:', error);
  }
}

// Load recent activity
async function loadRecentActivity() {
  try {
    const response = await fetch('/admin/api/audit-logs?limit=5');
    const data = await response.json();
    
    if (data.success && data.logs) {
      const tbody = document.getElementById('recentActivityTable');
      if (!tbody) return;

      if (data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="no-data">No recent activity</td></tr>';
        return;
      }

      tbody.innerHTML = data.logs.map(log => `
        <tr>
          <td>
            <span class="action-badge">${log.action}</span>
          </td>
          <td><strong>${log.username || log.userId || 'System'}</strong></td>
          <td>
            <span class="status-badge status-${log.status}">
              <i class="fas fa-${log.status === 'success' ? 'check' : 'times'}"></i>
            </span>
          </td>
          <td class="time-ago">${formatTimeAgo(log.timestamp)}</td>
        </tr>
      `).join('');
    }
  } catch (error) {
    console.error('Recent activity load error:', error);
  }
}

// Update mini chart
function updateMiniChart(report) {
  const canvas = document.getElementById('miniActivityChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const ctx = canvas.getContext('2d');
  
  // Destroy existing chart if any
  if (window.miniChart) {
    window.miniChart.destroy();
  }

  const timeline = report.activityHeatmap?.data || {};
  const labels = Object.keys(timeline).slice(-7);
  const values = labels.map(d => {
    const dayData = timeline[d] || [];
    return Array.isArray(dayData) ? dayData.reduce((a, b) => a + b, 0) : 0;
  });

  window.miniChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map(d => new Date(d).toLocaleDateString([], { weekday: 'short' })),
      datasets: [{
        data: values,
        borderColor: '#0066cc',
        backgroundColor: 'rgba(0, 102, 204, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true }
      }
    }
  });
}

// Helper: Update element text
function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// Helper: Format time ago
function formatTimeAgo(timestamp) {
  const now = new Date();
  const time = new Date(timestamp);
  const diff = Math.floor((now - time) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

// Cleanup old logs
async function cleanupLogs() {
  if (!confirm('Delete audit logs older than 90 days?')) return;

  try {
    const response = await fetch('/admin/api/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daysToKeep: 90 })
    });
    const data = await response.json();

    if (data.success) {
      showNotification(data.message, 'success');
      loadDashboardData();
    } else {
      showNotification(data.message || 'Cleanup failed', 'error');
    }
  } catch (error) {
    showNotification('Error: ' + error.message, 'error');
  }
}

// Create backup
async function createBackup() {
  const btn = document.getElementById('createBackupBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }

  try {
    const response = await fetch('/admin/api/backups/create', { method: 'POST' });
    const data = await response.json();

    if (data.success) {
      showNotification('Backup created successfully!', 'success');
      loadBackupStatus();
    } else {
      showNotification(data.message || 'Backup failed', 'error');
    }
  } catch (error) {
    showNotification('Error: ' + error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-plus"></i>';
    }
  }
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = document.getElementById('notification');
  if (notification) {
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    setTimeout(() => notification.classList.remove('show'), 4000);
  }
}
