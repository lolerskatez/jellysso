const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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

// Logging setup — shared singleton so admin routes can adjust level/transports at runtime
const logger = require('./utils/logger');

// Security configuration — dynamic rate-limit / CSRF / HTTPS controlled via DB settings
const securityConfig = require('./utils/securityConfig');

// HTTPS redirect — reads require_https from DB; applies immediately when toggled
app.use(securityConfig.getHttpsRedirectMiddleware());

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
  crossOriginOpenerPolicy: false,   // Disable for compatibility
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: false,
  originAgentCluster: false,        // Consistently opt-out; avoids "inconsistent agent cluster" warning
}));

app.use(securityConfig.getRateLimiterMiddleware()); // Dynamic rate limiting — reads rateLimitEnabled + rateLimit from DB

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

// Session idle-timeout middleware — reads sessionTimeout (minutes) from SetupManager config.
// On every authenticated request, stamps lastActivity; destroys the session and redirects
// to login if the session has been idle longer than the configured timeout.
app.use((req, res, next) => {
  // Skip for static assets, health check, setup, and unauthenticated paths
  const skipPaths = ['/api/health', '/setup', '/login', '/css/', '/js/', '/webfonts/', '/images/'];
  if (skipPaths.some(p => req.path.startsWith(p)) || !req.session?.user) {
    return next();
  }

  const config = SetupManager.getConfig();
  const timeoutMs = Math.max(5, parseInt(config.sessionTimeout) || 30) * 60 * 1000;
  const now = Date.now();
  const last = req.session.lastActivity || now;

  if (now - last > timeoutMs) {
    return req.session.destroy(() => {
      res.redirect('/login');
    });
  }

  req.session.lastActivity = now;
  next();
});

// Inject app-wide locals (appName, theme) derived from SetupManager config so all
// views and partials can reference them via locals.appName / locals.theme.
app.use((req, res, next) => {
  const config = SetupManager.getConfig();
  res.locals.appName = config.appName || 'JellySSO';
  res.locals.theme   = config.theme   || 'auto';
  next();
});

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

  // Handle favicon.ico requests
  if (req.path === '/favicon.ico') {
    return res.redirect('/favicon.svg');
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

// CSRF protection — reads csrf_protection toggle from DB; applies immediately when toggled.
// Always skipped for setup routes (unauthenticated), logout, and admin routes (protected by auth).
app.use(async (req, res, next) => {
  if (req.path.startsWith('/setup') ||
      (req.path === '/api/auth/logout' && req.method === 'POST') ||
      req.path.startsWith('/admin/') ||
      req.path.startsWith('/admin/api/') ||
      req.path.startsWith('/api/admin/')) {
    return next();
  }
  try {
    const enabled = await securityConfig.isCsrfEnabled();
    if (!enabled) return next();
  } catch (_) { /* default to enforcing on error */ }
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
    // Use session token if available, fall back to API key for system calls
    const authToken = req.session.accessToken || config.apiKey;
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, authToken);

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
    // Use session token if available, fall back to API key for system calls
    const authToken = req.session.accessToken || config.apiKey;
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, authToken);

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
  // Redirect authenticated users to admin dashboard
  if (req.session.user && req.session.user.Policy?.IsAdministrator) {
    return res.redirect('/admin/');
  }
  // Redirect non-admins to quickconnect
  res.redirect('/quickconnect');
});

app.get('/login', csrfProtection, async (req, res) => {
  // If already logged in, redirect to quickconnect
  if (req.session && req.session.user) {
    return res.redirect('/quickconnect');
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
    if (oidcConfig && oidcConfig.enabled && oidcConfig.issuerUrl && oidcConfig.clientId && oidcConfig.clientSecret) {
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
  
  // Log current configuration
  const config = SetupManager.getConfig();
  console.log('📋 Current Configuration:');
  console.log(`   Setup Complete: ${config.isSetupComplete}`);
  console.log(`   Jellyfin URL: ${config.jellyfinUrl}`);
  console.log(`   Has API Key: ${!!config.apiKey}`);
  if (config.apiKey) {
    console.log(`   API Key (first 16 chars): ${config.apiKey.substring(0, 16)}...`);
  }
  console.log(`   Config File: ${path.join(__dirname, '../src/config/setup.json')}`);
  
  if (!isProduction) {
    console.log(`🌐 Local access: http://localhost:${PORT}`);
    console.log(`⚠️  Running in HTTP mode (development)`);
  }
});

// Start maintenance scheduler
MaintenanceScheduler.start();

// Initialise security config from DB so rate-limit max is correct from the first request
DatabaseManager.getSetting('rate_limit').then(val => {
  const max = parseInt(val) || 60;
  securityConfig.reconfigureLimiter(max);
}).catch(() => { /* use default */ });