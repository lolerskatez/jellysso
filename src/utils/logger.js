/**
 * Shared Winston logger instance with structured logging support.
 * Exported as a singleton so admin routes can adjust level / transports at runtime.
 * Supports request ID integration for request tracing.
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOGS_DIR = path.join(__dirname, '../../logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Custom format for structured logging with request ID support
 */
const structuredFormat = winston.format.printf(({ level, message, timestamp, requestId, ...meta }) => {
  const logObject = {
    timestamp,
    level,
    message,
    ...(requestId && { requestId }),
    ...meta
  };
  return JSON.stringify(logObject);
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    structuredFormat
  ),
  defaultMeta: { service: 'jellysso' },
  transports: [
    new winston.transports.File({ filename: path.join(LOGS_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOGS_DIR, 'combined.log') }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, timestamp, requestId, ...meta }) => {
        const requestIdStr = requestId ? ` [${requestId}]` : '';
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}${requestIdStr}: ${message}${metaStr}`;
      })
    ),
  }));
}

/**
 * Dynamically change the log level at runtime.
 * @param {string} level - 'error' | 'warn' | 'info' | 'debug'
 */
logger.setLevel = function setLevel(level) {
  const valid = ['error', 'warn', 'info', 'debug'];
  if (!valid.includes(level)) return;
  this.level = level;
  // Also update all transports so they respect the new minimum level
  this.transports.forEach(t => {
    if (!(t instanceof winston.transports.File && t.level === 'error')) {
      t.level = level;
    }
  });
};

/**
 * Enable or disable file transports (error.log + combined.log).
 * @param {boolean} enabled
 */
logger.setFileLogging = function setFileLogging(enabled) {
  // Remove all current file transports
  const fileTransports = this.transports.filter(t => t instanceof winston.transports.File);
  fileTransports.forEach(t => this.remove(t));

  if (enabled) {
    this.add(new winston.transports.File({ filename: path.join(LOGS_DIR, 'error.log'), level: 'error' }));
    this.add(new winston.transports.File({ filename: path.join(LOGS_DIR, 'combined.log'), level: this.level }));
  }
};

/**
 * Delete rotated/old log files from the logs directory that are older than retentionDays.
 * The active error.log and combined.log are skipped since they're open by the logger.
 * @param {number} retentionDays
 * @returns {number} Number of files removed
 */
logger.cleanupOldLogs = function cleanupOldLogs(retentionDays) {
  const activeFiles = new Set(['error.log', 'combined.log']);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  try {
    const files = fs.readdirSync(LOGS_DIR);
    for (const file of files) {
      if (activeFiles.has(file)) continue; // never delete the currently open files
      if (!file.endsWith('.log') && !file.match(/\.(log\.\d+|log\.\d{4}-\d{2}-\d{2})$/)) continue;
      const filePath = path.join(LOGS_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removed++;
        }
      } catch (_) { /* skip files we can't stat/delete */ }
    }
  } catch (e) {
    console.error('Log cleanup error:', e.message);
  }

  return removed;
};

module.exports = logger;
