/**
 * Users page JavaScript
 */

let allUsers = [];

// Sidebar toggle for mobile
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebar = document.querySelector('.sidebar');

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
  });
}

// Close sidebar on link click (mobile)
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    sidebar.classList.remove('active');
  });
});

// Update active nav link
const currentPath = window.location.pathname;
document.querySelectorAll('.nav-link').forEach(link => {
  if (link.getAttribute('href') === currentPath) {
    link.classList.add('active');
  }
});

// Logout function
function logout() {
  if (confirm('Are you sure you want to logout?')) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
    
    fetch('/api/auth/logout', { 
      method: 'POST',
      credentials: 'include',
      headers
    })
      .then(() => {
        window.location.href = '/login';
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }
}

// Bind logout button
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', logout);
}

async function loadUsers() {
  const loadingState = document.getElementById('loadingState');
  const usersList = document.getElementById('usersList');

  loadingState.style.display = 'block';
  usersList.innerHTML = '';

  try {
    const response = await fetch('/api/users');
    const data = await response.json();
    allUsers = data.Items || data || [];
    filterAndDisplayUsers();
  } catch (error) {
    console.error('Failed to load users:', error);
    usersList.innerHTML = '<div class="alert alert-error"><i class="fas fa-exclamation-triangle"></i> Failed to load users</div>';
  } finally {
    loadingState.style.display = 'none';
  }
}

function filterAndDisplayUsers() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase();
  const filterValue = document.getElementById('filterSelect').value;

  let filteredUsers = allUsers.filter(user => {
    const matchesSearch = user.Name.toLowerCase().includes(searchTerm);
    const matchesFilter = filterValue === '' ||
      (filterValue === 'admin' && user.Policy?.IsAdministrator) ||
      (filterValue === 'disabled' && user.Policy?.IsDisabled);

    return matchesSearch && matchesFilter;
  });

  displayUsers(filteredUsers);
}

function displayUsers(users) {
  const usersList = document.getElementById('usersList');
  const emptyState = document.getElementById('emptyState');

  if (users.length === 0) {
    usersList.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  const html = users.map(user => {
    const userCard = document.createElement('div');
    userCard.className = 'user-card';
    userCard.innerHTML = `
      <div class="user-avatar">${user.Name.charAt(0).toUpperCase()}</div>
      <div class="user-name">${user.Name}</div>
      <div class="user-role">
        ${user.Policy?.IsAdministrator ? 'Administrator' : 'User'}
      </div>
      <div class="user-details">
        <p><strong>ID:</strong><br><code style="font-size: 0.85rem;">${user.Id.substring(0, 8)}...</code></p>
        <p><strong>Status:</strong><br>${user.Policy?.IsDisabled ? '<span style="color: var(--error-color);">Disabled</span>' : '<span style="color: var(--success-color);">Active</span>'}</p>
        <p><strong>Last Login:</strong><br>${user.LastLoginDate ? new Date(user.LastLoginDate).toLocaleDateString() : 'Never'}</p>
      </div>
      <div class="user-actions">
      </div>
    `;
    
    // Add edit button with event listener
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-sm';
    editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit';
    editBtn.addEventListener('click', () => editUser(user.Id));
    
    // Add delete button with event listener
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-sm';
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
    deleteBtn.addEventListener('click', () => deleteUser(user.Id));
    
    userCard.querySelector('.user-actions').appendChild(editBtn);
    userCard.querySelector('.user-actions').appendChild(deleteBtn);
    
    return userCard;
  });

  usersList.innerHTML = '';
  html.forEach(card => usersList.appendChild(card));
}

function showCreateUserModal() {
  document.getElementById('createUserModal').classList.add('show');
  document.getElementById('userName').focus();
}

function closeModal() {
  document.getElementById('createUserModal').classList.remove('show');
  document.getElementById('createUserForm').reset();
}

async function createUser() {
  const submitBtn = document.getElementById('createUserSubmitBtn');
  const createLoading = document.getElementById('createLoading');
  const createText = document.getElementById('createText');

  createLoading.style.display = 'inline-flex';
  createText.style.display = 'none';
  submitBtn.disabled = true;

  const formData = new FormData(document.getElementById('createUserForm'));
  const data = Object.fromEntries(formData);

  try {
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (response.ok) {
      closeModal();
      loadUsers();
    } else {
      const error = await response.json();
      alert(`Failed to create user: ${error.message || 'Unknown error'}`);
    }
  } catch (error) {
    alert('Error creating user');
  } finally {
    createLoading.style.display = 'none';
    createText.style.display = 'inline';
    submitBtn.disabled = false;
  }
}

function editUser(userId) {
  alert('Edit functionality coming soon');
}

async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`/api/users/${userId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      loadUsers();
    } else {
      alert('Failed to delete user');
    }
  } catch (error) {
    alert('Error deleting user');
  }
}

async function loadActivityLogs() {
  const activityLogs = document.getElementById('activityLogs');
  activityLogs.innerHTML = '<div style="text-align: center; padding: var(--spacing-lg);"><div class="spinner" style="display: inline-block;"></div><p style="margin-top: var(--spacing-md);">Loading activity logs...</p></div>';

  try {
    const response = await fetch('/api/activity?limit=50');
    const data = await response.json();
    const logs = data.Items || data || [];

    if (logs.length === 0) {
      activityLogs.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: var(--spacing-lg);">No activity logs found.</p>';
      document.getElementById('activityModal').classList.add('show');
      return;
    }

    const html = logs.map(log => `
      <div class="card" style="margin-bottom: var(--spacing-md);">
        <div class="card-body">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h6 style="margin-bottom: var(--spacing-sm);">${log.Name || 'Unknown Action'}</h6>
              <p style="color: var(--text-secondary); margin-bottom: var(--spacing-sm);">${log.Type || 'Activity'}</p>
              ${log.UserName ? `<small style="color: var(--text-secondary);">User: <strong>${log.UserName}</strong></small>` : ''}
            </div>
            <small style="color: var(--text-secondary);">${new Date(log.Date).toLocaleString()}</small>
          </div>
        </div>
      </div>
    `).join('');

    activityLogs.innerHTML = html;
  } catch (error) {
    activityLogs.innerHTML = '<div class="alert alert-error"><i class="fas fa-exclamation-triangle"></i> Failed to load activity logs</div>';
  }

  document.getElementById('activityModal').classList.add('show');
}

function closeActivityModal() {
  document.getElementById('activityModal').classList.remove('show');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Load users on page load
  loadUsers();

  // Event listeners
  document.getElementById('refreshBtn').addEventListener('click', loadUsers);
  document.getElementById('createUserBtn').addEventListener('click', showCreateUserModal);
  document.getElementById('activityBtn').addEventListener('click', loadActivityLogs);
  document.getElementById('searchInput').addEventListener('input', filterAndDisplayUsers);
  document.getElementById('filterSelect').addEventListener('change', filterAndDisplayUsers);

  document.getElementById('createUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await createUser();
  });

  // Close modals when clicking on backdrop
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      e.target.classList.remove('show');
    }
  });
  
  // Modal close buttons
  const closeButtons = document.querySelectorAll('[data-close-modal]');
  closeButtons.forEach(btn => {
    const modalType = btn.getAttribute('data-close-modal');
    if (modalType === 'create') {
      btn.addEventListener('click', closeModal);
    } else if (modalType === 'activity') {
      btn.addEventListener('click', closeActivityModal);
    }
  });
});
