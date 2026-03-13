/**
 * Database Maintenance Scheduler
 * Handles automatic maintenance tasks:
 * - Daily: Clean up audit logs older than 90 days
 * - Weekly: Optimize database (VACUUM, ANALYZE)
 * - Monthly: Backup database
 */

const DatabaseManager = require('./DatabaseManager');
const fs = require('fs');
const path = require('path');

class MaintenanceScheduler {
  constructor() {
    this.tasks = [];
  }

  /**
   * Start all maintenance tasks
   */
  async start() {
    console.log('🔧 Starting database maintenance scheduler...');

    const dailyHour   = parseInt(await DatabaseManager.getSetting('maintenance_daily_hour'))   || 2;
    const weeklyDay   = parseInt(await DatabaseManager.getSetting('maintenance_weekly_day'))   || 0;
    const weeklyHour  = parseInt(await DatabaseManager.getSetting('maintenance_weekly_hour'))  || 3;
    const monthlyDay  = parseInt(await DatabaseManager.getSetting('maintenance_monthly_day'))  || 1;
    const monthlyHour = parseInt(await DatabaseManager.getSetting('maintenance_monthly_hour')) || 4;

    // Daily cleanup
    this.scheduleDaily('Daily Audit Cleanup', this.cleanupAuditLogs.bind(this), dailyHour);
    
    // Weekly optimization
    this.scheduleWeekly('Weekly Database Optimization', this.optimizeDatabase.bind(this), weeklyDay, weeklyHour);
    
    // Monthly backup
    this.scheduleMonthly('Monthly Database Backup', this.backupDatabase.bind(this), monthlyDay, monthlyHour);
    
    console.log('✅ Maintenance scheduler started');
  }

  async restart() {
    this.stop();
    await this.start();
    console.log('🔄 Maintenance scheduler restarted with updated settings');
  }

  /**
   * Schedule daily task at specific hour
   */
  scheduleDaily(name, task, hour) {
    const now = new Date();
    let nextRun = new Date();
    nextRun.setHours(hour, 0, 0, 0);
    
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    
    const timeout = setTimeout(async () => {
      console.log(`⏰ Running task: ${name}`);
      try {
        await task();
      } catch (error) {
        console.error(`❌ Task ${name} failed:`, error);
      }
      // Reschedule for next day
      setInterval(task, 24 * 60 * 60 * 1000);
    }, delay);
    
    this.tasks.push({ name, timeout });
    console.log(`📅 Scheduled ${name} for ${nextRun.toLocaleString()}`);
  }

  /**
   * Schedule weekly task
   */
  scheduleWeekly(name, task, dayOfWeek, hour) {
    const now = new Date();
    let nextRun = new Date();
    nextRun.setHours(hour, 0, 0, 0);
    
    const daysUntil = (dayOfWeek + 7 - now.getDay()) % 7 || 7;
    nextRun.setDate(nextRun.getDate() + daysUntil);
    
    const delay = nextRun.getTime() - now.getTime();
    
    const timeout = setTimeout(async () => {
      console.log(`⏰ Running task: ${name}`);
      try {
        await task();
      } catch (error) {
        console.error(`❌ Task ${name} failed:`, error);
      }
      // Reschedule for next week
      setInterval(task, 7 * 24 * 60 * 60 * 1000);
    }, delay);
    
    this.tasks.push({ name, timeout });
    console.log(`📅 Scheduled ${name} for ${nextRun.toLocaleString()}`);
  }

  /**
   * Schedule monthly task
   */
  scheduleMonthly(name, task, dayOfMonth, hour) {
    const now = new Date();
    let nextRun = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    nextRun.setHours(hour, 0, 0, 0);
    
    if (nextRun <= now) {
      nextRun = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth);
      nextRun.setHours(hour, 0, 0, 0);
    }
    
    const delay = nextRun.getTime() - now.getTime();
    
    const timeout = setTimeout(async () => {
      console.log(`⏰ Running task: ${name}`);
      try {
        await task();
      } catch (error) {
        console.error(`❌ Task ${name} failed:`, error);
      }
      // Reschedule for next month
      setInterval(task, 30 * 24 * 60 * 60 * 1000);
    }, delay);
    
    this.tasks.push({ name, timeout });
    console.log(`📅 Scheduled ${name} for ${nextRun.toLocaleString()}`);
  }

  /**
   * Clean up old audit logs (keep last 90 days)
   */
  async cleanupAuditLogs() {
    try {
      const daysToKeep = parseInt(await DatabaseManager.getSetting('cleanup_threshold')) || 90;
      const deleted = await DatabaseManager.cleanupAuditLogs(daysToKeep);
      
      console.log(`🧹 Audit cleanup completed: deleted ${deleted} old entries`);
      
      // Log the maintenance action
      await DatabaseManager.insertAuditLog(
        'MAINTENANCE_CLEANUP',
        'system',
        'system:maintenance',
        'success',
        null,
        { daysToKeep, deleted }
      );
    } catch (error) {
      console.error('Error during audit cleanup:', error);
      throw error;
    }
  }

  /**
   * Optimize database (VACUUM and ANALYZE)
   */
  async optimizeDatabase() {
    try {
      await new Promise((resolve, reject) => {
        DatabaseManager.db.serialize(() => {
          // VACUUM - reclaim unused space
          DatabaseManager.db.run('VACUUM', (err) => {
            if (err) reject(err);
            else {
              console.log('✨ Database VACUUM completed');
              
              // ANALYZE - update query optimizer statistics
              DatabaseManager.db.run('ANALYZE', (err) => {
                if (err) reject(err);
                else {
                  console.log('📊 Database ANALYZE completed');
                  resolve();
                }
              });
            }
          });
        });
      });
      
      // Log the maintenance action
      await DatabaseManager.insertAuditLog(
        'MAINTENANCE_OPTIMIZE',
        'system',
        'system:maintenance',
        'success',
        null,
        { action: 'VACUUM and ANALYZE' }
      );
    } catch (error) {
      console.error('Error during database optimization:', error);
      throw error;
    }
  }

  /**
   * Backup database to timestamped file
   */
  async backupDatabase() {
    try {
      const dbPath = path.join(__dirname, '..', 'config', 'companion.db');
      const backupDir = path.join(__dirname, '..', 'config', 'backups');
      
      // Create backups directory if it doesn't exist
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      // Generate timestamped backup filename
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const backupPath = path.join(backupDir, `companion-${timestamp}.db`);
      
      // Copy database file
      await new Promise((resolve, reject) => {
        fs.copyFile(dbPath, backupPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Get backup file size
      const stats = fs.statSync(backupPath);
      const sizeKB = Math.round(stats.size / 1024);
      
      console.log(`💾 Database backup completed: ${backupPath} (${sizeKB}KB)`);
      
      // Clean up old backups using configured retention count
      const backupRetention = parseInt(await DatabaseManager.getSetting('backup_retention')) || 12;
      this.cleanupOldBackups(backupDir, backupRetention);
      
      // Log the maintenance action
      await DatabaseManager.insertAuditLog(
        'MAINTENANCE_BACKUP',
        'system',
        'system:maintenance',
        'success',
        null,
        { backupFile: backupPath, sizeKB }
      );
      
      return backupPath;
    } catch (error) {
      console.error('Error during database backup:', error);
      throw error;
    }
  }

  /**
   * Remove old backups, keeping only the most recent N
   */
  cleanupOldBackups(backupDir, keepCount) {
    try {
      const files = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('companion-') && file.endsWith('.db'))
        .sort()
        .reverse();
      
      const toDelete = files.slice(keepCount);
      toDelete.forEach(file => {
        const filePath = path.join(backupDir, file);
        fs.unlinkSync(filePath);
        console.log(`🗑️  Deleted old backup: ${file}`);
      });
    } catch (error) {
      console.error('Error cleaning up old backups:', error);
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    this.tasks.forEach(task => clearTimeout(task.timeout));
    this.tasks = [];
    console.log('🛑 Maintenance scheduler stopped');
  }

  /**
   * Get maintenance status and next scheduled tasks
   */
  getStatus() {
    return {
      running: this.tasks.length > 0,
      taskCount: this.tasks.length,
      tasks: this.tasks.map(t => t.name)
    };
  }
}

module.exports = new MaintenanceScheduler();
