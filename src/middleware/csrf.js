const csurf = require('csurf');

// Create CSRF protection middleware
// Uses session to store the token (cookie: false means session-based)
const csrfProtection = csurf({ 
  cookie: false
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

module.exports = {
  csrfProtection,
  setCsrfToken
};
