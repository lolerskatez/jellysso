let profiles = [];
let editingProfileId = null;

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
          <strong>${profile.jellyfinTier || 'Basic'}</strong>
        </div>
        <div class="profile-info-item">
          <span>Max Streams:</span>
          <strong>${profile.jellyfinPlaybackLimits?.maxConcurrentStreams || 'Unlimited'}</strong>
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

function openCreateModal() {
  editingProfileId = null;
  document.getElementById('modalTitle').textContent = 'Create Profile';
  document.getElementById('profileForm').reset();
  document.getElementById('profileModal').classList.add('show');
}

function closeModal() {
  document.getElementById('profileModal').classList.remove('show');
}

function editProfile(profileId) {
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  editingProfileId = profileId;
  document.getElementById('modalTitle').textContent = 'Edit Profile';
  document.getElementById('nameInput').value = profile.name;
  document.getElementById('descInput').value = profile.description || '';
  document.getElementById('tierInput').value = profile.jellyfinTier || 'basic';
  document.getElementById('streamsInput').value = profile.jellyfinPlaybackLimits?.maxConcurrentStreams || 1;
  document.getElementById('bitrateInput').value = profile.jellyfinPlaybackLimits?.maxBitrate || '1080p';
  document.getElementById('profileModal').classList.add('show');
}

async function handleSaveProfile(event) {
  event.preventDefault();

  const profile = {
    name: document.getElementById('nameInput').value,
    description: document.getElementById('descInput').value,
    jellyfinTier: document.getElementById('tierInput').value,
    jellyfinPlaybackLimits: {
      maxConcurrentStreams: parseInt(document.getElementById('streamsInput').value),
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

window.addEventListener('DOMContentLoaded', loadProfiles);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

document.getElementById('openCreateProfileBtn')?.addEventListener('click', openCreateModal);
document.getElementById('profileForm')?.addEventListener('submit', handleSaveProfile);
document.getElementById('cancelProfileModalBtn')?.addEventListener('click', closeModal);

document.getElementById('profilesContainer')?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('[data-edit]');
  if (editBtn) { editProfile(editBtn.dataset.edit); return; }
  const dupBtn = e.target.closest('[data-duplicate]');
  if (dupBtn) { duplicateProfile(dupBtn.dataset.duplicate); return; }
  const delBtn = e.target.closest('[data-delete]');
  if (delBtn) { deleteProfile(delBtn.dataset.delete); return; }
});
