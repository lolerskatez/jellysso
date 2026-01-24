const express = require('express');
const router = express.Router();
const AuditLogger = require('../models/AuditLogger');
const DatabaseManager = require('../models/DatabaseManager');
const JellyfinAPI = require('../models/JellyfinAPI');
const SetupManager = require('../models/SetupManager');
const PerformanceMonitor = require('../models/PerformanceMonitor');
const AnalyticsManager = require('../models/AnalyticsManager');
const fs = require('fs').promises;
const path = require('path');
const { getBaseUrl } = require('../utils/urlHelper');

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
    // Return JSON for API requests, HTML for page requests
    if (req.path.includes('/api/')) {
      res.status(403).json({ success: false, message: 'Admin access required' });
    } else {
      res.status(403).render('error', { message: 'Admin access required', code: 403 });
    }
  }
};

// Dashboard home page - unified admin dashboard
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await DatabaseManager.getAuditStats();
    const recentLogs = await AuditLogger.getLogs({ limit: 10 });
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const users = await jellyfin.getUsers();
    
    // Create user map for username enrichment
    const userMap = {};
    users.forEach(u => {
      userMap[u.Id] = u.Name;
      userMap[u.Name] = u.Name;
    });

    // Enrich logs with usernames
    const enrichedLogs = recentLogs.map(log => ({
      ...log,
      username: userMap[log.userId] || log.userId || 'System'
    }));

    // Get backup info
    let backupCount = 0;
    let latestBackup = null;
    try {
      const fs = require('fs');
      const path = require('path');
      const backupDir = path.join(process.cwd(), 'backups');
      if (fs.existsSync(backupDir)) {
        const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
        backupCount = files.length;
        if (files.length > 0) {
          const sorted = files.map(f => ({
            name: f,
            time: fs.statSync(path.join(backupDir, f)).mtime
          })).sort((a, b) => b.time - a.time);
          latestBackup = sorted[0]?.time;
        }
      }
    } catch (e) {
      console.warn('Could not get backup info:', e.message);
    }
    
    res.render('admin/dashboard', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      stats: stats,
      recentLogs: enrichedLogs,
      userCount: users.length,
      backupCount: backupCount,
      latestBackup: latestBackup,
      dbFile: 'src/config/companion.db'
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).render('error', { message: 'Dashboard error', code: 500 });
  }
});

// Keep /dashboard for backward compatibility - redirect to root
router.get('/dashboard', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin/');
});

// Audit log viewer page
router.get('/audit-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { action, userId, status, limit = 25, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const options = {
      action: action || undefined,
      userId: userId || undefined,
      status: status || undefined,
      limit: Math.min(parseInt(limit), 500)
    };
    
    const logs = await AuditLogger.getLogs(options);
    const totalLogs = logs.length;
    const paginatedLogs = logs.slice(offset, offset + parseInt(limit));
    
    // Count success/failure stats
    const successCount = logs.filter(l => l.status === 'success').length;
    const failureCount = logs.filter(l => l.status === 'failure').length;
    
    // Enrich logs with usernames from Jellyfin
    let enrichedLogs = paginatedLogs;
    try {
      const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
      const jellyfinUsers = await jellyfin.getUsers();
      
      // Create a map of userId to username
      const userMap = {};
      jellyfinUsers.forEach(u => {
        userMap[u.Id] = u.Name;
        userMap[u.Name] = u.Name; // Also map by name in case userId is already a name
      });

      // Enrich logs with usernames
      enrichedLogs = paginatedLogs.map(log => ({
        ...log,
        username: userMap[log.userId] || log.userId || 'System'
      }));
    } catch (enrichError) {
      console.warn('Could not enrich audit logs with usernames:', enrichError.message);
      // Fallback: use userId as username
      enrichedLogs = paginatedLogs.map(log => ({
        ...log,
        username: log.userId || 'System'
      }));
    }
    
    res.render('admin/audit-logs', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      logs: enrichedLogs,
      totalLogs: totalLogs,
      successCount: successCount,
      failureCount: failureCount,
      currentPage: parseInt(page),
      pageSize: parseInt(limit),
      filters: { action, userId, status, limit: limit.toString() },
      pages: Math.ceil(totalLogs / parseInt(limit))
    });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).render('error', { message: 'Error loading audit logs', code: 500 });
  }
});

// User management page
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const users = await jellyfin.getUsers();
    
    res.render('admin/users', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      users: users,
      totalUsers: users.length
    });
  } catch (error) {
    console.error('Users page error:', error);
    res.status(500).render('error', { message: 'Error loading users', code: 500 });
  }
});

// Create single user API
router.post('/api/users/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username) {
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    
    // Check if user already exists
    const existingUsers = await jellyfin.getUsers();
    const exists = existingUsers.some(u => u.Name.toLowerCase() === username.toLowerCase());
    
    if (exists) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create user
    const newUser = await jellyfin.createUser({
      Name: username,
      Password: password || ''
    });

    // Log the action
    await AuditLogger.log({
      action: 'USER_CREATED',
      userId: req.session.user?.Name || 'admin',
      resource: username,
      details: { userId: newUser.Id },
      status: 'success'
    });

    res.json({ 
      success: true, 
      message: `User "${username}" created successfully`,
      user: newUser
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create user' });
  }
});

// Update user API
router.put('/api/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, password } = req.body;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    
    // Update user name if provided
    if (username) {
      await jellyfin.updateUser(userId, { Name: username });
    }
    
    // Update password if provided
    if (password) {
      await jellyfin.client.post(`/Users/${userId}/Password`, {
        CurrentPw: '',
        NewPw: password,
        ResetPassword: true
      });
    }

    // Log the action
    await AuditLogger.log({
      action: 'USER_UPDATED',
      userId: req.session.user?.Name || 'admin',
      resource: username || userId,
      details: { userId, updatedFields: { username: !!username, password: !!password } },
      status: 'success'
    });

    res.json({ 
      success: true, 
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update user' });
  }
});

// Get single user API
router.get('/api/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const users = await jellyfin.getUsers();
    const user = users.find(u => u.Id === userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete user API
router.delete('/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    
    // Verify user exists before deletion
    const users = await jellyfin.getUsers();
    const userExists = users.find(u => u.Id === userId);
    
    if (!userExists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Delete the user
    await jellyfin.deleteUser(userId);
    
    // Log the action
    await AuditLogger.log({
      action: 'USER_DELETED',
      userId: req.session.user?.Id,
      resource: userId,
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', {
      userId: req.params.userId,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    // Return more detailed error information
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.message || 'Failed to delete user';
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      details: error.response?.data
    });
  }
});

// Delete user API (alternative path for backward compatibility)
router.delete('/api/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }
    
    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    
    // Verify user exists before deletion
    const users = await jellyfin.getUsers();
    const userExists = users.find(u => u.Id === userId);
    
    if (!userExists) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Delete the user
    await jellyfin.deleteUser(userId);
    
    // Log the action
    await AuditLogger.log({
      action: 'USER_DELETED',
      userId: req.session.user?.Id,
      resource: userId,
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', {
      userId: req.params.userId,
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    // Return more detailed error information
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.message || 'Failed to delete user';
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      details: error.response?.data
    });
  }
});

// Get extended user profile API
router.get('/api/users/:userId/profile', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const UserProfileManager = require('../models/UserProfileManager');
    const profile = await UserProfileManager.getProfile(userId);
    res.json({ success: true, profile: profile || {} });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update extended user profile API
router.put('/api/users/:userId/profile', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, email, displayName } = req.body;
    const UserProfileManager = require('../models/UserProfileManager');
    
    const result = await UserProfileManager.upsertProfile(userId, {
      firstName,
      lastName,
      email,
      displayName
    });

    // Log the action
    await AuditLogger.log({
      action: 'USER_PROFILE_UPDATED',
      userId: req.session.user?.Name || 'admin',
      resource: userId,
      details: { firstName, lastName, email, displayName },
      status: 'success'
    });

    res.json({ 
      success: true, 
      message: 'Profile updated successfully',
      result
    });
  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// System statistics page
router.get('/statistics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const PerformanceMonitor = require('../models/PerformanceMonitor');
    const stats = await DatabaseManager.getAuditStats();
    const allLogs = await AuditLogger.getLogs({ limit: 10000 });
    const performanceMetrics = await PerformanceMonitor.getMetrics();
    
    // Calculate statistics
    const actionCounts = {};
    const userCounts = {};
    const statusCounts = { success: 0, failure: 0 };
    const dailyCounts = {};
    
    allLogs.forEach(log => {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
      userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
      statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
      
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      dailyCounts[date] = (dailyCounts[date] || 0) + 1;
    });
    
    res.render('admin/statistics', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      stats: Object.assign({}, stats, {
        uptime: performanceMetrics.uptime,
        avgResponseTime: performanceMetrics.avgResponseTime,
        dbSize: performanceMetrics.dbSize,
        errorRate: performanceMetrics.errorRate,
        requestsPerHour: performanceMetrics.requestsPerHour,
        heapUsed: Math.round(performanceMetrics.memory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(performanceMetrics.memory.heapTotal / 1024 / 1024)
      }),
      actionCounts: actionCounts,
      userCounts: userCounts,
      statusCounts: statusCounts,
      dailyCounts: dailyCounts,
      topActions: Object.entries(actionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      topUsers: Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    });
  } catch (error) {
    console.error('Statistics error:', error);
    res.status(500).render('error', { message: 'Error loading statistics', code: 500 });
  }
});

// Settings management page
router.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await DatabaseManager.getAllSettings();
    const jellyfinConfig = SetupManager.getConfig();
    
    // Get maintenance settings
    const maintenanceSettings = {
      dailyHour: settings.maintenance_daily_hour || 2,
      weeklyDay: settings.maintenance_weekly_day || 0,
      weeklyHour: settings.maintenance_weekly_hour || 3,
      monthlyDay: settings.maintenance_monthly_day || 1,
      monthlyHour: settings.maintenance_monthly_hour || 4,
      backupRetention: settings.backup_retention || 12,
      cleanupThreshold: settings.cleanup_threshold || 90
    };
    
    res.render('admin/settings', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      settings: Object.assign({}, settings, maintenanceSettings),
      appSettings: settings,
      jellyfinSettings: jellyfinConfig
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).render('error', { message: 'Error loading settings', code: 500 });
  }
});

// API: Get audit logs as JSON
router.get('/api/audit-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { action, userId, status, limit = 100 } = req.query;
    
    const options = {
      action: action || undefined,
      userId: userId || undefined,
      status: status || undefined,
      limit: Math.min(parseInt(limit), 1000)
    };
    
    const logs = await AuditLogger.getLogs(options);
    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Get system statistics as JSON
router.get('/api/statistics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { range = '7d' } = req.query;
    
    // Calculate date range
    let startDate = new Date();
    switch (range) {
      case '24h': startDate.setHours(startDate.getHours() - 24); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      case 'all': startDate = new Date(0); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }

    const allLogs = await AuditLogger.getLogs({ limit: 10000 });
    const filteredLogs = allLogs.filter(log => new Date(log.timestamp) >= startDate);
    
    // Count actions
    const actionBreakdown = {};
    filteredLogs.forEach(log => {
      actionBreakdown[log.action] = (actionBreakdown[log.action] || 0) + 1;
    });

    // Count statuses
    const successCount = filteredLogs.filter(l => l.status === 'success').length;
    const failureCount = filteredLogs.filter(l => l.status === 'failure').length;
    const successRate = filteredLogs.length > 0 ? Math.round((successCount / filteredLogs.length) * 100) : 0;

    // Specific metrics
    const userLogins = filteredLogs.filter(l => l.action === 'SUCCESSFUL_LOGIN').length;
    const failedLogins = filteredLogs.filter(l => l.action === 'FAILED_LOGIN').length;
    const usersCreated = filteredLogs.filter(l => l.action === 'USER_CREATED' || l.action === 'OIDC_USER_CREATED').length;
    const settingsChanges = filteredLogs.filter(l => l.action?.includes('SETTINGS') || l.action?.includes('CONFIG')).length;
    const apiCalls = filteredLogs.filter(l => l.resource?.startsWith('/api')).length;
    const quickConnects = filteredLogs.filter(l => l.action?.includes('QUICKCONNECT')).length;

    // Get Jellyfin users count
    let totalUsers = 0;
    try {
      const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
      const users = await jellyfin.getUsers();
      totalUsers = users.length;
    } catch (e) {
      console.warn('Could not get Jellyfin users count:', e.message);
    }

    // Timeline data (group by hour for 24h, by day for longer periods)
    const timeline = {};
    filteredLogs.forEach(log => {
      const date = new Date(log.timestamp);
      let key;
      if (range === '24h') {
        key = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        key = date.toLocaleDateString();
      }
      if (!timeline[key]) {
        timeline[key] = { requests: 0, errors: 0 };
      }
      timeline[key].requests++;
      if (log.status === 'failure') {
        timeline[key].errors++;
      }
    });

    // Get database size
    let dbSize = '0 MB';
    try {
      const dbStats = await DatabaseManager.getAuditStats();
      dbSize = dbStats.dbSize || '0 MB';
    } catch (e) {
      // Ignore
    }

    res.json({
      success: true,
      stats: {
        totalRequests: filteredLogs.length,
        successRate,
        failedRequests: failureCount,
        activeUsers: 0, // Would need session tracking
        totalUsers,
        dbSize,
        userLogins,
        failedLogins,
        usersCreated,
        settingsChanges,
        apiCalls,
        quickConnects,
        actionBreakdown,
        timeline
      }
    });
  } catch (error) {
    console.error('Statistics error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Cleanup audit logs
router.post('/api/cleanup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { daysToKeep = 90 } = req.body;
    const deleted = await AuditLogger.cleanup(parseInt(daysToKeep));
    
    res.json({ 
      success: true, 
      message: `Deleted ${deleted} old audit logs (older than ${daysToKeep} days)`,
      deletedCount: deleted
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Get maintenance settings
router.get('/api/maintenance/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = {
      dailyCleanup: {
        enabled: true,
        hour: 2
      },
      weeklyOptimize: {
        enabled: true,
        dayOfWeek: 0, // Sunday
        hour: 3
      },
      monthlyBackup: {
        enabled: true,
        dayOfMonth: 1,
        hour: 4
      },
      backupRetention: 12,
      cleanupThreshold: 90
    };
    
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Update maintenance settings
router.post('/api/maintenance/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { dailyCleanup, weeklyOptimize, monthlyBackup, backupRetention, cleanupThreshold } = req.body;
    
    // Store settings in database
    await DatabaseManager.updateSetting('maintenance_daily_hour', dailyCleanup?.hour || 2);
    await DatabaseManager.updateSetting('maintenance_weekly_day', weeklyOptimize?.dayOfWeek || 0);
    await DatabaseManager.updateSetting('maintenance_weekly_hour', weeklyOptimize?.hour || 3);
    await DatabaseManager.updateSetting('maintenance_monthly_day', monthlyBackup?.dayOfMonth || 1);
    await DatabaseManager.updateSetting('maintenance_monthly_hour', monthlyBackup?.hour || 4);
    await DatabaseManager.updateSetting('backup_retention', backupRetention || 12);
    await DatabaseManager.updateSetting('cleanup_threshold', cleanupThreshold || 90);
    
    // Log the configuration change
    await AuditLogger.log({
      action: 'MAINTENANCE_CONFIG_UPDATED',
      userId: req.session.user?.Name || 'system',
      resource: 'maintenance_schedule',
      status: 'success',
      details: { dailyCleanup, weeklyOptimize, monthlyBackup, backupRetention, cleanupThreshold },
      ip: req.ip
    });
    
    res.json({ 
      success: true, 
      message: 'Maintenance schedule updated successfully'
    });
  } catch (error) {
    console.error('Error updating maintenance settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Run maintenance task immediately
router.post('/api/maintenance/run', requireAuth, requireAdmin, async (req, res) => {
  try {
    const MaintenanceScheduler = require('../models/MaintenanceScheduler');
    const { task = 'cleanup' } = req.body;
    
    let result = {};
    
    if (task === 'cleanup' || task === 'all') {
      const cleanedCount = await MaintenanceScheduler.cleanupAuditLogs();
      result.cleanup = { success: true, message: `Cleaned up ${cleanedCount} audit logs` };
    }
    
    if (task === 'optimize' || task === 'all') {
      await MaintenanceScheduler.optimizeDatabase();
      result.optimize = { success: true, message: 'Database optimized (VACUUM and ANALYZE completed)' };
    }
    
    if (task === 'backup' || task === 'all') {
      const backupFile = await MaintenanceScheduler.backupDatabase();
      result.backup = { success: true, message: `Database backed up to ${backupFile}` };
    }
    
    // Log the manual maintenance execution
    await AuditLogger.log({
      action: 'MAINTENANCE_MANUAL_RUN',
      userId: req.session.user?.Name || 'system',
      resource: task,
      status: 'success',
      details: result,
      ip: req.ip
    });
    
    const taskName = task === 'all' ? 'all maintenance tasks' : task;
    res.json({ 
      success: true, 
      message: `Executed ${taskName} successfully`,
      tasks: result
    });
  } catch (error) {
    console.error('Error running maintenance:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Backups page
router.get('/backups', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render('admin-backups', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken
    });
  } catch (error) {
    console.error('Backups page error:', error);
    res.status(500).render('error', { message: 'Backups page error', code: 500 });
  }
});

// API: Get backups list
router.get('/api/backups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const backupsDir = path.join(__dirname, '../..', 'backups');
    let backups = [];
    
    try {
      const files = await fs.readdir(backupsDir);
      const dbBackups = files.filter(f => f.endsWith('.db'));
      
      for (const file of dbBackups) {
        const filePath = path.join(backupsDir, file);
        const stats = await fs.stat(filePath);
        
        backups.push({
          id: file,
          name: file,
          date: stats.mtime,
          size: stats.size
        });
      }
      
      // Sort by date descending
      backups.sort((a, b) => b.date - a.date);
    } catch (err) {
      console.log('Backups directory not found');
      await fs.mkdir(backupsDir, { recursive: true });
    }
    
    res.json(backups);
  } catch (error) {
    console.error('Error loading backups:', error);
    res.status(500).json({ error: 'Failed to load backups' });
  }
});

// API: Create backup
router.post('/api/backups/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const MaintenanceScheduler = require('../models/MaintenanceScheduler');
    const backupFile = await MaintenanceScheduler.backupDatabase();
    
    await AuditLogger.log({
      action: 'BACKUP_CREATED',
      userId: req.session.user?.Name || 'system',
      resource: backupFile,
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'Backup created successfully: ' + path.basename(backupFile) });
  } catch (error) {
    await AuditLogger.log({
      action: 'BACKUP_CREATE_FAILED',
      userId: req.session.user?.Name || 'system',
      resource: 'backup',
      status: 'failure',
      details: { error: error.message },
      ip: req.ip
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Download backup
router.get('/api/backups/download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const filename = req.query.file;
    if (!filename || filename.includes('..')) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }
    
    const backupPath = path.join(__dirname, '../..', 'backups', filename);
    const stats = await fs.stat(backupPath);
    
    res.download(backupPath, filename, (err) => {
      if (!err) {
        AuditLogger.log({
          action: 'BACKUP_DOWNLOADED',
          userId: req.session.user?.Name || 'system',
          resource: filename,
          status: 'success',
          ip: req.ip
        });
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Restore backup
router.post('/api/backups/restore', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName || backupName.includes('..')) {
      return res.status(400).json({ success: false, message: 'Invalid backup name' });
    }
    
    const backupPath = path.join(__dirname, '../..', 'backups', backupName);
    const dbPath = path.join(__dirname, '../config/companion.db');
    
    // Verify backup exists
    await fs.stat(backupPath);
    
    // Create safety backup of current database
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyBackup = path.join(__dirname, '../..', 'backups', `pre-restore-${timestamp}.db`);
    
    try {
      await fs.copyFile(dbPath, safetyBackup);
    } catch (err) {
      console.log('Current DB backup for safety:', err);
    }
    
    // Restore from backup
    await fs.copyFile(backupPath, dbPath);
    
    await AuditLogger.log({
      action: 'BACKUP_RESTORED',
      userId: req.session.user?.Name || 'system',
      resource: backupName,
      status: 'success',
      details: { safetyBackup: path.basename(safetyBackup) },
      ip: req.ip
    });
    
    res.json({ 
      success: true, 
      message: `Database restored from ${backupName}. Current database backed up to ${path.basename(safetyBackup)}`
    });
  } catch (error) {
    await AuditLogger.log({
      action: 'BACKUP_RESTORE_FAILED',
      userId: req.session.user?.Name || 'system',
      resource: 'backup',
      status: 'failure',
      details: { error: error.message },
      ip: req.ip
    });
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Get performance metrics
router.get('/api/performance', requireAuth, requireAdmin, async (req, res) => {
  try {
    const PerformanceMonitor = require('../models/PerformanceMonitor');
    const metrics = await PerformanceMonitor.getMetrics();
    res.json({ success: true, metrics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API: Delete backup
router.post('/api/backups/delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { backupName } = req.body;
    if (!backupName || backupName.includes('..')) {
      return res.status(400).json({ success: false, message: 'Invalid backup name' });
    }
    
    const backupPath = path.join(__dirname, '../..', 'backups', backupName);
    await fs.unlink(backupPath);
    
    await AuditLogger.log({
      action: 'BACKUP_DELETED',
      userId: req.session.user?.Name || 'system',
      resource: backupName,
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: `Backup ${backupName} deleted successfully` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// User provisioning page
router.get('/provisioning', requireAuth, requireAdmin, async (req, res) => {
  try {
    const importHistory = await DatabaseManager.query(
      'SELECT * FROM import_history ORDER BY date DESC LIMIT 10'
    );
    
    res.render('admin/provisioning', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      importHistory: importHistory || []
    });
  } catch (error) {
    console.error('Provisioning page error:', error);
    res.status(500).render('error', { message: 'Provisioning page error', code: 500 });
  }
});

// Bulk user import from CSV
router.post('/api/users/import', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { users } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ success: false, message: 'No users to import' });
    }

    const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Validate and create users
    for (const user of users) {
      try {
        // Validate required fields
        if (!user.Username || !user.Email) {
          results.push({
            username: user.Username || 'Unknown',
            success: false,
            message: 'Missing Username or Email'
          });
          failCount++;
          continue;
        }

        // Check if user already exists
        const existingUsers = await jellyfin.getUsers();
        const exists = existingUsers.some(u => u.Name.toLowerCase() === user.Username.toLowerCase());
        
        if (exists) {
          results.push({
            username: user.Username,
            success: false,
            message: 'User already exists'
          });
          failCount++;
          continue;
        }

        // Create user
        const newUser = await jellyfin.createUser({
          name: user.Username,
          password: user.Password || generatePassword(),
          email: user.Email
        });

        // Set admin if requested
        if (user.Admin && user.Admin.toLowerCase() === 'true') {
          const policy = {
            IsAdministrator: true
          };
          await jellyfin.updateUserPolicy(newUser.Id, policy);
        }

        results.push({
          username: user.Username,
          success: true,
          message: `Created successfully${user.Admin === 'true' ? ' (Admin)' : ''}`
        });
        successCount++;

        // Log to audit
        await AuditLogger.log({
          action: 'USER_CREATED',
          userId: req.session.user?.Name || 'system',
          resource: user.Username,
          details: {
            email: user.Email,
            isAdmin: user.Admin === 'true'
          },
          status: 'success',
          ip: req.ip
        });

      } catch (error) {
        results.push({
          username: user.Username || 'Unknown',
          success: false,
          message: `Error: ${error.message}`
        });
        failCount++;
      }
    }

    // Record import history
    try {
      await DatabaseManager.run(
        `INSERT INTO import_history (total, success, failed, date) VALUES (?, ?, ?, ?)`,
        [users.length, successCount, failCount, new Date().toISOString()]
      );
    } catch (historyError) {
      console.warn('Failed to record import history:', historyError);
    }

    // Log bulk import
    await AuditLogger.log({
      action: 'BULK_USER_IMPORT',
      userId: req.session.user?.Name || 'system',
      resource: `${users.length} users`,
      details: {
        successful: successCount,
        failed: failCount
      },
      status: successCount > 0 ? 'success' : 'failure',
      ip: req.ip
    });

    res.json({
      success: successCount > 0,
      message: `Import completed: ${successCount} successful, ${failCount} failed`,
      results: results,
      summary: {
        total: users.length,
        successful: successCount,
        failed: failCount
      }
    });

  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ success: false, message: 'Import failed: ' + error.message });
  }
});

// Helper function: Generate random password
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Analytics page
router.get('/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render('admin/analytics', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken
    });
  } catch (error) {
    console.error('Analytics page error:', error);
    res.status(500).render('error', { message: 'Analytics page error', code: 500 });
  }
});

// System management page
router.get('/system', requireAuth, requireAdmin, async (req, res) => {
  try {
    res.render('admin/system', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken
    });
  } catch (error) {
    console.error('System page error:', error);
    res.status(500).render('error', { message: 'System page error', code: 500 });
  }
});

// Get comprehensive analytics data
router.get('/api/analytics', requireAuth, requireAdmin, async (req, res) => {
  try {
    const period = parseInt(req.query.period) || 30;

    // Generate comprehensive analytics report
    const report = await AnalyticsManager.generateAnalyticsReport(period);

    if (!report) {
      return res.json({
        success: false,
        message: 'Unable to generate analytics report'
      });
    }

    // Enrich top users with usernames from Jellyfin
    if (report.topUsers && report.topUsers.data && report.topUsers.data.length > 0) {
      try {
        const jellyfin = new JellyfinAPI(SetupManager.getConfig().jellyfinUrl, req.session.accessToken);
        const jellyfinUsers = await jellyfin.getUsers();
        
        // Create a map of userId to username
        const userMap = {};
        jellyfinUsers.forEach(u => {
          userMap[u.Id] = u.Name;
          userMap[u.Name] = u.Name; // Also map by name in case userId is already a name
        });

        // Enrich top users data with usernames
        report.topUsers.data = report.topUsers.data.map(user => ({
          ...user,
          username: userMap[user.userId] || user.userId
        }));
      } catch (enrichError) {
        console.warn('Could not enrich user data with usernames:', enrichError.message);
      }
    }

    res.json({
      success: true,
      period: `Last ${period} days`,
      report: report
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get specific analytics metric
router.get('/api/analytics/heatmap', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const heatmap = await AnalyticsManager.getUserActivityHeatmap(days);
    res.json({ success: true, data: heatmap });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get failed login trends
router.get('/api/analytics/failed-logins', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const trends = await AnalyticsManager.getFailedLoginTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get authentication methods usage
router.get('/api/analytics/auth-methods', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const usage = await AnalyticsManager.getAuthMethodsUsage(days);
    res.json({ success: true, data: usage });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get top users by activity
router.get('/api/analytics/top-users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const days = parseInt(req.query.days) || 30;
    const topUsers = await AnalyticsManager.getTopUsersByActivity(limit, days);
    res.json({ success: true, data: topUsers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get API endpoint usage
router.get('/api/analytics/endpoints', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const days = parseInt(req.query.days) || 30;
    const usage = await AnalyticsManager.getApiEndpointUsage(limit, days);
    res.json({ success: true, data: usage });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get security events summary
router.get('/api/analytics/security', requireAuth, requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const security = await AnalyticsManager.getSecurityEventsSummary(days);
    res.json({ success: true, data: security });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// OIDC SSO CONFIGURATION
// ============================================

// OIDC Settings Page
router.get('/oidc', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    const baseUrl = getBaseUrl(req, config);
    
    res.render('admin/oidc', {
      user: req.session.user,
      csrfToken: res.locals.csrfToken,
      baseUrl: baseUrl
    });
  } catch (error) {
    console.error('OIDC page error:', error);
    res.status(500).render('error', { message: 'OIDC page error', code: 500 });
  }
});

// Get OIDC settings
router.get('/api/oidc/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await DatabaseManager.getSetting('oidc_config');
    res.json({ 
      success: true, 
      settings: settings || null 
    });
  } catch (error) {
    console.error('Error getting OIDC settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/api/oidc/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = await DatabaseManager.getSetting('oidc_config');
    res.json({ 
      success: true, 
      settings: settings || null 
    });
  } catch (error) {
    console.error('Error getting OIDC settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save OIDC settings
router.post('/api/oidc/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = {
      enabled: req.body.enabled || false,
      providerName: req.body.providerName || 'SSO',
      issuerUrl: req.body.issuerUrl || '',
      clientId: req.body.clientId || '',
      clientSecret: req.body.clientSecret || '',
      scopes: req.body.scopes || 'openid profile email',
      autoCreateUsers: req.body.autoCreateUsers || false,
      usernameClaim: req.body.usernameClaim || 'preferred_username',
      adminGroup: req.body.adminGroup || ''
    };

    await DatabaseManager.setSetting('oidc_config', settings, 'json');

    await AuditLogger.log({
      action: 'OIDC_CONFIG_UPDATE',
      userId: req.session.user?.Id,
      resource: 'oidc:settings',
      details: { enabled: settings.enabled, providerName: settings.providerName },
      status: 'success',
      ip: req.ip
    });

    res.json({ success: true, message: 'OIDC settings saved' });
  } catch (error) {
    console.error('Error saving OIDC settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/admin/api/oidc/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const settings = {
      enabled: req.body.enabled || false,
      providerName: req.body.providerName || 'SSO',
      issuerUrl: req.body.issuerUrl || '',
      clientId: req.body.clientId || '',
      clientSecret: req.body.clientSecret || '',
      scopes: req.body.scopes || 'openid profile email',
      autoCreateUsers: req.body.autoCreateUsers || false,
      usernameClaim: req.body.usernameClaim || 'preferred_username',
      adminGroup: req.body.adminGroup || ''
    };

    await DatabaseManager.setSetting('oidc_config', settings, 'json');

    await AuditLogger.log({
      action: 'OIDC_CONFIG_UPDATE',
      userId: req.session.user?.Id,
      resource: 'oidc:settings',
      details: { enabled: settings.enabled, providerName: settings.providerName },
      status: 'success',
      ip: req.ip
    });

    res.json({ success: true, message: 'OIDC settings saved' });
  } catch (error) {
    console.error('Error saving OIDC settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Test OIDC connection
router.post('/api/oidc/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { issuerUrl } = req.body;

    if (!issuerUrl) {
      return res.status(400).json({ success: false, message: 'Issuer URL required' });
    }

    // Try to fetch the discovery document
    const fetch = (await import('node-fetch')).default;
    
    // Handle both full discovery URL and base issuer URL
    let discoveryUrl = issuerUrl;
    if (!issuerUrl.includes('.well-known')) {
      discoveryUrl = issuerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
    }

    const response = await fetch(discoveryUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return res.status(400).json({ 
        success: false, 
        message: `Failed to fetch discovery document: ${response.status}` 
      });
    }

    const config = await response.json();

    res.json({ 
      success: true, 
      issuer: config.issuer,
      authorizationEndpoint: config.authorization_endpoint,
      tokenEndpoint: config.token_endpoint
    });
  } catch (error) {
    console.error('OIDC test error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get application settings
router.get('/api/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    res.json({
      success: true,
      settings: {
        appName: config.appName || 'JellySSO',
        port: config.port || 3000,
        sessionTimeout: config.sessionTimeout || 30,
        httpsEnabled: config.httpsEnabled || false,
        theme: config.theme || 'dark'
      },
      jellyfinSettings: {
        jellyfinUrl: config.jellyfinUrl || '',
        jellyfinPublicUrl: config.jellyfinPublicUrl || '',
        webAppPublicUrl: config.webAppPublicUrl || '',
        apiKey: config.apiKey || ''
      }
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save application settings
router.post('/api/settings', requireAuth, requireAdmin, async (req, res) => {
  console.log('Settings save request headers:', JSON.stringify(req.headers, null, 2));
  console.log('Settings save request body:', JSON.stringify(req.body, null, 2));
  try {
    const config = SetupManager.getConfig();
    
    // Update settings
    if (req.body.appName !== undefined) config.appName = req.body.appName;
    if (req.body.sessionTimeout !== undefined) config.sessionTimeout = parseInt(req.body.sessionTimeout);
    if (req.body.httpsEnabled !== undefined) config.httpsEnabled = req.body.httpsEnabled === 'true' || req.body.httpsEnabled === true;
    if (req.body.theme !== undefined) config.theme = req.body.theme;
    
    // Update Jellyfin settings
    const updates = {};
    if (req.body.jellyfinUrl !== undefined) updates.jellyfinUrl = req.body.jellyfinUrl;
    if (req.body.jellyfinPublicUrl !== undefined) updates.jellyfinPublicUrl = req.body.jellyfinPublicUrl;
    if (req.body.webAppPublicUrl !== undefined) updates.webAppPublicUrl = req.body.webAppPublicUrl;
    if (req.body.apiKey !== undefined && req.body.apiKey) updates.apiKey = req.body.apiKey;
    
    // Save to config file
    SetupManager.updateConfig(updates);
    
    await AuditLogger.log({
      action: 'SETTINGS_UPDATE',
      userId: req.session.user?.Id,
      resource: 'settings',
      details: { 
        appName: config.appName,
        httpsEnabled: config.httpsEnabled,
        webAppPublicUrl: config.webAppPublicUrl
      },
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate new API key
router.post('/api/generate-api-key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const crypto = require('crypto');
    
    // Generate a random API key
    const newApiKey = crypto.randomBytes(32).toString('hex');
    
    // Update API key in config
    SetupManager.updateConfig({ apiKey: newApiKey });
    
    // Log the action
    await AuditLogger.log({
      action: 'API_KEY_GENERATED',
      userId: req.session.user?.Id,
      resource: 'api-key',
      details: { keyPrefix: newApiKey.substring(0, 8) + '...' },
      status: 'success',
      ip: req.ip
    });
    
    res.json({ 
      success: true, 
      message: 'New API key generated successfully',
      apiKey: newApiKey
    });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// PLUGIN MANAGEMENT ROUTES
// ============================================================================

// Plugin management page
router.get('/plugins', requireAuth, requireAdmin, async (req, res) => {
  try {
    const baseUrl = process.env.PUBLIC_URL || `http://${req.hostname}:${process.env.PORT || 3000}`;
    
    res.render('admin/plugins', { 
      user: req.session.user,
      baseUrl: baseUrl,
      csrfToken: res.locals.csrfToken
    });
  } catch (error) {
    console.error('Error rendering plugin page:', error);
    res.status(500).render('error', { message: 'Error loading plugin page', code: 500 });
  }
});

// Get plugin status
router.get('/api/plugins/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Check if plugin DLL exists
    const pluginPath = process.env.JELLYFIN_PLUGIN_PATH || '/var/lib/jellyfin/plugins';
    const dllExists = await fs.access(path.join(pluginPath, 'Jellyfin.Plugin.SSOCompanion.dll'))
      .then(() => true)
      .catch(() => false);
    
    res.json({
      success: true,
      installed: dllExists,
      version: '1.0.0',
      lastChecked: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error checking plugin status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get plugin configuration
router.get('/api/plugins/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    res.json({
      success: true,
      config: {
        enabled: config.enableSSO !== false,
        appUrl: config.companionUrl || process.env.PUBLIC_URL || 'http://localhost:3000',
        apiKey: config.sharedSecret || process.env.SHARED_SECRET || '',
        validateSessions: config.validateSessions !== false,
        sessionTimeout: config.sessionTimeout || 3600,
        autoCreateUsers: config.autoCreateUsers !== false,
        updateUserPolicies: config.updateUserPolicies !== false,
        logSSOAttempts: config.logSSOAttempts !== false
      }
    });
  } catch (error) {
    console.error('Error getting plugin config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save plugin configuration
router.post('/api/plugins/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, appUrl, apiKey, validateSessions, sessionTimeout, autoCreateUsers, updateUserPolicies, logSSOAttempts } = req.body;
    
    // Update configuration
    const updates = {
      companionUrl: appUrl,
      enableSSO: enabled !== false,
      validateSessions: validateSessions !== false,
      sessionTimeout: sessionTimeout || 3600,
      autoCreateUsers: autoCreateUsers !== false,
      updateUserPolicies: updateUserPolicies !== false,
      logSSOAttempts: logSSOAttempts !== false
    };
    
    // Update shared secret if provided
    if (apiKey) {
      updates.sharedSecret = apiKey;
      process.env.SHARED_SECRET = apiKey;
    }
    
    SetupManager.updateConfig(updates);
    
    // Log the configuration change
    await AuditLogger.log({
      action: 'PLUGIN_CONFIG_UPDATE',
      userId: req.session.user?.Id,
      resource: 'plugin-config',
      details: {
        appUrl,
        enabled
      },
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error) {
    console.error('Error saving plugin config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Test plugin connection
router.post('/api/plugins/test-connection', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { appUrl, apiKey } = req.body;
    const startTime = Date.now();
    
    const response = await fetch(`${appUrl}/api/auth/validate-sso`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      await AuditLogger.log({
        action: 'PLUGIN_TEST_CONNECTION',
        userId: req.session.user?.Id,
        resource: 'plugin',
        details: { appUrl, success: true },
        status: 'success',
        ip: req.ip
      });
      
      res.json({
        success: true,
        message: 'Connection successful',
        responseTime,
        endpoint: `${appUrl}/api/auth/validate-sso`,
        validationData: data
      });
    } else {
      throw new Error(`Server responded with status ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error testing plugin connection:', error);
    
    await AuditLogger.log({
      action: 'PLUGIN_TEST_CONNECTION',
      userId: req.session.user?.Id,
      resource: 'plugin',
      details: { success: false, error: error.message },
      status: 'failed',
      ip: req.ip
    });
    
    res.status(500).json({
      success: false,
      message: error.message,
      details: error.toString()
    });
  }
});

// Get plugin logs
router.get('/api/plugins/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await AuditLogger.getLogs({ 
      filter: { action: 'PLUGIN_SSO_VALIDATION' },
      limit,
      sort: { timestamp: -1 }
    });
    
    res.json({
      success: true,
      logs: logs.map(log => ({
        timestamp: log.timestamp,
        message: `${log.details?.username || 'Unknown'} - ${log.details?.result || 'No result'}`,
        action: log.action,
        status: log.status,
        details: log.details
      }))
    });
  } catch (error) {
    console.error('Error getting plugin logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear plugin logs
router.delete('/api/plugins/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    // In a real implementation, this would clear SSO-related logs from database
    // For now, we'll just return success
    await AuditLogger.log({
      action: 'PLUGIN_LOGS_CLEARED',
      userId: req.session.user?.Id,
      resource: 'plugin-logs',
      details: {},
      status: 'success',
      ip: req.ip
    });
    
    res.json({ success: true, message: 'Plugin logs cleared' });
  } catch (error) {
    console.error('Error clearing plugin logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Download plugin DLL
router.get('/api/plugin/download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pluginPath = path.join(__dirname, '..', '..', 'jellyfin-plugin', 'build', 'Jellyfin.Plugin.SSOCompanion.dll');
    
    console.log('Attempting to download plugin from:', pluginPath);
    
    // Check if file exists
    await fs.access(pluginPath);
    
    console.log('Plugin file found, initiating download');
    res.download(pluginPath, 'Jellyfin.Plugin.SSOCompanion.dll');
  } catch (error) {
    console.error('Error downloading plugin:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    res.status(404).json({ 
      success: false, 
      error: 'Plugin DLL not found. Please build the plugin first.',
      path: path.join(__dirname, '..', '..', 'jellyfin-plugin', 'build', 'Jellyfin.Plugin.SSOCompanion.dll')
    });
  }
});

// Legacy redirect for old cached URLs
router.get('/download', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/api/plugin/download');
});

// API Key Diagnostic Endpoint
router.get('/api/test-api-key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = SetupManager.getConfig();
    
    // Test 1: Check if API key exists
    if (!config.apiKey) {
      return res.json({
        success: false,
        error: 'No API key configured',
        tests: {
          keyExists: false
        }
      });
    }
    
    // Test 2: Validate API key format (should be 32 or 64 chars hex)
    const keyFormat = /^[a-f0-9]{32,64}$/i.test(config.apiKey);
    
    // Test 3: Try to connect to Jellyfin
    const jellyfin = new JellyfinAPI(config.jellyfinUrl, config.apiKey);
    let connectionTest = false;
    let authTest = false;
    let usersTest = false;
    let errorDetails = null;
    let authResponse = null;
    
    try {
      // Test public endpoint (no auth needed)
      await jellyfin.testConnection();
      connectionTest = true;
    } catch (err) {
      errorDetails = { connection: err.message };
    }
    
    try {
      // Test authenticated endpoint - System/Info requires auth
      const response = await jellyfin.client.get('/System/Info');
      authTest = response.status === 200;
      authResponse = { status: response.status, authenticated: true };
    } catch (err) {
      authResponse = { 
        status: err.response?.status || 'error', 
        authenticated: false,
        message: err.message,
        headers: err.response?.headers 
      };
      errorDetails = { ...errorDetails, auth: err.response?.status || err.message };
    }
    
    try {
      // Test Users endpoint
      await jellyfin.getUsers();
      usersTest = true;
    } catch (err) {
      errorDetails = { ...errorDetails, users: err.message };
    }
    
    res.json({
      success: authTest && usersTest,
      config: {
        jellyfinUrl: config.jellyfinUrl,
        apiKeyLength: config.apiKey.length,
        apiKeyPrefix: config.apiKey.substring(0, 16) + '...',
        apiKeySuffix: '...' + config.apiKey.substring(config.apiKey.length - 8),
        apiKeyFormat: keyFormat ? 'valid' : 'invalid',
        fullApiKey: config.apiKey // TEMPORARY - for debugging only
      },
      tests: {
        keyExists: true,
        keyFormat: keyFormat,
        connection: connectionTest,
        authentication: authTest,
        users: usersTest
      },
      authResponse,
      errors: errorDetails,
      recommendation: !authTest 
        ? 'API key is invalid. Please regenerate it in Jellyfin Dashboard → API Keys and copy the EXACT key value'
        : usersTest 
        ? 'All tests passed! API key is working.'
        : 'API key works but user access failed. Check permissions.',
      instructions: !authTest 
        ? [
          '1. Go to Jellyfin: http://192.168.1.183:8096',
          '2. Dashboard → API Keys',
          '3. Find "JellySSO" key (or create new one)',
          '4. Copy the ENTIRE key value (should be 64 characters)',
          '5. Visit /setup page and paste the key',
          '6. Save and restart JellySSO'
        ]
        : null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;
