/**
 * Admin Provisioning JavaScript
 * Handles bulk user import functionality
 */

document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const csvFileInput = document.getElementById('csvFile');
  const uploadArea = document.getElementById('uploadArea');
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const csvPreview = document.getElementById('csvPreview');
  const previewTable = document.getElementById('previewTable');
  const importBtn = document.getElementById('importBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const results = document.getElementById('results');
  const resultsList = document.getElementById('resultsList');
  const notification = document.getElementById('notification');

  let selectedFile = null;
  let csvData = [];

  // Show notification
  function showNotification(message, type = 'success') {
    if (notification) {
      notification.textContent = message;
      notification.className = `notification ${type}`;
      notification.classList.add('show');
      setTimeout(() => notification.classList.remove('show'), 5000);
    }
  }

  // Tab switching
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', function() {
      const tabId = this.dataset.tab;
      
      // Update buttons
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      // Update content
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tabContent = document.getElementById(tabId);
      if (tabContent) tabContent.classList.add('active');
    });
  });

  // Upload area click
  if (uploadArea) {
    uploadArea.addEventListener('click', () => csvFileInput?.click());
    
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  // File input change
  if (csvFileInput) {
    csvFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });
  }

  // Handle file selection
  function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
      showNotification('Please select a CSV file', 'error');
      return;
    }

    selectedFile = file;
    if (fileName) fileName.textContent = file.name;
    if (fileInfo) fileInfo.style.display = 'flex';
    if (importBtn) importBtn.style.display = 'inline-flex';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

    // Parse CSV
    const reader = new FileReader();
    reader.onload = (e) => {
      const csv = e.target.result;
      csvData = parseCSV(csv);
      previewCSV();
    };
    reader.readAsText(file);
  }

  // Parse CSV
  function parseCSV(csv) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const data = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((h, i) => row[h] = values[i] || '');
      return row;
    }).filter(row => Object.values(row).some(v => v)); // Filter empty rows
    
    return data;
  }

  // Preview CSV
  function previewCSV() {
    if (!csvData.length || !previewTable) return;

    const headers = Object.keys(csvData[0]);
    
    // Header row
    let headerHtml = '<tr>';
    headers.forEach(h => headerHtml += `<th>${escapeHtml(h)}</th>`);
    headerHtml += '</tr>';

    // Body rows (max 10)
    let bodyHtml = '';
    csvData.slice(0, 10).forEach(row => {
      bodyHtml += '<tr>';
      headers.forEach(h => {
        const value = h.toLowerCase() === 'password' ? '••••••••' : escapeHtml(row[h]);
        bodyHtml += `<td>${value}</td>`;
      });
      bodyHtml += '</tr>';
    });

    if (csvData.length > 10) {
      bodyHtml += `<tr><td colspan="${headers.length}" style="text-align: center; color: var(--text-secondary);">... and ${csvData.length - 10} more rows</td></tr>`;
    }

    previewTable.querySelector('thead').innerHTML = headerHtml;
    previewTable.querySelector('tbody').innerHTML = bodyHtml;
    if (csvPreview) csvPreview.style.display = 'block';
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Import button
  if (importBtn) {
    importBtn.addEventListener('click', startImport);
  }

  // Start import
  async function startImport() {
    if (!csvData.length) {
      showNotification('No CSV data to import', 'error');
      return;
    }

    importBtn.disabled = true;
    importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    if (progressBar) progressBar.classList.add('active');
    if (progressFill) progressFill.style.width = '0%';

    try {
      const response = await fetch('/admin/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: csvData })
      });

      const data = await response.json();

      if (progressFill) progressFill.style.width = '100%';
      
      setTimeout(() => {
        if (progressBar) progressBar.classList.remove('active');
        displayResults(data);
        
        if (data.success) {
          showNotification(data.message || 'Import completed!', 'success');
        } else {
          showNotification(data.message || 'Import had some errors', 'warning');
        }
      }, 500);

    } catch (error) {
      showNotification('Import failed: ' + error.message, 'error');
      if (progressBar) progressBar.classList.remove('active');
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = '<i class="fas fa-play"></i> Start Import';
    }
  }

  // Display results
  function displayResults(data) {
    if (!resultsList || !results) return;

    let html = '';
    const importResults = data.results || [];

    if (importResults.length > 0) {
      importResults.forEach(r => {
        const icon = r.success ? 'check-circle' : 'times-circle';
        const cssClass = r.success ? 'success' : 'error';
        html += `
          <div class="result-item ${cssClass}">
            <i class="fas fa-${icon}"></i>
            <strong>${escapeHtml(r.username)}:</strong> ${escapeHtml(r.message)}
          </div>
        `;
      });
    } else {
      html = '<div class="result-item">No results to display</div>';
    }

    resultsList.innerHTML = html;
    results.style.display = 'block';
  }

  // Cancel button
  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelImport);
  }

  // Cancel import
  function cancelImport() {
    selectedFile = null;
    csvData = [];
    if (fileInfo) fileInfo.style.display = 'none';
    if (csvPreview) csvPreview.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (results) results.style.display = 'none';
    if (csvFileInput) csvFileInput.value = '';
  }

  // Download template
  const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
  if (downloadTemplateBtn) {
    downloadTemplateBtn.addEventListener('click', downloadTemplate);
  }

  function downloadTemplate() {
    const csv = 'Username,Email,Password,Admin\njohn.doe,john@example.com,SecurePass123,false\njane.smith,jane@example.com,SecurePass456,true\nbob.johnson,bob@example.com,,false';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
});
