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
