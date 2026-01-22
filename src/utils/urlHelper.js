/**
 * Utility functions for URL handling, especially for reverse proxy scenarios
 */

/**
 * Get the base URL for the application
 * Respects reverse proxy headers (X-Forwarded-Proto, X-Forwarded-Host)
 * Falls back to configured baseUrl if available
 * 
 * @param {Object} req - Express request object
 * @param {Object} config - Configuration object with optional baseUrl property
 * @returns {string} The base URL (e.g., https://example.com)
 */
function getBaseUrl(req, config = {}) {
  // If a baseUrl is explicitly configured, use it
  if (config.baseUrl) {
    return config.baseUrl;
  }

  // Get protocol - check X-Forwarded-Proto first (set by reverse proxy)
  const protocol = req.get('X-Forwarded-Proto') || req.protocol;

  // Get host - check X-Forwarded-Host first (set by reverse proxy)
  const host = req.get('X-Forwarded-Host') || req.get('host');

  // Construct and return base URL
  return `${protocol}://${host}`;
}

module.exports = {
  getBaseUrl
};
