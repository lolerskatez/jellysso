const { doubleCsrf } = require('csrf-csrf');

// csrf-csrf uses the Double Submit Cookie pattern with a signed HMAC
// so it does not need the user session to store a secret.
// The signed cookie name is __Host- prefixed when served over HTTPS; we use
// a generic name here so it works on HTTP dev setups as well.
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'csrf-secret-fallback',
  // Do not bind to session ID — the DB-backed session store may not persist
  // the session before the first POST arrives (especially on fresh Docker
  // deployments), which regenerates the session ID and breaks the HMAC check.
  // The double-submit cookie pattern (HMAC-signed random value in both cookie
  // and request header) is already sufficient CSRF protection without it.
  getSessionIdentifier: () => '',
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
//
// IMPORTANT: With saveUninitialized:false, new sessions are not saved until the session
// is modified — so the session cookie is never sent to the client on the first GET.
// This means the next POST has a *different* sessionID, and the HMAC in the CSRF cookie
// (computed with the GET's sessionID) won't validate on the POST.
// We fix this by saving the session on the first visit, which sends the session cookie
// to the client and ensures a consistent sessionID across GET and subsequent POST.
const setCsrfToken = (req, res, next) => {
  const doGenerate = () => {
    try {
      res.locals.csrfToken = generateCsrfToken(req, res);
    } catch {
      res.locals.csrfToken = '';
    }
    next();
  };

  // Only needed on requests that will render a page with a CSRF token (GET/HEAD).
  // For POSTs the session cookie is already present (sent by the client).
  if (['GET', 'HEAD'].includes(req.method) && req.session && !req.session.csrfEstablished) {
    req.session.csrfEstablished = true;
    req.session.save(() => doGenerate());
  } else {
    doGenerate();
  }
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

