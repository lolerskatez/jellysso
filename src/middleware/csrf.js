const { doubleCsrf } = require('csrf-csrf');

// csrf-csrf uses the Double Submit Cookie pattern with a signed HMAC
// so it does not need the user session to store a secret.
// The signed cookie name is __Host- prefixed when served over HTTPS; we use
// a generic name here so it works on HTTP dev setups as well.
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'csrf-secret-fallback',
  cookieName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  },
  getTokenFromRequest: (req) =>
    req.headers['x-csrf-token'] ||
    req.body?._csrf ||
    req.query?._csrf
});

// Convenience alias used throughout existing route files
const csrfProtection = doubleCsrfProtection;

// Middleware to set CSRF token in response locals and as a cookie-accessible value.
// Called after session middleware on every request so views can embed it in forms/meta.
const setCsrfToken = (req, res, next) => {
  try {
    res.locals.csrfToken = generateToken(req, res);
  } catch {
    res.locals.csrfToken = '';
  }
  next();
};

// Error handler for CSRF failures
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.code === 'ERR_CSRF_INVALID' || err.message?.includes('csrf')) {
    const logger = require('../utils/logger');
    logger.debug('CSRF token validation failed', {
      path: req.path,
      method: req.method,
      origin: req.get('Origin'),
      referer: req.get('Referer')
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

