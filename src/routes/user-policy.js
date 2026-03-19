const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// Middleware to require authentication for web routes (redirects to login)
const requireWebAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// User Policy SettingsWeb Page
router.get('/', requireAuth, (req, res) => {
  try {
    res.render('policy', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken
    });
  } catch (error) {
    console.error('Policy page error:', error);
    res.status(500).render('error', { message: 'Error loading policy page', code: 500 });
  }
});

module.exports = router;
