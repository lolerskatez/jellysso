const express = require('express');
const router = express.Router();
const AuditLogger = require('../models/AuditLogger');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (req.session.accessToken) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Middleware to check admin access
const requireAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.Policy && req.session.user.Policy.IsAdministrator) {
    next();
  } else {
    res.status(403).json({ message: 'Admin access required' });
  }
};

// Get audit logs (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { action, userId, resource, status, limit = 100, startDate, endDate } = req.query;
    
    const options = {
      limit: Math.min(parseInt(limit) || 100, 1000) // Max 1000 entries
    };

    if (action) options.action = action;
    if (userId) options.userId = userId;
    if (resource) options.resource = resource;
    if (status) options.status = status;
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;

    const logs = await AuditLogger.getLogs(options);
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get audit log summary statistics (admin only)
router.get('/summary', requireAuth, requireAdmin, async (req, res) => {
  try {
    const allLogs = await AuditLogger.getLogs({ limit: 10000 });
    
    const summary = {
      total: allLogs.length,
      byAction: {},
      byStatus: {},
      byUserId: {},
      lastEvent: allLogs[0] || null,
      dateRange: allLogs.length > 0 ? {
        start: allLogs[allLogs.length - 1].timestamp,
        end: allLogs[0].timestamp
      } : null
    };

    allLogs.forEach(log => {
      summary.byAction[log.action] = (summary.byAction[log.action] || 0) + 1;
      summary.byStatus[log.status] = (summary.byStatus[log.status] || 0) + 1;
      summary.byUserId[log.userId] = (summary.byUserId[log.userId] || 0) + 1;
    });

    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Cleanup old audit logs (admin only)
router.post('/cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { daysToKeep = 90 } = req.body;
    await AuditLogger.cleanup(parseInt(daysToKeep));
    
    // Log the cleanup action
    await AuditLogger.log('AUDIT_CLEANUP', req.session.user?.Id, 'system:audit', 
      { daysToKeep: parseInt(daysToKeep) }, 'success', req.ip);
    
    res.json({ success: true, message: `Audit logs older than ${daysToKeep} days have been removed` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
