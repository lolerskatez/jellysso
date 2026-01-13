// Admin Statistics JavaScript

document.addEventListener('DOMContentLoaded', function() {
  let currentTimeRange = '7d';
  let charts = {};

  // Time range buttons
  const timeRangeButtons = document.querySelectorAll('.time-range-btn');

  // Update time range
  function updateTimeRange(range) {
    currentTimeRange = range;
    timeRangeButtons.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-range="${range}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    loadStatistics();
  }

  // Load statistics data
  async function loadStatistics() {
    try {
      const response = await fetch(`/admin/api/statistics?range=${currentTimeRange}`);
      const data = await response.json();

      if (data.success) {
        updateStatCards(data.stats);
        updateCharts(data.stats);
        updateMetricsTable(data.stats);
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  }

  // Update stat cards
  function updateStatCards(stats) {
    const totalRequests = document.getElementById('totalRequests');
    const successRate = document.getElementById('successRate');
    const failedRequests = document.getElementById('failedRequests');
    const activeUsers = document.getElementById('activeUsers');
    const totalUsers = document.getElementById('totalUsers');
    const dbSize = document.getElementById('dbSize');

    if (totalRequests) totalRequests.textContent = (stats.totalRequests || 0).toLocaleString();
    if (successRate) successRate.textContent = (stats.successRate || 0) + '%';
    if (failedRequests) failedRequests.textContent = (stats.failedRequests || 0).toLocaleString();
    if (activeUsers) activeUsers.textContent = (stats.activeUsers || 0).toLocaleString();
    if (totalUsers) totalUsers.textContent = (stats.totalUsers || 0).toLocaleString();
    if (dbSize) dbSize.textContent = stats.dbSize || '0 MB';
  }

  // Update charts
  function updateCharts(stats) {
    updateActionChart(stats);
    updateStatusChart(stats);
    updateTimelineChart(stats);
  }

  // Action distribution chart
  function updateActionChart(stats) {
    const canvas = document.getElementById('actionChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.action) charts.action.destroy();

    const actionData = stats.actionBreakdown || {};
    const labels = Object.keys(actionData);
    const values = Object.values(actionData);

    charts.action = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels.length > 0 ? labels : ['No Data'],
        datasets: [{
          data: values.length > 0 ? values : [1],
          backgroundColor: ['#0066cc', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }

  // Status distribution chart
  function updateStatusChart(stats) {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.status) charts.status.destroy();

    const successRate = stats.successRate || 0;

    charts.status = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Success', 'Failure'],
        datasets: [{
          data: [successRate, 100 - successRate],
          backgroundColor: ['#10b981', '#ef4444']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }

  // Timeline chart
  function updateTimelineChart(stats) {
    const canvas = document.getElementById('timelineChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.timeline) charts.timeline.destroy();

    const timelineData = stats.timeline || {};
    const labels = Object.keys(timelineData);
    const requests = labels.map(l => timelineData[l]?.requests || 0);
    const errors = labels.map(l => timelineData[l]?.errors || 0);

    charts.timeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['No Data'],
        datasets: [{
          label: 'Requests',
          data: requests,
          borderColor: '#0066cc',
          backgroundColor: 'rgba(0, 102, 204, 0.1)',
          tension: 0.3,
          fill: true
        }, {
          label: 'Errors',
          data: errors,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // Update metrics table
  function updateMetricsTable(stats) {
    const tbody = document.getElementById('metricsTableBody');
    if (!tbody) return;

    const metrics = [
      { name: 'User Logins', value: stats.userLogins || 0, icon: 'sign-in-alt', color: 'primary' },
      { name: 'Failed Logins', value: stats.failedLogins || 0, icon: 'exclamation-triangle', color: 'danger' },
      { name: 'Users Created', value: stats.usersCreated || 0, icon: 'user-plus', color: 'success' },
      { name: 'Settings Changes', value: stats.settingsChanges || 0, icon: 'cog', color: 'warning' },
      { name: 'API Calls', value: stats.apiCalls || 0, icon: 'plug', color: 'purple' },
      { name: 'QuickConnect Uses', value: stats.quickConnects || 0, icon: 'qrcode', color: 'cyan' }
    ];

    tbody.innerHTML = metrics.map(m => `
      <tr>
        <td>
          <i class="fas fa-${m.icon}" style="color: var(--${m.color}); margin-right: var(--spacing-sm);"></i>
          ${m.name}
        </td>
        <td><strong>${m.value.toLocaleString()}</strong></td>
      </tr>
    `).join('');
  }

  // Event listeners for time range buttons
  timeRangeButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const range = this.dataset.range;
      if (range) updateTimeRange(range);
    });
  });

  // Initial load
  loadStatistics();
});
