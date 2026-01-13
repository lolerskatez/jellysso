/**
 * Performance Monitoring
 * Tracks system performance metrics including response times, memory usage, and database stats
 */

const fs = require('fs').promises;
const path = require('path');
const DatabaseManager = require('./DatabaseManager');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      startTime: Date.now(),
      requestCount: 0,
      totalResponseTime: 0,
      lastHourRequests: [],
      errors: [],
      avgResponseTime: 0
    };
  }

  /**
   * Record HTTP request
   */
  recordRequest(duration, statusCode, path) {
    const now = Date.now();
    
    this.metrics.requestCount++;
    this.metrics.totalResponseTime += duration;
    
    // Track last hour
    this.metrics.lastHourRequests.push({
      time: now,
      duration,
      status: statusCode,
      path
    });
    
    // Keep only last hour
    this.metrics.lastHourRequests = this.metrics.lastHourRequests.filter(
      r => now - r.time < 3600000
    );
    
    // Track errors
    if (statusCode >= 400) {
      this.metrics.errors.push({
        time: now,
        status: statusCode,
        path
      });
      
      // Keep only last 100 errors
      if (this.metrics.errors.length > 100) {
        this.metrics.errors.shift();
      }
    }
    
    // Calculate average
    this.metrics.avgResponseTime = Math.round(
      this.metrics.totalResponseTime / this.metrics.requestCount
    );
  }

  /**
   * Get current performance metrics
   */
  async getMetrics() {
    const now = Date.now();
    const uptime = now - this.metrics.startTime;
    
    // Get database size
    let dbSize = '0 MB';
    try {
      const dbPath = path.join(__dirname, '../config/companion.db');
      const stats = await fs.stat(dbPath);
      dbSize = (stats.size / 1024 / 1024).toFixed(2) + ' MB';
    } catch (err) {
      console.error('Error getting DB size:', err);
    }
    
    // Calculate hourly rate
    const lastHourCount = this.metrics.lastHourRequests.length;
    const requestsPerHour = Math.round(lastHourCount);
    
    // Calculate error rate
    const lastHourErrors = this.metrics.lastHourRequests.filter(r => r.status >= 400).length;
    const errorRate = lastHourCount > 0 ? Math.round((lastHourErrors / lastHourCount) * 100) : 0;
    
    // Calculate uptime
    const uptimeMinutes = Math.floor(uptime / 60000);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    
    let uptimeString = uptimeDays + 'd ' + (uptimeHours % 24) + 'h ' + (uptimeMinutes % 60) + 'm';
    
    // Response time distribution
    const fastRequests = this.metrics.lastHourRequests.filter(r => r.duration < 50).length;
    const mediumRequests = this.metrics.lastHourRequests.filter(
      r => r.duration >= 50 && r.duration < 200
    ).length;
    const slowRequests = this.metrics.lastHourRequests.filter(r => r.duration >= 200).length;
    
    // Top error paths
    const errorPaths = {};
    this.metrics.errors.forEach(err => {
      errorPaths[err.path] = (errorPaths[err.path] || 0) + 1;
    });
    const topErrors = Object.entries(errorPaths)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));
    
    return {
      uptime: uptimeString,
      uptimeMs: uptime,
      totalRequests: this.metrics.requestCount,
      requestsPerHour,
      avgResponseTime: this.metrics.avgResponseTime,
      lastHourRequests: lastHourCount,
      errorCount: this.metrics.errors.length,
      errorRate,
      dbSize,
      responseTimeDistribution: {
        fast: fastRequests,
        medium: mediumRequests,
        slow: slowRequests
      },
      topErrors,
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };
  }

  /**
   * Get metrics for last N hours
   */
  async getHistoricalMetrics(hours = 24) {
    const now = Date.now();
    const hourMs = 3600000;
    const hourBuckets = {};
    
    for (let i = 0; i < hours; i++) {
      const bucketTime = Math.floor((now - (i * hourMs)) / hourMs) * hourMs;
      hourBuckets[bucketTime] = {
        requests: 0,
        errors: 0,
        totalDuration: 0,
        avgDuration: 0
      };
    }
    
    this.metrics.lastHourRequests.forEach(req => {
      const bucketTime = Math.floor(req.time / hourMs) * hourMs;
      if (hourBuckets[bucketTime]) {
        hourBuckets[bucketTime].requests++;
        hourBuckets[bucketTime].totalDuration += req.duration;
        if (req.status >= 400) {
          hourBuckets[bucketTime].errors++;
        }
      }
    });
    
    // Calculate averages
    Object.values(hourBuckets).forEach(bucket => {
      if (bucket.requests > 0) {
        bucket.avgDuration = Math.round(bucket.totalDuration / bucket.requests);
      }
    });
    
    return hourBuckets;
  }

  /**
   * Get performance summary for dashboard
   */
  async getSummary() {
    const metrics = await this.getMetrics();
    
    return {
      uptime: metrics.uptime,
      totalRequests: metrics.totalRequests,
      avgResponseTime: metrics.avgResponseTime + 'ms',
      requestsPerHour: metrics.requestsPerHour,
      errorRate: metrics.errorRate + '%',
      dbSize: metrics.dbSize,
      errorCount: metrics.errorCount,
      memory: {
        heapUsed: Math.round(metrics.memory.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(metrics.memory.heapTotal / 1024 / 1024) + ' MB'
      }
    };
  }
}

// Export singleton
module.exports = new PerformanceMonitor();
