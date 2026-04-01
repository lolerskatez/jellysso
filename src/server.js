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
const PolicyManager = require('./models/PolicyManager');
const OTPManager   = require('./models/OTPManager');
const JellyfinAPI = require('./models/JellyfinAPI');
const cookieParser = require('cookie-parser');
const { csrfProtection, setCsrfToken, csrfErrorHandler } = require('./middleware/csrf');
const { requestIdMiddleware } = require('./middleware/request-id');
const { errorHandler, asyncHandler, AppError } = require('./middleware/error-handler');
const { criticalLimiter, adminLimiter, apiLimiter, publicLimiter } = require('./middleware/rate-limit');
const { sanitizationMiddleware } = require('./utils/sanitizer');
const SessionTimeoutManager = require('./utils/sessionTimeoutManager');
const { AccountLockoutManager } = require('./models/AccountLockoutManager');
const CONSTANTS = require('./config/constants');
const crypto = require('crypto');
require('dotenv').config();
const logger = require('./utils/logger');

// Auto-generate secrets if missing
function ensureSecrets() {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  let needsUpdate = false;
  
  // Read existing .env if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }
  
  const envLines = envContent.split('\n').filter(line => line.trim());
  const secrets = {};
  
  // Parse existing secrets
  envLines.forEach(line => {
    const [key, value] = line.split('=');
    if (key) secrets[key.trim()] = value?.trim() || '';
  });
  
  // Generate JWT_SECRET if missing or default
  if (!secrets.JWT_SECRET || secrets.JWT_SECRET === 'default-jwt-secret') {
    secrets.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    needsUpdate = true;
    logger.info('✅ Generated new JWT_SECRET');
  }
  
  // Generate SESSION_SECRET if missing or default
  if (!secrets.SESSION_SECRET || secrets.SESSION_SECRET === 'default-secret') {
    secrets.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
    needsUpdate = true;
    logger.info('✅ Generated new SESSION_SECRET');
  }

  // Generate COOKIE_SECRET if missing or default (used by OIDC provider)
  if (!secrets.COOKIE_SECRET || secrets.COOKIE_SECRET === 'some-secret-key') {
    secrets.COOKIE_SECRET = crypto.randomBytes(32).toString('hex');
    needsUpdate = true;
    logger.info('✅ Generated new COOKIE_SECRET');
  }

  // Generate OIDC_CLIENT_SECRET if missing or default
  if (!secrets.OIDC_CLIENT_SECRET || secrets.OIDC_CLIENT_SECRET === 'companion-secret') {
    secrets.OIDC_CLIENT_SECRET = crypto.randomBytes(32).toString('hex');
    needsUpdate = true;
    logger.info('✅ Generated new OIDC_CLIENT_SECRET');
  }

  // Write back to .env if any secrets were generated
  if (needsUpdate) {
    const newEnvContent = Object.entries(secrets)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + 
      (envLines.length > 0 && !Object.keys(secrets).includes('NODE_ENV') ? '\nNODE_ENV=development' : '');
    
    fs.writeFileSync(envPath, newEnvContent);
    logger.info('💾 Saved secrets to .env');
    
    // Reload dotenv to use the new values
    require('dotenv').config({ override: true });
  }
}

// Ensure secrets exist before any other initialization
ensureSecrets();

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// Trust proxy for proper IP detection and protocol handling
app.set('trust proxy', 1);

// Security configuration — dynamic rate-limit / CSRF / HTTPS controlled via DB settings
const securityConfig = require('./utils/securityConfig');

// HTTPS redirect — reads require_https from DB; applies immediately when toggled
app.use(securityConfig.getHttpsRedirectMiddleware());

// Performance optimizations
app.use(require('compression')()); // Enable gzip compression
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure Helmet with strict CSP (no unsafe-inline)
const isProduction = process.env.NODE_ENV === 'production';
const useHttps = isProduction || process.env.USE_HTTPS === 'true';

// Generate nonce for inline styles/scripts (more secure than unsafe-inline)
const generateNonce = () => require('crypto').randomBytes(16).toString('hex');

app.use((req, res, next) => {
  res.locals.nonce = generateNonce();
  next();
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Styles: allow unsafe-inline for dynamic JS style assignments
      styleSrc: ["'self'", "'unsafe-inline'"],
      // Scripts: nonce-based allowlist — no unsafe-inline for script blocks or inline event handlers
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, 'https://static.cloudflareinsights.com'],
      scriptSrcAttr: ["'none'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://cloudflareinsights.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    },
    useDefaults: false
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
  originAgentCluster: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    geolocation: [],
    microphone: [],
    camera: [],
    payment: [],
    usb: [],
    magnetometer: [],
    gyroscope: [],
    accelerometer: []
  }
}));

// Fail fast if SESSION_SECRET is missing (in all environments — ensureSecrets() should have generated it)
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'default-secret') {
  logger.error('❌ SESSION_SECRET is not set or is still the insecure default.');
  logger.error('   Delete your .env file and restart to auto-generate secrets, or set SESSION_SECRET manually.');
  process.exit(1);
}

// Parse cookies — required by csrf-csrf to read the CSRF cookie
app.use(cookieParser());

// Initialize session store (database-backed for persistence and clustering)
const sessionStore = new SessionStore({
  expirationTime: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000 // cleanup every hour
});

// Initialize session timeout manager for server-side timeout enforcement
const sessionTimeoutManager = new SessionTimeoutManager(sessionStore);

// Session configuration for reverse proxy scenarios (cloudflared, nginx, etc.)
// NOTE: Even though we're behind HTTPS via cloudflared, cloudflared may not forward
// X-Forwarded-Proto correctly. Setting secure: false is safe because TLS is terminated
// at cloudflared - the user's connection is still secure.
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true, // Trust the reverse proxy
  cookie: {
    secure: isProduction, // true in production (behind cloudflared/nginx with HTTPS)
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Request ID middleware - attach unique ID to all requests for tracing
app.use(requestIdMiddleware);

// Input sanitization middleware - prevent XSS attacks
app.use(sanitizationMiddleware());

// Dynamic rate limiting — must come AFTER session middleware so req.session.user is set
// and authenticated users can be excluded from the global limit.
app.use(securityConfig.getRateLimiterMiddleware());

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

// Initialize database indexes for performance
try {
  const DatabaseIndexes = require('./models/DatabaseIndexes');
  DatabaseIndexes.initializeIndexes().catch(err => {
    logger.warn('Could not initialize database indexes', { error: err.message });
  });
} catch (err) {
  logger.warn('DatabaseIndexes module not available', { error: err.message });
}

// Initialize scheduled cleanup tasks
try {
  const { getInstance: getCleanupTasks } = require('./models/ScheduledCleanupTasks');
  const cleanupTasks = getCleanupTasks();
  cleanupTasks.initializeTasks();
  logger.info('Scheduled cleanup tasks initialized');
} catch (err) {
  logger.warn('Could not initialize cleanup tasks', { error: err.message });
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
// Uses the Double Submit Cookie pattern (csrf-csrf) — no session dependency.
// Skipped for: setup routes, public signup, logout, and GET/HEAD/OPTIONS requests
// (which are safe methods per RFC 7231 and don't mutate state).
// NOTE: Admin routes are now INCLUDED — the previous blanket /api/admin/* bypass
// has been removed to protect all state-changing admin endpoints.
app.use(async (req, res, next) => {
  // Safe HTTP methods never need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Always skip CSRF for these paths
  if (req.path.startsWith('/setup') ||
      (req.path === '/api/auth/logout' && req.method === 'POST') ||
      (req.path === '/api/auth/signup' && req.method === 'POST')) {
    return next();
  }

  try {
    const enabled = await securityConfig.isCsrfEnabled();
    if (!enabled) return next();
  } catch (_) { /* enforce on error */ }

  csrfProtection(req, res, (err) => {
    if (err) {
      logger.debug('CSRF token validation failed', {
        path: req.path,
        method: req.method,
        origin: req.get('Origin'),
        referer: req.get('Referer')
      });
      return res.status(403).json({
        error: 'CSRF token validation failed',
        message: 'Invalid security token. Please try again.'
      });
    }
    next();
  });
});

// CSRF token endpoint - allows SPA/API clients to fetch a fresh CSRF token
app.get('/api/csrf-token', (req, res) => {
  // The token is already embedded in res.locals.csrfToken by the setCsrfToken middleware.
  // Re-reading it here ensures the response is always current.
  const token = res.locals.csrfToken || '';
  res.json({
    csrf_token: token,
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users/expiry', require('./routes/user-expiry')); // User expiry management (must come before /api/users)
app.use('/api/users', require('./routes/users'));
app.use('/api/users', require('./routes/bulk-operations')); // Bulk user operations
app.use('/api/settings', require('./routes/settings'));
app.use('/api/quickconnect', require('./routes/quickconnect'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/plugin', require('./routes/plugin'));
app.use('/api/playback', require('./routes/playback'));
app.use('/api/admin/playback', require('./routes/admin-playback'));
app.use('/api/policy', require('./routes/policy'));
app.use('/api/me', require('./routes/me'));
app.use('/api/monitoring', require('./routes/monitoring'));
app.use('/api/announcements', require('./routes/announcements')); // Admin announcements
app.use('/api/invites', require('./routes/invites')); // User invites
app.use('/api/admin/templates', require('./routes/admin-templates')); // Message template CRUD
app.use('/api/signup-profiles', require('./routes/signup-profiles')); // Signup profiles
app.use('/api/contact-methods', require('./routes/contact-methods')); // Multi-channel contact methods
app.use('/api/user', require('./routes/user-account')); // User account info and status
app.use('/api/labels', require('./routes/labels')); // User labels and tagging system
app.use('/policy', require('./routes/user-policy'));
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
    logger.error('Server info error:', error);
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
    logger.error('Dashboard API error:', error);
    res.status(500).json({
      systemStatus: 'offline',
      lastStatusCheck: new Date().toLocaleString(),
      publishedUrl: 'Error loading URL'
    });
  }
});

// Basic routes (only accessible after setup)
app.get('/', requireWebAuth, (req, res) => {
  // All authenticated users go to quickconnect
  // Admins can access /admin/ separately if needed
  res.redirect('/quickconnect');
});

app.get('/login', async (req, res) => {
  // If already logged in, redirect to quickconnect
  if (req.session && req.session.user) {
    return res.redirect('/quickconnect');
  }
  
  // Debug logging for session/CSRF on login page
  const csrfToken = res.locals.csrfToken || '';
  logger.info('📄 Login page rendered:', {
    sessionID: req.sessionID ? req.sessionID.substring(0, 10) + '...' : 'none',
    hasCsrfSecret: !!(req.session?.csrfSecret),
    csrfTokenGenerated: csrfToken ? csrfToken.substring(0, 20) + '...' : 'FAILED',
    'x-forwarded-proto': req.get('X-Forwarded-Proto') || 'not set',
    secure: req.secure,
    protocol: req.protocol
  });
  
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
    logger.error('OIDC config error:', err);
  }
  
  res.render('login', { csrfToken, errorMessage, oidcEnabled, oidcProviderName });
});

app.get('/auth/reset-password', async (req, res) => {
  // If already logged in, redirect to quickconnect
  if (req.session && req.session.user) {
    return res.redirect('/quickconnect');
  }

  const { token } = req.query;
  
  if (!token) {
    return res.render('reset-password', { 
      appName: SetupManager.getConfig().appName || 'JellySSO',
      token: null,
      tokenInvalid: true
    });
  }

  res.render('reset-password', { 
    appName: SetupManager.getConfig().appName || 'JellySSO',
    token: token
  });
});

app.get('/signup', async (req, res) => {
  // If already logged in, redirect to quickconnect
  if (req.session && req.session.user) {
    return res.redirect('/quickconnect');
  }

  // Read CAPTCHA settings from DB (non-blocking; fall back to disabled on error)
  let captchaEnabled = false;
  let captchaProvider = 'hcaptcha';
  let captchaSiteKey = '';
  try {
    const DatabaseManager = require('./models/DatabaseManager');
    const [enabledVal, providerVal, siteKeyVal] = await Promise.all([
      DatabaseManager.getSetting('captcha_enabled'),
      DatabaseManager.getSetting('captcha_provider'),
      DatabaseManager.getSetting('captcha_site_key')
    ]);
    captchaEnabled = enabledVal === 'true' && !!siteKeyVal;
    captchaProvider = providerVal || 'hcaptcha';
    captchaSiteKey = siteKeyVal || '';
  } catch (_) { /* ignore — CAPTCHA disabled */ }

  // Render signup page with public invite validation
  res.render('signup', {
    appName: SetupManager.getConfig().appName || 'JellySSO',
    captchaEnabled,
    captchaProvider,
    captchaSiteKey
  });
});

app.get('/quickconnect', requireWebAuth, csrfProtection, (req, res) => {
  res.render('quickconnect', { user: req.session.user, csrfToken: res.locals.csrfToken });
});

app.get('/users', requireWebAuth, (req, res) => {
  res.render('users', { user: req.session.user });
});

app.get('/settings', requireWebAuth, csrfProtection, (req, res) => {
  res.render('settings', { user: req.session.user, csrfToken: res.locals.csrfToken });
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

app.get('/playback', requireWebAuth, csrfProtection, (req, res) => {
  res.render('playback', { user: req.session.user, csrfToken: res.locals.csrfToken, currentPage: 'playback' });
});

app.get('/account', requireWebAuth, csrfProtection, async (req, res) => {
  try {
    const DatabaseManager = require('./models/DatabaseManager');
    const PolicyManager = require('./models/PolicyManager');
    const [renewalEnabledRaw, renewalWindowDaysRaw, policy] = await Promise.all([
      DatabaseManager.getSetting('renewal_enabled').catch(() => null),
      DatabaseManager.getSetting('renewal_window_days').catch(() => null),
      PolicyManager.getUserPolicy(req.session.user.Id).catch(() => null)
    ]);
    res.render('account', { 
      user: req.session.user, 
      csrfToken: res.locals.csrfToken,
      currentPage: 'account',
      renewalEnabled: renewalEnabledRaw === 'true',
      renewalWindowDays: parseInt(renewalWindowDaysRaw) || 30,
      policy,
      isOidc: req.session.authMethod === 'oidc'
    });
  } catch (err) {
    logger.error('Account page error:', err);
    res.status(500).render('error', { 
      message: 'Account page error',
      details: err.message 
    });
  }
});

// /membership is consolidated into the My Account page
app.get('/membership', requireWebAuth, (req, res) => {
  res.redirect('/account#membership');
});

// User-facing announcements page
app.get('/announcements', requireWebAuth, csrfProtection, (req, res) => {
  res.render('announcements', {
    user: req.session.user,
    csrfToken: res.locals.csrfToken,
    nonce: res.locals.nonce
  });
});

app.get('/admin/playback-sessions', requireWebAuth, csrfProtection, (req, res) => {
  // Verify user is admin
  if (!req.session.user?.Policy?.IsAdministrator) {
    return res.status(403).render('error', { 
      message: 'Admin access required',
      details: 'You must be an administrator to access playback administration.'
    });
  }
  res.render('admin-playback-sessions', { user: req.session.user, csrfToken: res.locals.csrfToken, currentPage: 'admin-playback-sessions' });
});

// Admin API routes for new feature management
app.use('/admin/api/api-keys',       require('./routes/admin-api-keys'));
app.use('/admin/api/lockouts',       require('./routes/admin-lockouts'));
app.use('/admin/api/security-alerts', require('./routes/admin-security-alerts'));
app.use('/admin/api/webhooks',       require('./routes/admin-webhooks'));

// Admin dashboard routes
app.use('/admin', require('./routes/admin'));

// Notification management API (admin only)
app.use('/api/admin/notifications', require('./routes/admin-notifications'));

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

// CSRF error handler middleware - catches CSRF token validation failures
// This is especially important when behind reverse proxies like cloudflare/cloudflared
app.use(csrfErrorHandler);

// Global error handler middleware - must be last
// Catches all errors and returns standardized error responses
app.use(errorHandler);

// Initialize plugin system
(async () => {
  try {
    // Initialize policy system
    await PolicyManager.initializeSchema();
    logger.info('✅ Policy system initialized');

    // Migrate existing admin users from Jellyfin if setup is complete
    const SetupManager = require('./models/SetupManager');
    if (SetupManager.isSetupComplete()) {
      try {
        const config = SetupManager.getConfig();
        const JellyfinAPI = require('./models/JellyfinAPI');
        const jellyfinApi = new JellyfinAPI(config.jellyfinUrl, config.apiKey);
        const migrationResult = await PolicyManager.migrateAdminUsersFromJellyfin(jellyfinApi);
        if (migrationResult.success) {
          logger.info(`✅ Admin user migration: ${migrationResult.migratedCount} users synced`);
        }
      } catch (err) {
        logger.warn('⚠️  Could not migrate admin users from Jellyfin:', err.message);
      }
    }

    // Initialize OTP system
    await OTPManager.initializeSchema();
    logger.info('✅ OTP system initialized');

    // Initialize Phase 2 invite system managers
    const InviteManager = require('./models/InviteManager');
    const SignupProfileManager = require('./models/SignupProfileManager');
    const UserExpiryManager = require('./models/UserExpiryManager');
    
    InviteManager.getInstance();
    logger.info('✅ Invite system initialized');
    
    SignupProfileManager.getInstance();
    logger.info('✅ Signup profiles ready');
    
    UserExpiryManager.getInstance();
    logger.info('✅ User expiry daemon started');

    await PluginManager.initialize();
    logger.info('✅ Plugin system ready');
  } catch (error) {
    logger.error('Initialization failed:', error);
  }
})();

app.listen(PORT, () => {
  logger.info(`JellySSO running on port ${PORT}`);
  
  // Log current configuration
  const config = SetupManager.getConfig();
  logger.info('📋 Current Configuration:');
  logger.info(`   Setup Complete: ${config.isSetupComplete}`);
  logger.info(`   Jellyfin URL: ${config.jellyfinUrl}`);
  logger.info(`   Has API Key: ${!!config.apiKey}`);
  if (config.apiKey) {
    logger.info(`   API Key (first 16 chars): ${config.apiKey.substring(0, 16)}...`);
  }
  logger.info(`   Config File: ${path.join(__dirname, '../src/config/setup.json')}`);
  
  if (!isProduction) {
    logger.info(`🌐 Local access: http://localhost:${PORT}`);
    logger.info(`⚠️  Running in HTTP mode (development)`);
  }
});

// Start maintenance scheduler
MaintenanceScheduler.start();

// Start Jellyfin PIN-file watcher (for ForgotPassword flow from Jellyfin login screen)
require('./services/JellyfinPinWatcher').start().catch(err =>
  logger.warn('JellyfinPinWatcher failed to start:', err.message)
);

// Start session enforcement service (stops streams exceeding tier limits)
require('./services/SessionEnforcementService').start().catch(err =>
  logger.warn('SessionEnforcementService failed to start:', err.message)
);

// Initialise security config from DB so rate-limit max is correct from the first request
DatabaseManager.getSetting('rate_limit').then(val => {
  const max = parseInt(val) || 60;
  securityConfig.reconfigureLimiter(max);
}).catch(() => { /* use default */ });

module.exports = app;