const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const SetupManager = require('./models/SetupManager');
const DatabaseManager = require('./models/DatabaseManager');
const MaintenanceScheduler = require('./models/MaintenanceScheduler');
const PerformanceMonitor = require('./models/PerformanceMonitor');
const SessionStore = require('./models/SessionStore');
const CacheManager = require('./models/CacheManager');
const PluginManager = require('./models/PluginManager');
const JellyfinAPI = require('./models/JellyfinAPI');
const { csrfProtection, setCsrfToken } = require('./middleware/csrf');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Trust proxy for proper IP detection and protocol handling
app.set('trust proxy', 1);

// Force HTTP by redirecting any HTTPS requests to HTTP
app.use((req, res, next) => {
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    return res.redirect(301, `http://${req.headers.host}${req.url}`);
  }
  next();
});

// Logging setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'jellysso' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  skip: (req) => {
    // Don't rate limit health checks or static files
    return req.path === '/api/health' || 
           req.path.startsWith('/css/') || 
           req.path.startsWith('/js/') || 
           req.path.startsWith('/webfonts/') ||
           req.path.startsWith('/images/');
  }
});

// Performance optimizations
app.use(require('compression')()); // Enable gzip compression
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure Helmet with proper CSP for both HTTP and HTTPS
const isProduction = process.env.NODE_ENV === 'production';
const useHttps = false; // Force HTTP even if environment variable is set

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for theme
      scriptSrc: ["'self'", 'https://static.cloudflareinsights.com'], // Allow Cloudflare Insights
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://cloudflareinsights.com'], // Allow Cloudflare Insights API calls
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      scriptSrcAttr: ["'none'"]
    },
    useDefaults: false // Disable default directives including upgrade-insecure-requests
  },
  crossOriginOpenerPolicy: false, // Disable for compatibility
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: false,
  crossOriginEmbedderPolicy: false
}));

app.use(limiter); // Rate limiting

// Initialize session store (database-backed for persistence and clustering)
const sessionStore = new SessionStore({
  expirationTime: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000 // cleanup every hour
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Force non-secure cookies
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Set CSRF token in response locals for all requests (AFTER session middleware)
app.use(setCsrfToken);

// Initialize global cache manager
global.appCache = new CacheManager({
  defaultTTL: 5 * 60 * 1000, // 5 minutes default
  maxSize: 1000
});

// Log cache events in development
if (process.env.NODE_ENV !== 'production') {
  global.appCache.on('evict', (key) => logger.debug(`Cache evicted: ${key}`));
  global.appCache.on('expired', (key) => logger.debug(`Cache expired: ${key}`));
}

// Setup check middleware - redirect to setup if not configured
app.use((req, res, next) => {
  // Skip setup check for setup routes, health check, and static files
  if (req.path.startsWith('/setup') || 
      req.path === '/api/health' || 
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      req.path.startsWith('/webfonts/') ||
      req.path.startsWith('/images/') ||
      req.path === '/favicon.svg' ||
      req.path === '/login') {
    return next();
  }

  // If setup is not complete, redirect to setup
  if (!SetupManager.isSetupComplete()) {
    return res.redirect('/setup');
  }

  next();
});

app.use(express.static(path.join(__dirname, '../public')));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Logging middleware for all requests
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
    
    // Track performance metrics
    PerformanceMonitor.recordRequest(duration, res.statusCode, req.path);
  });
  next();
});

// Initialize CSRF protection for all requests EXCEPT logout, admin APIs, and setup
// Setup routes are excluded because they run before authentication
// Logout is safe (idempotent, only affects current user)
// Admin APIs are protected by requireAdmin middleware which requires authentication
app.use((req, res, next) => {
  // Skip CSRF for setup routes (unauthenticated), logout endpoint, and admin routes (protected by auth)
  if (req.path.startsWith('/setup') ||
      (req.path === '/api/auth/logout' && req.method === 'POST') || 
      req.path.startsWith('/admin/') ||
      req.path.startsWith('/admin/api/') ||
      req.path.startsWith('/api/admin/')) {
    return next();
  }
  csrfProtection(req, res, next);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/quickconnect', require('./routes/quickconnect'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/plugin', require('./routes/plugin'));
app.use('/setup', require('./routes/setup'));

// OIDC routes - enable if you need external identity provider support
if (process.env.ENABLE_OIDC === 'true') {
  const oidc = require('./oidc');
  app.use('/oidc', oidc.callback());
  logger.info('OIDC provider enabled');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: require('../package.json').version
  });
});

// Middleware to require authentication for web routes
const requireWebAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    next();
  } else {
    // Only redirect if not already on login page
    if (req.path !== '/login') {
      return res.redirect('/login');
    }
    next();
  }
};

// Server info endpoint for user dashboard
app.get('/api/server-info', requireWebAuth, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, req.session.accessToken);

    // Get server info
    const serverInfo = await jellyfin.getSystemConfiguration();

    res.json({
      online: true,
      version: serverInfo.Version || 'Unknown',
      serverName: serverInfo.ServerName || 'Jellyfin Server'
    });
  } catch (error) {
    console.error('Server info error:', error);
    res.json({
      online: false,
      version: 'Unknown',
      serverName: 'Jellyfin Server'
    });
  }
});

// Dashboard API endpoint - returns system status and published URL
app.get('/api/dashboard', requireWebAuth, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, req.session.accessToken);

    // Get system status
    let systemStatus = 'online';
    let lastStatusCheck = new Date().toLocaleString();
    
    try {
      await jellyfin.getSystemConfiguration();
    } catch (error) {
      systemStatus = 'offline';
    }

    // Get published URL from config
    const publishedUrl = config.webAppPublicUrl || config.jellyfinUrl || 'Not configured';

    res.json({
      systemStatus,
      lastStatusCheck,
      publishedUrl
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({
      systemStatus: 'offline',
      lastStatusCheck: new Date().toLocaleString(),
      publishedUrl: 'Error loading URL'
    });
  }
});

// Basic routes (only accessible after setup)
app.get('/', requireWebAuth, (req, res) => {
  res.render('user-dashboard', { title: 'Jellyfin Companion - Dashboard', user: req.session.user });
});

app.get('/login', csrfProtection, async (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  
  // Get and clear any error message
  const errorMessage = req.session.errorMessage;
  if (req.session.errorMessage) {
    req.session.errorMessage = null;
  }

  // Check if OIDC is enabled
  let oidcEnabled = false;
  let oidcProviderName = 'SSO Login';
  try {
    let oidcConfig = await DatabaseManager.getSetting('oidc_config');
    // Handle legacy double-encoded JSON
    if (typeof oidcConfig === 'string') {
      oidcConfig = JSON.parse(oidcConfig);
    }
    if (oidcConfig && oidcConfig.enabled) {
      oidcEnabled = true;
      oidcProviderName = oidcConfig.providerName || 'SSO Login';
    }
  } catch (err) {
    console.error('OIDC config error:', err);
  }
  
  res.render('login', { csrfToken: req.csrfToken(), errorMessage, oidcEnabled, oidcProviderName });
});

app.get('/quickconnect', requireWebAuth, csrfProtection, (req, res) => {
  res.render('quickconnect', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.get('/users', requireWebAuth, (req, res) => {
  res.render('users', { user: req.session.user });
});

app.get('/settings', requireWebAuth, csrfProtection, (req, res) => {
  res.render('settings', { user: req.session.user, csrfToken: req.csrfToken() });
});

app.get('/plugin', requireWebAuth, (req, res) => {
  const config = SetupManager.getConfig();

  res.render('plugin', {
    title: 'Plugin Management',
    user: req.session.user,
    apiKey: config.apiKey,
    jellyfinUrl: config.jellyfinUrl,
    webAppUrl: config.webAppPublicUrl
  });
});

// Admin dashboard routes
app.use('/admin', require('./routes/admin'));

// System management routes (sessions, cache, plugins)
app.use('/admin', require('./routes/system'));

// Legacy redirect for cached plugin download URL
app.get('/download', (req, res) => {
  if (req.session && req.session.accessToken) {
    res.redirect('/admin/api/plugin/download');
  } else {
    res.status(401).send('Unauthorized');
  }
});

// Initialize plugin system
(async () => {
  try {
    await PluginManager.initialize();
    console.log('✅ Plugin system ready');
  } catch (error) {
    console.error('Plugin initialization failed:', error);
  }
})();

app.listen(PORT, () => {
  console.log(`JellySSO running on port ${PORT}`);
  if (!isProduction) {
    console.log(`🌐 Local access: http://localhost:${PORT}`);
    console.log(`⚠️  Running in HTTP mode (development)`);
  }
});

// Start maintenance scheduler
MaintenanceScheduler.start();