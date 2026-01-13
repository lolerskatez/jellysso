/**
 * Admin Backups JavaScript
 * Handles backup management functionality
 */

document.addEventListener('DOMContentLoaded', function() {
  let currentBackupName = null;

  // Elements
  const createBackupBtn = document.getElementById('createBackupBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const restoreModal = document.getElementById('restoreModal');
  const deleteModal = document.getElementById('deleteModal');
  const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const notification = document.getElementById('notification');

  // Show notification
  function showNotification(message, type = 'success') {
    if (notification) {
      notification.textContent = message;
      notification.className = `notification ${type}`;
      notification.classList.add('show');
      setTimeout(() => {
        notification.classList.remove('show');
      }, 4000);
    }
  }

  // Open modal
  function openModal(modal) {
    if (modal) modal.classList.add('active');
  }

  // Close modal
  function closeModal(modal) {
    if (modal) modal.classList.remove('active');
    currentBackupName = null;
  }

  // Create backup
  async function createBackup() {
    if (!confirm('Create a new database backup now?')) return;

    if (createBackupBtn) {
      createBackupBtn.disabled = true;
      createBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
      const response = await fetch('/admin/api/backups/create', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        showNotification(data.message || 'Backup created successfully!', 'success');
        setTimeout(() => location.reload(), 1500);
      } else {
        showNotification(data.message || 'Failed to create backup', 'error');
      }
    } catch (error) {
      showNotification('Error: ' + error.message, 'error');
    } finally {
      if (createBackupBtn) {
        createBackupBtn.disabled = false;
        createBackupBtn.innerHTML = '<i class="fas fa-plus"></i> Create Backup';
      }
    }
  }

  // Download backup
  function downloadBackup(filename) {
    window.location.href = '/admin/api/backups/download?file=' + encodeURIComponent(filename);
  }

  // Confirm restore
  function confirmRestore(filename) {
    currentBackupName = filename;
    const nameEl = document.getElementById('restoreBackupName');
    if (nameEl) nameEl.textContent = filename;
    openModal(restoreModal);
  }

  // Restore backup
  async function restoreBackup() {
    if (!currentBackupName) return;

    if (confirmRestoreBtn) {
      confirmRestoreBtn.disabled = true;
      confirmRestoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
    }

    try {
      const response = await fetch('/admin/api/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName: currentBackupName })
      });
      const data = await response.json();

      closeModal(restoreModal);

      if (data.success) {
        showNotification(data.message || 'Backup restored successfully!', 'success');
        setTimeout(() => location.reload(), 2000);
      } else {
        showNotification(data.message || 'Failed to restore backup', 'error');
      }
    } catch (error) {
      showNotification('Error: ' + error.message, 'error');
    } finally {
      if (confirmRestoreBtn) {
        confirmRestoreBtn.disabled = false;
        confirmRestoreBtn.innerHTML = '<i class="fas fa-undo"></i> Restore';
      }
    }
  }

  // Confirm delete
  function confirmDelete(filename) {
    currentBackupName = filename;
    const nameEl = document.getElementById('deleteBackupName');
    if (nameEl) nameEl.textContent = filename;
    openModal(deleteModal);
  }

  // Delete backup
  async function deleteBackup() {
    if (!currentBackupName) return;

    if (confirmDeleteBtn) {
      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    }

    try {
      const response = await fetch('/admin/api/backups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName: currentBackupName })
      });
      const data = await response.json();

      closeModal(deleteModal);

      if (data.success) {
        showNotification(data.message || 'Backup deleted successfully!', 'success');
        setTimeout(() => location.reload(), 1500);
      } else {
        showNotification(data.message || 'Failed to delete backup', 'error');
      }
    } catch (error) {
      showNotification('Error: ' + error.message, 'error');
    } finally {
      if (confirmDeleteBtn) {
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }
  }

  // Event listeners
  if (createBackupBtn) {
    createBackupBtn.addEventListener('click', createBackup);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => location.reload());
  }

  if (confirmRestoreBtn) {
    confirmRestoreBtn.addEventListener('click', restoreBackup);
  }

  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', deleteBackup);
  }

  // Close modal buttons
  document.querySelectorAll('[data-action="close-modal"]').forEach(btn => {
    btn.addEventListener('click', function() {
      const modal = this.closest('.modal-overlay');
      closeModal(modal);
    });
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) closeModal(this);
    });
  });

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(closeModal);
    }
  });

  // Event delegation for backup action buttons
  document.addEventListener('click', function(e) {
    const downloadBtn = e.target.closest('[data-action="download"]');
    const restoreBtn = e.target.closest('[data-action="restore"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');

    if (downloadBtn) {
      downloadBackup(downloadBtn.dataset.backup);
    } else if (restoreBtn) {
      confirmRestore(restoreBtn.dataset.backup);
    } else if (deleteBtn) {
      confirmDelete(deleteBtn.dataset.backup);
    }
  });
});
