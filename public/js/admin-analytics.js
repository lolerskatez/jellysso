// Admin Analytics JavaScript

document.addEventListener('DOMContentLoaded', function() {
  let currentPeriod = 7;
  let charts = {};

  // Period selector buttons
  const periodButtons = document.querySelectorAll('.period-btn');
  const periodDaysSpan = document.getElementById('periodDays');
  const exportBtn = document.getElementById('exportReportBtn');

  // Set analysis period
  function setPeriod(days) {
    currentPeriod = days;
    periodButtons.forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-period="${days}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    if (periodDaysSpan) periodDaysSpan.textContent = days;
    loadAnalytics();
  }

  // Load all analytics data
  async function loadAnalytics() {
    try {
      const response = await fetch(`/admin/api/analytics?period=${currentPeriod}`);
      const data = await response.json();

      if (!data.success) throw new Error(data.message);

      updateStatistics(data);
      updateCharts(data);
      updateTables(data);
    } catch (error) {
      console.error('Analytics load error:', error);
    }
  }

  // Update stat cards
  function updateStatistics(data) {
    const report = data.report || {};
    
    const totalActivities = document.getElementById('totalActivities');
    const failedLogins = document.getElementById('failedLogins');
    const newUsers = document.getElementById('newUsers');
    const apiCalls = document.getElementById('apiCalls');
    const activeSessions = document.getElementById('activeSessions');
    const quickConnects = document.getElementById('quickConnects');

    if (totalActivities) {
      totalActivities.textContent = report.actionFrequency?.total?.toLocaleString() || '0';
    }
    if (failedLogins) {
      failedLogins.textContent = report.securityEvents?.failedLogins?.toLocaleString() || '0';
    }
    if (newUsers) {
      newUsers.textContent = report.userCreationTrends?.total?.toLocaleString() || '0';
    }
    if (apiCalls) {
      apiCalls.textContent = report.apiEndpointUsage?.total?.toLocaleString() || '0';
    }
    if (activeSessions) {
      activeSessions.textContent = report.activeSessions?.toLocaleString() || '0';
    }
    if (quickConnects) {
      quickConnects.textContent = report.quickConnectUsage?.total?.toLocaleString() || '0';
    }
  }

  // Update all charts
  function updateCharts(data) {
    const report = data.report || {};

    // Authentication methods pie chart
    updateAuthMethodsChart(report.authenticationMethods || {});
    
    // Action frequency chart
    updateActionFrequencyChart(report.actionFrequency || {});
    
    // Failed logins trend
    updateFailedLoginsChart(report.failedLoginTrends || {});
    
    // User creation trend
    updateUserCreationChart(report.userCreationTrends || {});

    // Activity timeline
    updateActivityTimelineChart(report.activityTimeline || {});
  }

  // Update authentication methods chart
  function updateAuthMethodsChart(data) {
    const canvas = document.getElementById('authMethodsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (charts.authMethods) charts.authMethods.destroy();
    
    const chartData = data.data || {};
    const labels = Object.keys(chartData);
    const values = Object.values(chartData);

    if (labels.length === 0) {
      labels.push('No Data');
      values.push(1);
    }
    
    charts.authMethods = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: ['#0066cc', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
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

  // Update action frequency chart
  function updateActionFrequencyChart(data) {
    const canvas = document.getElementById('actionsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.actions) charts.actions.destroy();
    
    const actions = (data.data || []).slice(0, 10);
    
    charts.actions = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: actions.map(a => a.action || 'Unknown'),
        datasets: [{
          label: 'Count',
          data: actions.map(a => a.count || 0),
          backgroundColor: '#0066cc'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } }
      }
    });
  }

  // Update failed logins trend chart
  function updateFailedLoginsChart(data) {
    const canvas = document.getElementById('failedLoginsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.failedLogins) charts.failedLogins.destroy();
    
    const trendData = data.data || {};
    
    charts.failedLogins = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Object.keys(trendData),
        datasets: [{
          label: 'Failed Logins',
          data: Object.values(trendData),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // Update user creation trend chart
  function updateUserCreationChart(data) {
    const canvas = document.getElementById('userCreationChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.userCreation) charts.userCreation.destroy();
    
    const trendData = data.data || {};
    
    charts.userCreation = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Object.keys(trendData),
        datasets: [{
          label: 'New Users',
          data: Object.values(trendData),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // Update activity timeline chart
  function updateActivityTimelineChart(data) {
    const canvas = document.getElementById('activityTimelineChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (charts.activityTimeline) charts.activityTimeline.destroy();
    
    const trendData = data.data || {};
    
    charts.activityTimeline = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Object.keys(trendData),
        datasets: [{
          label: 'Activities',
          data: Object.values(trendData),
          borderColor: '#0066cc',
          backgroundColor: 'rgba(0, 102, 204, 0.1)',
          tension: 0.3,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // Update tables
  function updateTables(data) {
    const report = data.report || {};
    
    // Top users
    const topUsersTable = document.getElementById('topUsersTable');
    if (topUsersTable) {
      const topUsers = report.topUsers?.data || [];
      let topUsersHtml = '';
      if (topUsers.length > 0) {
        const maxCount = Math.max(...topUsers.map(u => u.count));
        topUsersHtml = topUsers.map(u => `
          <tr>
            <td><strong>${u.username || u.userId || 'Unknown'}</strong></td>
            <td>${u.count}</td>
            <td>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${((u.count / maxCount) * 100).toFixed(1)}%"></div>
              </div>
            </td>
          </tr>
        `).join('');
      } else {
        topUsersHtml = '<tr><td colspan="3" class="no-data">No data available</td></tr>';
      }
      topUsersTable.innerHTML = topUsersHtml;
    }
    
    // Top endpoints
    const topEndpointsTable = document.getElementById('topEndpointsTable');
    if (topEndpointsTable) {
      const topEndpoints = report.apiEndpointUsage?.data || [];
      let topEndpointsHtml = '';
      if (topEndpoints.length > 0) {
        const maxCount = Math.max(...topEndpoints.map(e => e.count));
        topEndpointsHtml = topEndpoints.map(e => `
          <tr>
            <td><code>${e.resource}</code></td>
            <td>${e.count}</td>
            <td>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${((e.count / maxCount) * 100).toFixed(1)}%"></div>
              </div>
            </td>
          </tr>
        `).join('');
      } else {
        topEndpointsHtml = '<tr><td colspan="3" class="no-data">No data available</td></tr>';
      }
      topEndpointsTable.innerHTML = topEndpointsHtml;
    }
  }

  // Export report as JSON
  function exportReport() {
    fetch(`/admin/api/analytics?period=${currentPeriod}`)
      .then(r => r.json())
      .then(data => {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(error => {
        console.error('Export error:', error);
        alert('Failed to export report');
      });
  }

  // Event listeners for period buttons
  periodButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      const period = parseInt(this.dataset.period);
      if (period) setPeriod(period);
    });
  });

  // Event listener for export button
  if (exportBtn) {
    exportBtn.addEventListener('click', exportReport);
  }

  // Initial load
  loadAnalytics();
});
