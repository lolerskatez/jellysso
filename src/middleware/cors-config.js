/**
 * Secure CORS configuration with origin whitelist
 */

const CONSTANTS = require('../config/constants');

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = CONSTANTS.CORS.ALLOWED_ORIGINS;
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: CONSTANTS.CORS.ALLOWED_METHODS,
  allowedHeaders: CONSTANTS.CORS.ALLOWED_HEADERS,
  credentials: CONSTANTS.CORS.CREDENTIALS,
  maxAge: CONSTANTS.CORS.MAX_AGE,
  optionsSuccessStatus: 200
};

module.exports = corsOptions;
