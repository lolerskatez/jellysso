// Admin Audit Logs JavaScript

document.addEventListener('DOMContentLoaded', function() {
  // Modal elements
  const detailsModal = document.getElementById('detailsModal');
  const modalContent = document.getElementById('modalDetailsContent');
  const closeModalBtn = document.getElementById('closeDetailsModal');
  const modalOverlay = detailsModal;

  // Open modal with details
  function showDetails(detailsJson) {
    try {
      const details = JSON.parse(detailsJson);
      const formatted = JSON.stringify(details, null, 2);
      
      if (modalContent) {
        modalContent.textContent = formatted;
      }
      if (detailsModal) {
        detailsModal.classList.add('active');
      }
    } catch (e) {
      console.error('Error parsing details:', e);
    }
  }

  // Close modal
  function closeModal() {
    if (detailsModal) {
      detailsModal.classList.remove('active');
    }
  }

  // Event delegation for view details buttons
  document.addEventListener('click', function(e) {
    const viewBtn = e.target.closest('[data-action="view-details"]');
    if (viewBtn) {
      const details = viewBtn.dataset.details;
      if (details) {
        showDetails(details);
      }
    }
  });

  // Close modal events
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeModal);
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', function(e) {
      if (e.target === modalOverlay) {
        closeModal();
      }
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && detailsModal && detailsModal.classList.contains('active')) {
      closeModal();
    }
  });

  // Clear logs functionality
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const clearLogsModal = document.getElementById('clearLogsModal');
  const closeClearLogsModal = document.getElementById('closeClearLogsModal');
  const cancelClearLogs = document.getElementById('cancelClearLogs');
  const confirmClearLogs = document.getElementById('confirmClearLogs');

  if (clearLogsBtn && clearLogsModal) {
    clearLogsBtn.addEventListener('click', () => clearLogsModal.classList.add('active'));
    closeClearLogsModal.addEventListener('click', () => clearLogsModal.classList.remove('active'));
    cancelClearLogs.addEventListener('click', () => clearLogsModal.classList.remove('active'));
    clearLogsModal.addEventListener('click', (e) => {
      if (e.target === clearLogsModal) clearLogsModal.classList.remove('active');
    });

    confirmClearLogs.addEventListener('click', async () => {
      confirmClearLogs.disabled = true;
      confirmClearLogs.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';
      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
        const res = await fetch('/admin/api/audit-logs', {
          method: 'DELETE',
          headers: { 'X-CSRF-Token': csrfToken }
        });
        const data = await res.json();
        if (data.success) {
          clearLogsModal.classList.remove('active');
          window.location.reload();
        } else {
          alert('Failed to clear logs: ' + data.message);
          confirmClearLogs.disabled = false;
          confirmClearLogs.innerHTML = '<i class="fas fa-trash"></i> Delete All Logs';
        }
      } catch (err) {
        alert('Error clearing logs: ' + err.message);
        confirmClearLogs.disabled = false;
        confirmClearLogs.innerHTML = '<i class="fas fa-trash"></i> Delete All Logs';
      }
    });
  }

  // Export logs functionality
  function escapeCsvField(value) {
    const str = String(value ?? '').replace(/\r?\n/g, ' ');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function buildCsv(rows) {
    const headers = ['Timestamp', 'Action', 'User', 'Resource', 'Status', 'IP'];
    const lines = [headers.join(',')];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 6) {
        lines.push([
          escapeCsvField(cells[0].textContent.trim().replace(/\s+/g, ' ')),
          escapeCsvField(cells[1].textContent.trim()),
          escapeCsvField(cells[2].textContent.trim()),
          escapeCsvField(cells[3].textContent.trim()),
          escapeCsvField(cells[4].textContent.trim()),
          escapeCsvField(cells[5].textContent.trim())
        ].join(','));
      }
    });
    return lines.join('\r\n');
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const exportBtn = document.getElementById('exportLogsBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportDropdown = document.getElementById('exportDropdown');

  // Toggle dropdown
  if (exportBtn && exportDropdown) {
    exportBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      exportDropdown.classList.toggle('active');
    });
    document.addEventListener('click', function() {
      exportDropdown.classList.remove('active');
    });
  }

  // CSV export
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', function() {
      const table = document.querySelector('.audit-table');
      if (!table) return;
      const rows = table.querySelectorAll('tbody tr');
      const csv = buildCsv(rows);
      triggerDownload(csv, `audit-logs-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv;charset=utf-8;');
      if (exportDropdown) exportDropdown.classList.remove('active');
    });
  }

  // Plain text export
  if (exportTxtBtn) {
    exportTxtBtn.addEventListener('click', function() {
      const table = document.querySelector('.audit-table');
      if (!table) return;
      const rows = table.querySelectorAll('tbody tr');
      const dateStr = new Date().toISOString().split('T')[0];
      const header = `Audit Logs Export — ${dateStr}\n${'='.repeat(60)}\n`;
      const lines = [header];
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
          lines.push(
            `Timestamp : ${cells[0].textContent.trim().replace(/\s+/g, ' ')}\n` +
            `Action    : ${cells[1].textContent.trim()}\n` +
            `User      : ${cells[2].textContent.trim()}\n` +
            `Resource  : ${cells[3].textContent.trim()}\n` +
            `Status    : ${cells[4].textContent.trim()}\n` +
            `IP        : ${cells[5].textContent.trim()}\n` +
            `${'-'.repeat(40)}`
          );
        }
      });
      triggerDownload(lines.join('\n'), `audit-logs-${dateStr}.txt`, 'text/plain;charset=utf-8;');
      if (exportDropdown) exportDropdown.classList.remove('active');
    });
  }
});
