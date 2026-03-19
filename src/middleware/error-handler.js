/**
 * Centralized error handling middleware
 * Standardizes error responses with correlation IDs and proper HTTP status codes
 */

const logger = require('../utils/logger');

/**
 * Standard error response format
 */
function formatErrorResponse(error, requestId, statusCode = 500) {
  const errorCode = error.code || 'INTERNAL_ERROR';
  const message = error.message || 'An unexpected error occurred';

  return {
    success: false,
    error: {
      code: errorCode,
      message: message,
      timestamp: new Date().toISOString(),
      requestId: requestId
    }
  };
}

/**
 * Map error types to HTTP status codes and error codes
 */
function getErrorStatus(error) {
  if (error.statusCode) return error.statusCode;

  if (error.message.includes('401') || error.message.includes('Unauthorized')) {
    return 401;
  }
  if (error.message.includes('403') || error.message.includes('Forbidden')) {
    return 403;
  }
  if (error.message.includes('404') || error.message.includes('not found')) {
    return 404;
  }
  if (error.message.includes('validation') || error.message.includes('invalid')) {
    return 400;
  }
  if (error.message.includes('503') || error.message.includes('unavailable')) {
    return 503;
  }

  return 500;
}

/**
 * Main error handling middleware
 * Should be registered last in the middleware chain
 */
function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';
  const statusCode = getErrorStatus(err);

  // Log the error with context
  logger.error('Request error', {
    requestId,
    statusCode,
    method: req.method,
    path: req.path,
    ip: req.ip,
    error: err.message,
    stack: err.stack
  });

  // Format and send response
  const response = formatErrorResponse(err, requestId, statusCode);
  res.status(statusCode).json(response);
}

/**
 * Async error wrapper for route handlers
 * Catches errors in async functions and passes to error handler
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Custom error class for application errors
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

module.exports = {
  errorHandler,
  asyncHandler,
  AppError,
  formatErrorResponse,
  getErrorStatus
};
