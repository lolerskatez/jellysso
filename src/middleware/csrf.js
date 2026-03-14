const csurf = require('csurf');

// Helper function to get the request URL, accounting for reverse proxies
const getRequestUrl = (req) => {
  const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'http';
  const host = req.get('X-Forwarded-Host') || req.get('Host') || req.hostname;
  return `${protocol}://${host}`;
};

// Create CSRF protection middleware
// Uses session to store the token (cookie: false means session-based)
// trustProxy: true helps with reverse proxies by trusting X-Forwarded-* headers
const csrfProtection = csurf({ 
  cookie: false,
  trustProxy: true
});

// Middleware to set CSRF token on GET requests (for forms)
const setCsrfToken = (req, res, next) => {
  try {
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : '';
  } catch (e) {
    res.locals.csrfToken = '';
  }
  next();
};

// Wrapper middleware to provide better error handling for CSRF failures
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    // Log CSRF token mismatch for debugging
    const logger = require('../utils/logger');
    logger.debug('CSRF token validation failed', {
      path: req.path,
      method: req.method,
      origin: req.get('Origin'),
      referer: req.get('Referer'),
      'x-forwarded-proto': req.get('X-Forwarded-Proto'),
      'x-forwarded-host': req.get('X-Forwarded-Host'),
      'x-forwarded-for': req.get('X-Forwarded-For'),
      hasSession: !!req.session,
      hasSessionId: !!req.sessionID
    });
    return res.status(403).json({ 
      error: 'CSRF token validation failed',
      message: 'Invalid security token. Please try again.'
    });
  }
  next(err);
};

module.exports = {
  csrfProtection,
  setCsrfToken,
  csrfErrorHandler
};
