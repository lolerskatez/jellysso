const express = require('express');
const router = express.Router();

// Middleware to require authentication
const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// User Policy Settings Page
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
