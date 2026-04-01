/**
 * Centralized authentication middleware
 * Eliminates duplication across route files
 */

const PolicyManager = require('../models/PolicyManager');
const logger = require('../utils/logger');

const requireAuth = (req, res, next) => {
  if (req.session?.accessToken) {
    return next();
  }
  
  const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
  if (isAjax) {
    return res.status(401).json({ 
      success: false, 
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
  }
  
  res.status(401).json({ message: 'Unauthorized' });
};

/**
 * requireAdmin — verifies admin status from the database on every request.
 * This prevents a revoked admin from retaining access for the lifetime of their session.
 */
const requireAdmin = async (req, res, next) => {
  const userId = req.session?.user?.Id;
  if (!userId) {
    const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
    if (isAjax) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    }
    return res.status(403).json({ message: 'Admin access required' });
  }

  try {
    const policy = await PolicyManager.getUserPolicy(userId);
    if (policy?.isAdmin) {
      return next();
    }
  } catch (err) {
    logger.error('requireAdmin policy check failed', { userId, error: err.message });
  }

  const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
  if (isAjax) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  return res.status(403).json({ message: 'Admin access required' });
};

module.exports = { requireAuth, requireAdmin };
