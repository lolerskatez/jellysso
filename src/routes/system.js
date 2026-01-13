const express = require('express');
const router = express.Router();
const AuditLogger = require('../models/AuditLogger');
const SessionStore = require('../models/SessionStore');
const CacheManager = require('../models/CacheManager');
const PluginManager = require('../models/PluginManager');

// Middleware: Require authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Middleware: Require admin access
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.Policy && req.session.user.Policy.IsAdministrator) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

// ===== SESSION MANAGEMENT =====

/**
 * Get session statistics
 */
router.get('/api/sessions/stats', requireAuth, requireAdmin, (req, res) => {
  try {
    // Get current session count
    if (typeof SessionStore.getStats === 'function') {
      SessionStore.getStats((err, stats) => {
        if (err) {
          return res.status(500).json({ success: false, message: err.message });
        }

        res.json({
          success: true,
          sessions: {
            total: stats.total,
            active: stats.active,
            expired: stats.expired
          },
          info: 'Sessions are now persisted in database for clustering support'
        });
      });
    } else {
      res.json({
        success: true,
        message: 'Session store active',
        type: 'Database-backed SessionStore'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Clear expired sessions manually
 */
router.post('/api/sessions/cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await SessionStore.cleanup();
    
    await AuditLogger.log({
      action: 'SESSION_CLEANUP',
      userId: req.session.user?.Id,
      resource: `Removed ${count} expired sessions`,
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Cleaned up ${count} expired sessions`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ===== CACHE MANAGEMENT =====

/**
 * Get cache statistics
 */
router.get('/api/cache/stats', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = global.appCache.getStats();
    
    res.json({
      success: true,
      cache: stats
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get cache contents (debug mode)
 */
router.get('/api/cache/debug', requireAuth, requireAdmin, (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ success: false, message: 'Debug mode disabled in production' });
    }

    const debug = global.appCache.debug();
    
    res.json({
      success: true,
      cache: debug,
      size: Object.keys(debug).length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Clear cache
 */
router.post('/api/cache/clear', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pattern = req.body.pattern; // Optional: clear by pattern
    let cleared = 0;

    if (pattern) {
      cleared = global.appCache.invalidatePattern(pattern);
    } else {
      global.appCache.clear();
      cleared = -1; // Indicate full clear
    }

    await AuditLogger.log({
      action: 'CACHE_CLEARED',
      userId: req.session.user?.Id,
      resource: pattern ? `Pattern: ${pattern}` : 'Full cache',
      details: { pattern, cleared },
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      message: cleared === -1 ? 'Cache fully cleared' : `Cleared ${cleared} cache entries`,
      cleared
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Reset cache statistics
 */
router.post('/api/cache/reset-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    global.appCache.resetStats();

    await AuditLogger.log({
      action: 'CACHE_STATS_RESET',
      userId: req.session.user?.Id,
      resource: 'Cache statistics',
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Cache statistics reset'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ===== PLUGIN MANAGEMENT =====

/**
 * Get plugin list
 */
router.get('/api/plugins', requireAuth, requireAdmin, (req, res) => {
  try {
    const stats = PluginManager.getStats();
    
    res.json({
      success: true,
      plugins: stats.plugins,
      summary: {
        total: stats.pluginsLoaded,
        hooks: stats.hooksRegistered,
        middleware: stats.middlewareCount
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Get hooks information
 */
router.get('/api/plugins/hooks', requireAuth, requireAdmin, (req, res) => {
  try {
    const hooks = PluginManager.getHooks();
    
    res.json({
      success: true,
      hooks,
      totalHooks: Object.keys(hooks).length
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Reload plugins
 */
router.post('/api/plugins/reload', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Clear existing plugins (in production, unload gracefully)
    const pluginList = PluginManager.getPlugins();
    
    for (const plugin of pluginList) {
      try {
        await PluginManager.unloadPlugin(plugin.name);
      } catch (error) {
        console.warn(`Failed to unload ${plugin.name}:`, error.message);
      }
    }

    // Rediscover and load
    await PluginManager.discoverPlugins();

    await AuditLogger.log({
      action: 'PLUGINS_RELOADED',
      userId: req.session.user?.Id,
      resource: 'Plugin system',
      details: { pluginsLoaded: PluginManager.getStats().pluginsLoaded },
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Plugins reloaded',
      plugins: PluginManager.getStats().plugins
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Unload specific plugin
 */
router.post('/api/plugins/:name/unload', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name } = req.params;
    await PluginManager.unloadPlugin(name);

    await AuditLogger.log({
      action: 'PLUGIN_UNLOADED',
      userId: req.session.user?.Id,
      resource: name,
      status: 'success',
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Plugin ${name} unloaded`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
