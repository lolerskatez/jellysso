/**
 * Utility functions for URL handling, especially for reverse proxy scenarios
 */

/**
 * Get the base URL for the application
 * Respects reverse proxy headers (X-Forwarded-Proto, X-Forwarded-Host, CF-Visitor)
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

  // Get protocol - check multiple headers for reverse proxy scenarios
  let protocol = req.protocol;

  // Check for Cloudflare CF-Visitor header first (highest priority)
  const cfVisitor = req.get('CF-Visitor');
  if (cfVisitor) {
    try {
      const cfData = JSON.parse(cfVisitor);
      if (cfData.scheme) {
        protocol = cfData.scheme;
      }
    } catch (e) {
      // Continue if CF-Visitor is not valid JSON
    }
  }

  // Fall back to X-Forwarded-Proto (set by reverse proxies)
  if (protocol === req.protocol) {
    const forwardedProto = req.get('X-Forwarded-Proto');
    if (forwardedProto) {
      protocol = forwardedProto.split(',')[0].trim();
    }
  }

  // Get host - check X-Forwarded-Host first (set by reverse proxy)
  const host = req.get('X-Forwarded-Host') || req.get('host');

  // Construct and return base URL
  return `${protocol}://${host}`;
}

module.exports = {
  getBaseUrl
};
