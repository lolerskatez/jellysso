/**
 * Structured logging middleware
 * Integrates request ID into all log entries for request tracing
 */

const logger = require('../utils/logger');

/**
 * Middleware to add request ID to logger context
 * Wraps logger methods to automatically include request ID in all logs
 */
function structuredLoggingMiddleware(req, res, next) {
  // Store original logger methods
  const originalLog = logger.log.bind(logger);
  const originalInfo = logger.info.bind(logger);
  const originalWarn = logger.warn.bind(logger);
  const originalError = logger.error.bind(logger);
  const originalDebug = logger.debug.bind(logger);

  // Create wrapper functions that add request ID
  const createLogWrapper = (originalMethod) => {
    return (level, message, meta = {}) => {
      // Handle different call signatures
      if (typeof level === 'object') {
        // Called as logger.info({ message, ...meta })
        meta = level;
        message = meta.message || '';
      } else if (typeof message === 'object') {
        // Called as logger.info('message', { ...meta })
        meta = message;
      }

      // Add request ID to metadata
      const enrichedMeta = {
        ...meta,
        requestId: req.id
      };

      // Call original method with enriched metadata
      if (typeof level === 'object') {
        originalMethod({ ...enrichedMeta, message });
      } else {
        originalMethod(level, message, enrichedMeta);
      }
    };
  };

  // Override logger methods on the request object
  req.logger = {
    log: (level, message, meta) => originalLog(level, message, { ...meta, requestId: req.id }),
    info: (message, meta) => originalInfo(message, { ...meta, requestId: req.id }),
    warn: (message, meta) => originalWarn(message, { ...meta, requestId: req.id }),
    error: (message, meta) => originalError(message, { ...meta, requestId: req.id }),
    debug: (message, meta) => originalDebug(message, { ...meta, requestId: req.id })
  };

  // Also attach to response for logging after response is sent
  res.on('finish', () => {
    const duration = Date.now() - req._startTime;
    logger.info('HTTP Request completed', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  // Record request start time
  req._startTime = Date.now();

  next();
}

module.exports = {
  structuredLoggingMiddleware
};
