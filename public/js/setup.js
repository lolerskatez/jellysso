/**
 * Setup page JavaScript
 */

let currentStep = 1;
const totalSteps = 2;

// Load existing config if available
async function loadConfig() {
  try {
    const response = await fetch('/setup/config');
    if (response.ok) {
      const config = await response.json();
      const jellyfinUrlField = document.getElementById('jellyfinUrl');
      if (jellyfinUrlField) jellyfinUrlField.value = config.jellyfinUrl || '';
      
      const jellyfinPublicUrlField = document.getElementById('jellyfinPublicUrl');
      if (jellyfinPublicUrlField) jellyfinPublicUrlField.value = config.jellyfinPublicUrl || '';
      
      const webAppPublicUrlField = document.getElementById('webAppPublicUrl');
      if (webAppPublicUrlField) webAppPublicUrlField.value = config.webAppPublicUrl || '';
    }
  } catch (error) {
    console.log('No existing config to load');
  }

  // Pre-fill from URL parameters if present
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('jellyfinUrl')) {
    const jellyfinUrlField = document.getElementById('jellyfinUrl');
    if (jellyfinUrlField) jellyfinUrlField.value = decodeURIComponent(urlParams.get('jellyfinUrl'));
  }
  if (urlParams.has('jellyfinPublicUrl')) {
    const jellyfinPublicUrlField = document.getElementById('jellyfinPublicUrl');
    if (jellyfinPublicUrlField) jellyfinPublicUrlField.value = decodeURIComponent(urlParams.get('jellyfinPublicUrl'));
  }
  if (urlParams.has('webAppPublicUrl')) {
    const webAppPublicUrlField = document.getElementById('webAppPublicUrl');
    if (webAppPublicUrlField) webAppPublicUrlField.value = decodeURIComponent(urlParams.get('webAppPublicUrl'));
  }
}

function showStep(step) {
  // Hide all steps
  document.querySelectorAll('.setup-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));

  // Show current step
  const stepEl = document.getElementById(`step${step}`);
  if (stepEl) {
    stepEl.classList.add('active');
  }
  
  const stepIndicator = document.querySelector(`.step[data-step="${step}"]`);
  if (stepIndicator) {
    stepIndicator.classList.add('active');
  }

  // Update progress bar
  const progress = (step / totalSteps) * 100;
  const progressFill = document.getElementById('progressFill');
  if (progressFill) {
    progressFill.style.width = `${progress}%`;
  }

  currentStep = step;
}

function nextStep() {
  if (currentStep < totalSteps) {
    showStep(currentStep + 1);
  }
}

function prevStep() {
  if (currentStep > 1) {
    showStep(currentStep - 1);
  }
}

function showError(message) {
  // Remove existing error
  const existingError = document.querySelector('.error-message');
  if (existingError) existingError.remove();

  // Add new error
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = message;

  const form = document.querySelector('.setup-step.active form');
  if (form) {
    form.insertBefore(errorDiv, form.querySelector('.form-actions'));
  }
}

function hideError() {
  const error = document.querySelector('.error-message');
  if (error) error.remove();
}

// Form submissions
async function completeSetup() {
  try {
    await fetch('/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.log('Setup completion failed:', error);
  }
}

function showCompletion(result) {
  // Get current config to show all details
  fetch('/setup/config')
    .then(response => response.json())
    .then(config => {
      const configSummary = document.getElementById('configSummary');
      if (configSummary) {
        configSummary.innerHTML = `
          <li>Jellyfin Server: ${config.jellyfinUrl}</li>
          <li>Jellyfin Public URL: ${config.jellyfinPublicUrl}</li>
          <li>Web App Public URL: ${config.webAppPublicUrl}</li>
          <li>Admin User: ${config.adminUser}</li>
          <li>API Key: <code style="word-break: break-all;">${result.apiKey}</code></li>
          <li>Setup completed: ${new Date().toLocaleString()}</li>
        `;
      }
      showStep('Complete');
    })
    .catch(() => {
      // Fallback if config fetch fails
      const configSummary = document.getElementById('configSummary');
      if (configSummary) {
        configSummary.innerHTML = `
          <li>Admin User: Configured</li>
          <li>API Key: <code style="word-break: break-all;">${result.apiKey}</code></li>
          <li>Setup completed: ${new Date().toLocaleString()}</li>
        `;
      }
      showStep('Complete');
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  const step1Form = document.getElementById('step1Form');
  if (step1Form) {
    step1Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const response = await fetch('/setup/step1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
          nextStep();
        } else {
          showError(result.error);
        }
      } catch (error) {
        showError('Network error. Please try again.');
      }
    });
  }

  const step2Form = document.getElementById('step2Form');
  if (step2Form) {
    step2Form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const formData = new FormData(e.target);
      const data = Object.fromEntries(formData);

      try {
        const response = await fetch('/setup/step2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const result = await response.json();
        if (result.success) {
          // Complete the setup now that API key is generated
          await completeSetup();
          showCompletion(result);
        } else {
          showError(result.error);
        }
      } catch (error) {
        showError('Network error. Please try again.');
      }
    });
  }

  // Bind prev/next buttons
  const prevButtons = document.querySelectorAll('[data-action="prev"]');
  prevButtons.forEach(btn => {
    btn.addEventListener('click', prevStep);
  });

  const nextButtons = document.querySelectorAll('[data-action="next"]');
  nextButtons.forEach(btn => {
    btn.addEventListener('click', nextStep);
  });
});
