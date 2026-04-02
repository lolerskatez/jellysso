// Load data on page load
let profilesMap = {}; // id -> name

async function loadData() {
  try {
    // Load statistics
    const statsResponse = await fetch('/api/invites/stats');
    const statsData = await statsResponse.json();
    if (statsData.success) {
      document.getElementById('statTotal').textContent = statsData.stats.total || 0;
      document.getElementById('statPending').textContent = statsData.stats.pending || 0;
      document.getElementById('statAccepted').textContent = statsData.stats.accepted || 0;
      document.getElementById('statExpired').textContent = statsData.stats.expired || 0;
    }

    // Load invites
    const invitesResponse = await fetch('/api/invites?limit=100');
    const invitesData = await invitesResponse.json();
    if (invitesData.success) {
      populateInvitesTable(invitesData.invites);
    }

    // Load profiles for dropdown
    const profilesResponse = await fetch('/api/signup-profiles');
    const profilesData = await profilesResponse.json();
    if (profilesData.success) {
      profilesMap = {};
      const select = document.getElementById('profileSelect');
      select.innerHTML = '<option value="">Select a profile</option>';
      profilesData.profiles.forEach(profile => {
        profilesMap[profile.id] = profile.name;
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        select.appendChild(option);
      });
      // Re-render table now that names are known
      if (invitesData?.success) populateInvitesTable(invitesData.invites);
    }

    document.getElementById('loadingContainer').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'block';
  } catch (error) {
    showAlert('Failed to load data: ' + error.message, 'error');
  }
}

function populateInvitesTable(invites) {
  const tbody = document.getElementById('invitesTableBody');
  tbody.innerHTML = '';

  if (invites.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: var(--spacing-2xl);">No invites yet</td></tr>';
    return;
  }

  invites.forEach(invite => {
    const row = document.createElement('tr');
    const createdDate = new Date(invite.createdAt).toLocaleDateString();
    const expiresDate = invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'Never';
    
    const maxUses = invite.maxUses || 1;
    const usageCount = invite.usageCount || 0;
    const usageBadge = maxUses > 1
      ? `<span class="usage-badge">${usageCount}/${maxUses}</span>`
      : (usageCount > 0 ? `<span class="usage-badge">${usageCount}/1</span>` : '');

    row.innerHTML = `
      <td>
        <span class="code-badge" data-copy="${invite.code}" title="Click to copy">
          ${invite.code}
        </span>
      </td>
      <td>${profilesMap[invite.signupProfileId] || invite.signupProfileId}</td>
      <td>${invite.label ? `<span class="invite-label-badge">${invite.label}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>
        <span class="status-badge status-${invite.status}">
          ${invite.status}
        </span>
      </td>
      <td>${usageBadge || (usageCount + '/' + maxUses)}</td>
      <td>${createdDate}</td>
      <td>${expiresDate}</td>
      <td>
        ${invite.status === 'pending' ? `
          <button class="btn-small btn-secondary" data-copy-url="${invite.code}" title="Copy signup URL"><i class="fas fa-link"></i></button>
          <button class="btn-small btn-danger" data-revoke="${invite.code}">Revoke</button>
        ` : '-'}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function openCreateModal() {
  document.getElementById('createModal').classList.add('show');
  document.getElementById('createForm').reset();
}

function closeModal() {
  document.getElementById('createModal').classList.remove('show');
}

async function handleCreateInvite(event) {
  event.preventDefault();

  const profileId = document.getElementById('profileSelect').value;
  const count = parseInt(document.getElementById('countInput').value);
  const expiryDays = document.getElementById('expiryInput').value ? parseInt(document.getElementById('expiryInput').value) : null;
  const maxUses = parseInt(document.getElementById('maxUsesInput').value) || 1;
  const userExpiryDays = document.getElementById('userExpiryInput').value ? parseInt(document.getElementById('userExpiryInput').value) : null;
  const label = document.getElementById('labelInput').value.trim() || null;

  if (!profileId) {
    showAlert('Please select a profile', 'error');
    return;
  }

  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const response = await fetch('/api/invites', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify({
        signupProfileId: profileId,
        count,
        expiryDays,
        maxUses,
        userExpiryDays,
        label
      })
    });

    const data = await response.json();

    if (data.success) {
      closeModal();
      loadData();
      const base = window.location.origin;
      if (data.invites.length === 1) {
        const url = `${base}/signup?invite=${data.invites[0].code}`;
        showSignupUrlDialog(url);
      } else {
        const urls = data.invites.map(inv => `${base}/signup?invite=${inv.code}`).join('\n');
        showSignupUrlDialog(urls, true);
      }
    } else {
      showAlert(data.error || 'Failed to create invites', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create';
  }
}

async function revokeInvite(code) {
  if (!confirm('Are you sure you want to revoke this invite?')) return;

  try {
    const response = await fetch(`/api/invites/${code}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      }
    });
    const data = await response.json();

    if (data.success) {
      showAlert('Invite revoked', 'success');
      loadData();
    } else {
      showAlert(data.error || 'Failed to revoke invite', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showAlert('Copied to clipboard!', 'success');
  });
}

function showAlert(message, type) {
  const container = document.getElementById('alertContainer');
  const alertClass = type === 'error' ? 'alert-error' : 'alert-success';
  container.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
  setTimeout(() => {
    container.innerHTML = '';
  }, 5000);
}

// Load on page load
window.addEventListener('DOMContentLoaded', loadData);

// Wire up static handlers
document.getElementById('openCreateInviteBtn')?.addEventListener('click', openCreateModal);
document.getElementById('createForm')?.addEventListener('submit', handleCreateInvite);
document.getElementById('cancelCreateInviteBtn')?.addEventListener('click', closeModal);
document.getElementById('closeCreateModalBtn')?.addEventListener('click', closeModal);

// Event delegation for dynamically generated rows
document.getElementById('invitesTableBody')?.addEventListener('click', (e) => {
  const copyEl = e.target.closest('[data-copy]');
  if (copyEl) { copyToClipboard(copyEl.dataset.copy); return; }
  const revokeEl = e.target.closest('[data-revoke]');
  if (revokeEl) { revokeInvite(revokeEl.dataset.revoke); return; }
});

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
