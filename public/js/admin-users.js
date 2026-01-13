// Admin Users Management JavaScript

document.addEventListener('DOMContentLoaded', function() {
  // View Toggle
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const gridView = document.getElementById('gridView');
  const listView = document.getElementById('listView');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  // Add User Modal elements
  const addUserBtn = document.getElementById('addUserBtn');
  const addUserModal = document.getElementById('addUserModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const submitUserBtn = document.getElementById('submitUserBtn');
  const addUserForm = document.getElementById('addUserForm');
  const newUsernameInput = document.getElementById('newUsername');
  const newPasswordInput = document.getElementById('newPassword');
  const newFirstNameInput = document.getElementById('newFirstName');
  const newLastNameInput = document.getElementById('newLastName');
  const newEmailInput = document.getElementById('newEmail');
  const newDisplayNameInput = document.getElementById('newDisplayName');

  // Edit User Modal elements
  const editUserModal = document.getElementById('editUserModal');
  const closeEditModalBtn = document.getElementById('closeEditModalBtn');
  const cancelEditModalBtn = document.getElementById('cancelEditModalBtn');
  const submitEditBtn = document.getElementById('submitEditBtn');
  const editUserForm = document.getElementById('editUserForm');
  const editUserIdInput = document.getElementById('editUserId');
  const editUsernameInput = document.getElementById('editUsername');
  const editPasswordInput = document.getElementById('editPassword');
  const editFirstNameInput = document.getElementById('editFirstName');
  const editLastNameInput = document.getElementById('editLastName');
  const editEmailInput = document.getElementById('editEmail');
  const editDisplayNameInput = document.getElementById('editDisplayName');

  // Show Grid View
  function showGrid() {
    if (gridView) gridView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    if (gridViewBtn) gridViewBtn.classList.add('active');
    if (listViewBtn) listViewBtn.classList.remove('active');
  }

  // Show List View
  function showList() {
    if (gridView) gridView.style.display = 'none';
    if (listView) listView.style.display = 'block';
    if (gridViewBtn) gridViewBtn.classList.remove('active');
    if (listViewBtn) listViewBtn.classList.add('active');
  }

  // Filter Users
  function filterUsers() {
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    
    // Filter grid view cards
    const cards = document.querySelectorAll('.user-card');
    cards.forEach(card => {
      const name = card.dataset.name || '';
      const id = card.dataset.id || '';
      const matches = name.includes(searchTerm) || id.toLowerCase().includes(searchTerm);
      card.style.display = matches ? '' : 'none';
    });
    
    // Filter list view rows
    const rows = document.querySelectorAll('.table-list tbody tr');
    rows.forEach(row => {
      const name = row.dataset.name || '';
      const id = row.dataset.id || '';
      const matches = name.includes(searchTerm) || id.toLowerCase().includes(searchTerm);
      row.style.display = matches ? '' : 'none';
    });
  }

  // Edit User - Open modal with user data
  async function editUser(userId) {
    try {
      // Fetch user data and profile in parallel
      const [userResponse, profileResponse] = await Promise.all([
        fetch(`/admin/api/users/${userId}`),
        fetch(`/admin/api/users/${userId}/profile`)
      ]);
      
      const userData = await userResponse.json();
      const profileData = await profileResponse.json();
      
      if (userData.success && userData.user) {
        // Populate Jellyfin account fields
        if (editUserIdInput) editUserIdInput.value = userId;
        if (editUsernameInput) editUsernameInput.value = '';
        if (editUsernameInput) editUsernameInput.placeholder = `Current: ${userData.user.Name}`;
        if (editPasswordInput) editPasswordInput.value = '';
        
        // Populate extended profile fields
        const profile = profileData.profile || {};
        if (editFirstNameInput) editFirstNameInput.value = profile.first_name || '';
        if (editLastNameInput) editLastNameInput.value = profile.last_name || '';
        if (editEmailInput) editEmailInput.value = profile.email || '';
        if (editDisplayNameInput) editDisplayNameInput.value = profile.display_name || '';
        
        // Open modal
        openEditModal();
      } else {
        alert(userData.message || 'Failed to load user data');
      }
    } catch (error) {
      console.error('Error fetching user:', error);
      alert('An error occurred while loading user data');
    }
  }

  // Open Edit Modal
  function openEditModal() {
    if (editUserModal) {
      editUserModal.classList.add('active');
      if (editUsernameInput) editUsernameInput.focus();
    }
  }

  // Close Edit Modal
  function closeEditModal() {
    if (editUserModal) {
      editUserModal.classList.remove('active');
      if (editUserForm) editUserForm.reset();
    }
  }

  // Update User
  async function updateUser() {
    const userId = editUserIdInput ? editUserIdInput.value : '';
    const username = editUsernameInput ? editUsernameInput.value.trim() : '';
    const password = editPasswordInput ? editPasswordInput.value : '';
    const firstName = editFirstNameInput ? editFirstNameInput.value.trim() : '';
    const lastName = editLastNameInput ? editLastNameInput.value.trim() : '';
    const email = editEmailInput ? editEmailInput.value.trim() : '';
    const displayName = editDisplayNameInput ? editDisplayNameInput.value.trim() : '';

    if (!userId) {
      alert('User ID is missing');
      return;
    }

    // Check if any field has been changed
    const hasJellyfinChanges = username || password;
    const hasProfileChanges = firstName || lastName || email || displayName;

    if (!hasJellyfinChanges && !hasProfileChanges) {
      alert('Please enter at least one field to update');
      return;
    }

    // Disable button while processing
    if (submitEditBtn) {
      submitEditBtn.disabled = true;
      submitEditBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
      const promises = [];

      // Update Jellyfin account if needed
      if (hasJellyfinChanges) {
        promises.push(
          fetch(`/admin/api/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username || undefined, password: password || undefined })
          })
        );
      }

      // Update extended profile
      promises.push(
        fetch(`/admin/api/users/${userId}/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName, email, displayName })
        })
      );

      const results = await Promise.all(promises);
      const allSuccessful = results.every(r => r.ok);

      if (allSuccessful) {
        alert('User updated successfully!');
        closeEditModal();
        window.location.reload();
      } else {
        alert('Some updates may have failed. Please check and try again.');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      alert('An error occurred while updating the user');
    } finally {
      if (submitEditBtn) {
        submitEditBtn.disabled = false;
        submitEditBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
      }
    }
  }

  // Delete User
  function deleteUser(userId, userName) {
    if (confirm(`Are you sure you want to delete user "${userName}"? This action cannot be undone.`)) {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      fetch(`/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        }
      })
      .then(response => {
        if (response.ok) {
          window.location.reload();
        } else {
          alert('Failed to delete user. Please try again.');
        }
      })
      .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while deleting the user.');
      });
    }
  }

  // Refresh Users
  function refreshUsers() {
    window.location.reload();
  }

  // Modal Functions
  function openModal() {
    if (addUserModal) {
      addUserModal.classList.add('active');
      if (newUsernameInput) newUsernameInput.focus();
    }
  }

  function closeModal() {
    if (addUserModal) {
      addUserModal.classList.remove('active');
      if (addUserForm) addUserForm.reset();
    }
  }

  // Create User
  async function createUser() {
    const username = newUsernameInput ? newUsernameInput.value.trim() : '';
    const password = newPasswordInput ? newPasswordInput.value : '';
    const firstName = newFirstNameInput ? newFirstNameInput.value.trim() : '';
    const lastName = newLastNameInput ? newLastNameInput.value.trim() : '';
    const email = newEmailInput ? newEmailInput.value.trim() : '';
    const displayName = newDisplayNameInput ? newDisplayNameInput.value.trim() : '';

    if (!username) {
      alert('Please enter a username');
      return;
    }

    // Disable button while processing
    if (submitUserBtn) {
      submitUserBtn.disabled = true;
      submitUserBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
      // Create Jellyfin user first
      const response = await fetch('/admin/api/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (data.success && data.user) {
        // Save extended profile if any fields provided
        if (firstName || lastName || email || displayName) {
          await fetch(`/admin/api/users/${data.user.Id}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, email, displayName })
          });
        }
        
        alert(data.message || 'User created successfully!');
        closeModal();
        window.location.reload();
      } else {
        alert(data.message || 'Failed to create user');
      }
    } catch (error) {
      console.error('Error creating user:', error);
      alert('An error occurred while creating the user');
    } finally {
      if (submitUserBtn) {
        submitUserBtn.disabled = false;
        submitUserBtn.innerHTML = '<i class="fas fa-plus"></i> Create User';
      }
    }
  }

  // Event Listeners for view toggle
  if (gridViewBtn) {
    gridViewBtn.addEventListener('click', showGrid);
  }
  if (listViewBtn) {
    listViewBtn.addEventListener('click', showList);
  }

  // Event Listeners for search
  if (searchInput) {
    searchInput.addEventListener('keyup', filterUsers);
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        filterUsers();
      }
    });
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', filterUsers);
  }

  // Event Listener for refresh
  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshUsers);
  }

  // Event Listeners for Add User Modal
  if (addUserBtn) {
    addUserBtn.addEventListener('click', openModal);
  }
  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeModal);
  }
  if (cancelModalBtn) {
    cancelModalBtn.addEventListener('click', closeModal);
  }
  if (submitUserBtn) {
    submitUserBtn.addEventListener('click', createUser);
  }

  // Close modal on overlay click
  if (addUserModal) {
    addUserModal.addEventListener('click', function(e) {
      if (e.target === addUserModal) {
        closeModal();
      }
    });
  }

  // Close modals on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (addUserModal && addUserModal.classList.contains('active')) {
        closeModal();
      }
      if (editUserModal && editUserModal.classList.contains('active')) {
        closeEditModal();
      }
    }
  });

  // Submit form on Enter key in username field
  if (newUsernameInput) {
    newUsernameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        createUser();
      }
    });
  }

  // Event Listeners for Edit User Modal
  if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', closeEditModal);
  }
  if (cancelEditModalBtn) {
    cancelEditModalBtn.addEventListener('click', closeEditModal);
  }
  if (submitEditBtn) {
    submitEditBtn.addEventListener('click', updateUser);
  }

  // Close edit modal on overlay click
  if (editUserModal) {
    editUserModal.addEventListener('click', function(e) {
      if (e.target === editUserModal) {
        closeEditModal();
      }
    });
  }

  // Submit edit form on Enter key
  if (editUsernameInput) {
    editUsernameInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        updateUser();
      }
    });
  }

  // Event delegation for edit and delete buttons
  document.addEventListener('click', function(e) {
    const editBtn = e.target.closest('[data-action="edit"]');
    const deleteBtn = e.target.closest('[data-action="delete"]');

    if (editBtn) {
      const userId = editBtn.dataset.userId;
      if (userId) {
        editUser(userId);
      }
    }

    if (deleteBtn) {
      const userId = deleteBtn.dataset.userId;
      const userName = deleteBtn.dataset.userName;
      if (userId) {
        deleteUser(userId, userName);
      }
    }
  });
});
