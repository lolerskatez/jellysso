/**
 * Centralized authentication middleware
 * Eliminates duplication across route files
 */

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

const requireAdmin = (req, res, next) => {
  if (req.session?.user?.Policy?.IsAdministrator) {
    return next();
  }
  
  const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
  if (isAjax) {
    return res.status(403).json({ 
      success: false, 
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required'
      }
    });
  }
  
  res.status(403).json({ message: 'Admin access required' });
};

module.exports = { requireAuth, requireAdmin };
