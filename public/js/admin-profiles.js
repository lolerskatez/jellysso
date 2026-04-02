let profiles = [];
let editingProfileId = null;
let tiersData = [];
let librariesData = [];

async function loadLibrariesForModal(selectedIds = []) {
  const list = document.getElementById('libraryAccessList');
  if (!librariesData.length) {
    try {
      const res = await fetch('/api/signup-profiles/admin/libraries');
      const data = await res.json();
      if (data.success) librariesData = data.libraries || [];
    } catch (e) {
      console.error('Failed to load libraries', e);
    }
  }
  if (!librariesData.length) {
    list.innerHTML = '<span style="color:var(--text-secondary);font-size:0.85em;">No libraries found or Jellyfin unavailable.</span>';
    return;
  }
  list.innerHTML = librariesData.map(lib => `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
      <input type="checkbox" name="libraryAccess" value="${lib.id}"
        ${selectedIds.includes(lib.id) ? 'checked' : ''}>
      <span>${lib.name}</span>
      <span style="color:var(--text-secondary);font-size:0.8em;">(${lib.type})</span>
    </label>
  `).join('');
}

async function loadTiersForModal() {
  if (!tiersData.length) {
    try {
      const res = await fetch('/api/policy/admin/tiers');
      const data = await res.json();
      if (data.success) tiersData = data.tiers || [];
    } catch (e) {
      console.error('Failed to load tiers', e);
    }
  }
  const select = document.getElementById('tierInput');
  select.innerHTML = tiersData.length
    ? tiersData.map(t => `<option value="${t.id}">${t.displayName}</option>`).join('')
    : '<option value="">No tiers configured</option>';
  return tiersData;
}

function syncStreamsFromTier() {
  const tierId = document.getElementById('tierInput').value;
  const tier = tiersData.find(t => t.id === tierId);
  if (tier) {
    const streamsEl = document.getElementById('streamsInput');
    streamsEl.type = tier.maxConcurrentStreams >= 999 ? 'text' : 'number';
    streamsEl.value = tier.maxConcurrentStreams >= 999 ? 'Unlimited' : tier.maxConcurrentStreams;
  }
}

async function loadProfiles() {
  try {
    const response = await fetch('/api/signup-profiles/admin/with-stats');
    const data = await response.json();

    if (data.success) {
      profiles = data.profiles;
      renderProfiles();
    } else {
      showAlert('Failed to load profiles', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  } finally {
    document.getElementById('loadingContainer').style.display = 'none';
  }
}

function renderProfiles() {
  const container = document.getElementById('profilesContainer');
  container.innerHTML = '';

  if (profiles.length === 0) {
    document.getElementById('emptyState').style.display = 'block';
    container.style.display = 'none';
    return;
  }

  document.getElementById('emptyState').style.display = 'none';
  container.style.display = 'grid';

  profiles.forEach(profile => {
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `
      <h3>${profile.name}</h3>
      <p class="description">${profile.description || 'No description'}</p>
      
      <div class="profile-info">
        <div class="profile-info-item">
          <span>Tier:</span>
          <strong>${(tiersData.find(t => t.id === profile.jellyfinTier)?.displayName) || profile.jellyfinTier || 'None'}</strong>
        </div>
        <div class="profile-info-item">
          <span>Max Streams:</span>
          <strong>${(profile.jellyfinPlaybackLimits?.maxConcurrentStreams >= 999 || !profile.jellyfinPlaybackLimits?.maxConcurrentStreams) ? 'Unlimited' : profile.jellyfinPlaybackLimits.maxConcurrentStreams}</strong>
        </div>
        <div class="profile-info-item">
          <span>Users Created:</span>
          <strong>${profile.stats?.totalUsersCreated || 0}</strong>
        </div>
        <div class="profile-info-item">
          <span>Status:</span>
          <strong>${profile.isActive ? 'Active' : 'Inactive'}</strong>
        </div>
      </div>

      <div class="profile-actions">
        <button class="btn-small btn-edit" data-edit="${profile.id}">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn-small btn-duplicate" data-duplicate="${profile.id}">
          <i class="fas fa-copy"></i> Duplicate
        </button>
        <button class="btn-small btn-delete" data-delete="${profile.id}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

async function openCreateModal() {
  editingProfileId = null;
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'Create Profile';
  document.getElementById('profileForm').reset();
  document.getElementById('requireContactVerificationInput').checked = false;
  document.getElementById('profileModal').classList.add('show');
  await loadTiersForModal();
  syncStreamsFromTier();
  await loadLibrariesForModal([]);
}

function closeModal() {
  document.getElementById('profileModal').classList.remove('show');
}

async function editProfile(profileId) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  editingProfileId = profileId;
  const titleEl = document.getElementById('modalTitle');
  if (titleEl) titleEl.childNodes[titleEl.childNodes.length - 1].textContent = 'Edit Profile';
  document.getElementById('nameInput').value = profile.name;
  document.getElementById('descInput').value = profile.description || '';
  document.getElementById('bitrateInput').value = profile.jellyfinPlaybackLimits?.maxBitrate || '1080p';
  document.getElementById('requireContactVerificationInput').checked = !!profile.requireContactVerification;
  document.getElementById('profileModal').classList.add('show');
  await loadTiersForModal();
  document.getElementById('tierInput').value = profile.jellyfinTier || tiersData[0]?.id || '';
  syncStreamsFromTier();
  const selectedLibraries = Array.isArray(profile.jellyfinLibraryAccess) && !profile.jellyfinLibraryAccess.includes('all')
    ? profile.jellyfinLibraryAccess
    : [];
  await loadLibrariesForModal(selectedLibraries);
}

async function handleSaveProfile(event) {
  event.preventDefault();

  const checkedLibraries = Array.from(
    document.querySelectorAll('input[name="libraryAccess"]:checked')
  ).map(cb => cb.value);

  const profile = {
    name: document.getElementById('nameInput').value,
    description: document.getElementById('descInput').value,
    jellyfinTier: document.getElementById('tierInput').value,
    jellyfinLibraryAccess: checkedLibraries.length ? checkedLibraries : ['all'],
    requireContactVerification: document.getElementById('requireContactVerificationInput').checked,
    jellyfinPlaybackLimits: {
      maxConcurrentStreams: document.getElementById('streamsInput').value === 'Unlimited' ? 999 : parseInt(document.getElementById('streamsInput').value),
      maxBitrate: document.getElementById('bitrateInput').value
    }
  };

  const method = editingProfileId ? 'PUT' : 'POST';
  const url = editingProfileId ? `/api/signup-profiles/${editingProfileId}` : '/api/signup-profiles';

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify(profile)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Profile save failed:', response.status, data);
    }

    if (data.success) {
      showAlert(editingProfileId ? 'Profile updated' : 'Profile created', 'success');
      closeModal();
      loadProfiles();
    } else {
      showAlert(data.error || 'Failed to save profile', 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

async function duplicateProfile(profileId) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  const newName = prompt(`New profile name:`, `${profile.name} (Copy)`);
  if (!newName) return;

  try {
    const response = await fetch(`/api/signup-profiles/${profileId}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      },
      body: JSON.stringify({ newName })
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Profile duplicated', 'success');
      loadProfiles();
    } else {
      showAlert(data.error, 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

async function deleteProfile(profileId) {
  if (!confirm('Are you sure you want to delete this profile?')) return;

  try {
    const response = await fetch(`/api/signup-profiles/${profileId}`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content
      }
    });

    const data = await response.json();

    if (data.success) {
      showAlert('Profile deleted', 'success');
      loadProfiles();
    } else {
      showAlert(data.error, 'error');
    }
  } catch (error) {
    showAlert('Error: ' + error.message, 'error');
  }
}

function showAlert(message, type) {
  const container = document.getElementById('alertContainer');
  const alertClass = type === 'error' ? 'alert-error' : 'alert-success';
  container.innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
  setTimeout(() => {
    container.innerHTML = '';
  }, 5000);
}

window.addEventListener('DOMContentLoaded', () => {
  loadTiersForModal();
  loadProfiles();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('openCreateProfileBtn')?.addEventListener('click', openCreateModal);
document.getElementById('tierInput')?.addEventListener('change', syncStreamsFromTier);
document.getElementById('profileForm')?.addEventListener('submit', handleSaveProfile);
document.getElementById('cancelProfileModalBtn')?.addEventListener('click', closeModal);
document.getElementById('closeProfileModalBtn')?.addEventListener('click', closeModal);

document.getElementById('profilesContainer')?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { editProfile(editBtn.dataset.edit); return; }
  const dupBtn = e.target.closest('[data-duplicate]');
  if (dupBtn) { duplicateProfile(dupBtn.dataset.duplicate); return; }
  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) { deleteProfile(delBtn.dataset.delete); return; }
});
