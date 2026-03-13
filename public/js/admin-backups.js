/**
 * Admin Backups JavaScript
 * Handles backup management functionality
 */

document.addEventListener('DOMContentLoaded', function() {
  let currentBackupName = null;

  // Elements
  const createBackupBtn = document.getElementById('createBackupBtn');
  const importBackupBtn = document.getElementById('importBackupBtn');
  const backupFileInput = document.getElementById('backupFileInput');
  const refreshBtn = document.getElementById('refreshBtn');
  const restoreModal = document.getElementById('restoreModal');
  const deleteModal = document.getElementById('deleteModal');
  const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  const notification = document.getElementById('notification');

  // Show notification
  function showNotification(message, type = 'success', duration = 4000) {
    if (notification) {
      notification.textContent = message;
      notification.className = `notification ${type}`;
      notification.classList.add('show');
      setTimeout(() => {
        notification.classList.remove('show');
      }, duration);
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

  // Load and display backups
  async function loadBackups() {
    const backupsList = document.getElementById('backupsList');
    if (!backupsList) return;

    try {
      const response = await fetch('/admin/api/backups');
      
      // Handle 401 Unauthorized - user session may have been invalidated
      if (response.status === 401) {
        backupsList.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.05); border-left: 3px solid var(--danger); padding: var(--spacing-lg); border-radius: var(--border-radius); text-align: center; color: var(--text-secondary);">
            <i class="fas fa-exclamation-circle" style="color: var(--danger); font-size: 1.5rem; margin-bottom: 12px; display: block;"></i>
            <strong style="color: var(--text-primary);">Session Expired</strong>
            <p>Your session was invalidated. Please refresh the page or log back in.</p>
            <button data-action="refresh-page" class="btn btn-primary" style="margin-top: var(--spacing-md);">
              <i class="fas fa-refresh"></i> Refresh Page
            </button>
          </div>
        `;
        return;
      }
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const backups = await response.json();

      if (!backups || backups.length === 0) {
        backupsList.innerHTML = `
          <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
            <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 1rem; color: var(--gray-300);"></i>
            <p><strong>No backups found</strong></p>
            <p>Create your first backup using the button above</p>
          </div>
        `;
        return;
      }

      // Build backups table
      let html = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 1rem;">
          <thead>
            <tr style="border-bottom: 2px solid var(--border-color); background-color: var(--bg-secondary);">
              <th style="padding: 12px; text-align: left; font-size: 0.8125rem; font-weight: 600; color: var(--gray-900);">Date</th>
              <th style="padding: 12px; text-align: left; font-size: 0.8125rem; font-weight: 600; color: var(--gray-900);">File Name</th>
              <th style="padding: 12px; text-align: left; font-size: 0.8125rem; font-weight: 600; color: var(--gray-900);">Size</th>
              <th style="padding: 12px; text-align: right; font-size: 0.8125rem; font-weight: 600; color: var(--gray-900);">Actions</th>
            </tr>
          </thead>
          <tbody>
      `;

      backups.forEach((backup, index) => {
        const date = new Date(backup.date);
        const dateStr = date.toLocaleDateString();
        const timeStr = date.toLocaleTimeString();
        const sizeKB = Math.round(backup.size / 1024);
        
        html += `
          <tr style="border-bottom: 1px solid var(--border-color); ${index % 2 === 0 ? 'background-color: var(--bg-secondary);' : ''}">
            <td style="padding: 12px;">
              <div style="font-weight: 600; color: var(--text-primary);">${dateStr}</div>
              <div style="font-size: 0.8125rem; color: var(--text-secondary);">${timeStr}</div>
            </td>
            <td style="padding: 12px; font-family: monospace; font-size: 0.8125rem; color: var(--text-secondary);">${backup.name}</td>
            <td style="padding: 12px; font-family: monospace; color: var(--text-secondary);">${sizeKB} KB</td>
            <td style="padding: 12px; text-align: right;">
              <div style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;">
                <button data-action="download" data-backup="${backup.name}" class="backup-action-btn backup-btn-success" title="Download">
                  <i class="fas fa-download"></i> Download
                </button>
                <button data-action="restore" data-backup="${backup.name}" class="backup-action-btn backup-btn-warning" title="Restore">
                  <i class="fas fa-undo"></i> Restore
                </button>
                <button data-action="delete" data-backup="${backup.name}" class="backup-action-btn backup-btn-danger" title="Delete">
                  <i class="fas fa-trash"></i> Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;

      backupsList.innerHTML = html;
    } catch (error) {
      backupsList.innerHTML = `<div style="color: var(--danger);">Error loading backups: ${error.message}</div>`;
      console.error('Error loading backups:', error);
    }
  }

  // Load backups on page load
  loadBackups();
  async function createBackup() {
    if (!confirm('Create a backup of the database now?')) return;

    if (createBackupBtn) {
      createBackupBtn.disabled = true;
      createBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/admin/api/backups/create', { 
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken }
      });
      const data = await response.json();

      if (data.success) {
        showNotification(data.message || 'Backup created successfully!', 'success');
        setTimeout(() => loadBackups(), 1500);
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
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/admin/api/backups/restore', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken 
        },
        body: JSON.stringify({ backupName: currentBackupName })
      });
      const data = await response.json();

      closeModal(restoreModal);

      if (data.success) {
        showNotification('✅ ' + (data.message || 'Backup restored successfully!'), 'success', 5500);
        // After restore, the database is replaced and session becomes invalid
        // Redirect to login page after 5 seconds
        setTimeout(() => {
          window.location.href = '/login';
        }, 5000);
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
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/admin/api/backups/delete', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken 
        },
        body: JSON.stringify({ backupName: currentBackupName })
      });
      const data = await response.json();

      closeModal(deleteModal);

      if (data.success) {
        showNotification(data.message || 'Backup deleted successfully!', 'success');
        setTimeout(() => loadBackups(), 1500);
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

  // Import backup
  async function importBackup(file) {
    if (!file) return;

    // Validate file is a .db file
    if (!file.name.endsWith('.db')) {
      showNotification('Please select a valid .db backup file', 'error');
      return;
    }

    if (importBackupBtn) {
      importBackupBtn.disabled = true;
      importBackupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    }

    try {
      const formData = new FormData();
      formData.append('backupFile', file);
      
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/admin/api/backups/import', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: formData
      });
      const data = await response.json();

      if (data.success) {
        showNotification(data.message || 'Backup imported successfully!', 'success');
        setTimeout(() => loadBackups(), 1500);
      } else {
        showNotification(data.message || 'Failed to import backup', 'error');
      }
    } catch (error) {
      showNotification('Error: ' + error.message, 'error');
    } finally {
      if (importBackupBtn) {
        importBackupBtn.disabled = false;
        importBackupBtn.innerHTML = '<i class="fas fa-upload"></i> Import Backup';
      }
      // Reset file input
      if (backupFileInput) backupFileInput.value = '';
    }
  }

  // Event listeners
  if (createBackupBtn) {
    createBackupBtn.addEventListener('click', createBackup);
  }

  if (importBackupBtn) {
    importBackupBtn.addEventListener('click', () => {
      if (backupFileInput) backupFileInput.click();
    });
  }

  if (backupFileInput) {
    backupFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importBackup(e.target.files[0]);
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadBackups());
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

  // Event delegation for backup action buttons and refresh
  document.addEventListener('click', function(e) {
    const downloadBtn = e.target.closest('[data-action="download"]');
    const restoreBtn = e.target.closest('[data-action="restore"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');
    const refreshBtn = e.target.closest('[data-action="refresh-page"]');

    if (downloadBtn) {
      downloadBackup(downloadBtn.dataset.backup);
    } else if (restoreBtn) {
      confirmRestore(restoreBtn.dataset.backup);
    } else if (deleteBtn) {
      confirmDelete(deleteBtn.dataset.backup);
    } else if (refreshBtn) {
      location.reload();
    }
  });
});
