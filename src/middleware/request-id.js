/**
 * Request ID middleware
 * Generates unique request IDs for tracing and correlation
 */

const crypto = require('crypto');

/**
 * Generate a unique request ID
 * Format: req_<timestamp>_<random>
 */
function generateRequestId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `req_${timestamp}_${random}`;
}

/**
 * Middleware to attach request ID to all requests
 */
function requestIdMiddleware(req, res, next) {
  req.id = generateRequestId();
  
  // Add request ID to response headers for client tracking
  res.setHeader('X-Request-ID', req.id);
  
  // Add to locals for template rendering
  res.locals.requestId = req.id;
  
  next();
}

module.exports = {
  requestIdMiddleware,
  generateRequestId
};
