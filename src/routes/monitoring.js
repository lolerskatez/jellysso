/**
 * Monitoring and health check endpoints (Admin only)
 * Provides visibility into system health and performance
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const DatabaseRecovery = require('../models/DatabaseRecovery');
const { getInstance: getStateManager } = require('../services/StateManager');
const { getInstance: getCleanupTasks } = require('../models/ScheduledCleanupTasks');
const performanceMonitor = require('../models/PerformanceMonitor');
const logger = require('../utils/logger');

/**
 * GET /api/monitoring/health
 * Overall system health status
 */
router.get('/health', requireAuth, requireAdmin, async (req, res) => {
  try {
    const dbRecovery = DatabaseRecovery.getInstance();
    const stateManager = getStateManager();
    const cleanupTasks = getCleanupTasks();

    const dbHealth = await dbRecovery.healthCheck();
    const cacheStats = stateManager.getStats();
    const taskStatus = cleanupTasks.getTaskStatus();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      status: dbHealth ? 'healthy' : 'degraded',
      components: {
        database: {
          healthy: dbHealth,
          status: dbRecovery.getHealthStatus()
        },
        cache: {
          healthy: cacheStats.size < cacheStats.maxSize,
          stats: cacheStats
        },
        maintenance: {
          healthy: Object.keys(taskStatus).length > 0,
          tasks: taskStatus
        }
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/monitoring/database
 * Database health and statistics
 */
router.get('/database', requireAuth, requireAdmin, async (req, res) => {
  try {
    const dbRecovery = DatabaseRecovery.getInstance();
    const healthy = await dbRecovery.healthCheck();

    res.json({
      success: true,
      database: {
        healthy,
        status: dbRecovery.getHealthStatus(),
        message: healthy ? 'Database is operational' : 'Database connection issues detected'
      }
    });
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_CHECK_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/monitoring/cache
 * Cache statistics and performance
 */
router.get('/cache', requireAuth, requireAdmin, (req, res) => {
  try {
    const stateManager = getStateManager();
    const stats = stateManager.getStats();

    res.json({
      success: true,
      cache: stats,
      message: `Cache is ${stats.hitRate}% efficient`
    });
  } catch (error) {
    logger.error('Cache stats retrieval failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_STATS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/monitoring/cache/debug
 * Detailed cache contents (development only)
 */
router.get('/cache/debug', requireAuth, requireAdmin, (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DEBUG_DISABLED',
          message: 'Debug mode is disabled in production'
        }
      });
    }

    const stateManager = getStateManager();
    const debug = stateManager.debug();

    res.json({
      success: true,
      cache: debug,
      size: Object.keys(debug).length
    });
  } catch (error) {
    logger.error('Cache debug retrieval failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_DEBUG_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/monitoring/cache/clear
 * Clear cache (with optional pattern)
 */
router.post('/cache/clear', requireAuth, requireAdmin, (req, res) => {
  try {
    const { pattern } = req.body;
    const stateManager = getStateManager();

    let cleared = 0;
    if (pattern) {
      cleared = stateManager.invalidatePattern(pattern);
    } else {
      stateManager.clear();
      cleared = -1; // Indicate full clear
    }

    logger.info('Cache cleared', { pattern, cleared });

    res.json({
      success: true,
      message: cleared === -1 ? 'Cache fully cleared' : `Cleared ${cleared} cache entries`,
      cleared
    });
  } catch (error) {
    logger.error('Cache clear failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_CLEAR_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/monitoring/cache/reset-stats
 * Reset cache statistics
 */
router.post('/cache/reset-stats', requireAuth, requireAdmin, (req, res) => {
  try {
    const stateManager = getStateManager();
    stateManager.resetStats();

    logger.info('Cache statistics reset');

    res.json({
      success: true,
      message: 'Cache statistics reset'
    });
  } catch (error) {
    logger.error('Cache stats reset failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'CACHE_STATS_RESET_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/monitoring/maintenance
 * Scheduled maintenance task status
 */
router.get('/maintenance', requireAuth, requireAdmin, (req, res) => {
  try {
    const cleanupTasks = getCleanupTasks();
    const taskStatus = cleanupTasks.getTaskStatus();

    res.json({
      success: true,
      tasks: taskStatus,
      message: `${Object.keys(taskStatus).length} maintenance tasks scheduled`
    });
  } catch (error) {
    logger.error('Maintenance status retrieval failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'MAINTENANCE_STATUS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/monitoring/database/recover
 * Attempt to recover database connection
 */
router.post('/database/recover', requireAuth, requireAdmin, async (req, res) => {
  try {
    const dbRecovery = DatabaseRecovery.getInstance();
    const recovered = await dbRecovery.recover();

    logger.info('Database recovery attempted', { recovered });

    res.json({
      success: true,
      recovered,
      message: recovered ? 'Database connection recovered' : 'Failed to recover database connection'
    });
  } catch (error) {
    logger.error('Database recovery failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_RECOVERY_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/monitoring/metrics
 * Performance metrics from PerformanceMonitor singleton
 */
router.get('/metrics', requireAuth, requireAdmin, (req, res) => {
  try {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours) || 24));
    const metrics = performanceMonitor.getMetrics();
    const historical = performanceMonitor.getHistoricalMetrics(hours);

    res.json({
      success: true,
      metrics,
      historical,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Metrics retrieval failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'METRICS_FAILED', message: error.message }
    });
  }
});

module.exports = router;
