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
  const exportBtn = document.getElementById('exportLogsBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function() {
      const table = document.querySelector('.audit-table');
      if (!table) return;

      const rows = table.querySelectorAll('tbody tr');
      const data = [];

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 6) {
          data.push({
            timestamp: cells[0].textContent.trim(),
            action: cells[1].textContent.trim(),
            user: cells[2].textContent.trim(),
            resource: cells[3].textContent.trim(),
            status: cells[4].textContent.trim(),
            ip: cells[5].textContent.trim()
          });
        }
      });

      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
});
