const DatabaseManager = require('./DatabaseManager');

class AnalyticsManager {
  /**
   * Get user activity heatmap data (hourly breakdown by day)
   */
  async getUserActivityHeatmap(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const heatmapData = {};
      
      // Get all logins and activities for the period
      const logs = await DatabaseManager.query(
        `SELECT action, timestamp, userId FROM audit_logs 
         WHERE timestamp >= ? AND action IN ('SUCCESSFUL_LOGIN', 'FAILED_LOGIN', 'USER_CREATED')
         ORDER BY timestamp DESC`,
        [startDate.toISOString()]
      );

      // Aggregate by date and hour
      logs.forEach(log => {
        const date = new Date(log.timestamp);
        const dateKey = date.toISOString().split('T')[0];
        const hour = date.getHours();
        
        if (!heatmapData[dateKey]) {
          heatmapData[dateKey] = Array(24).fill(0);
        }
        heatmapData[dateKey][hour]++;
      });

      return {
        period: `Last ${days} days`,
        data: heatmapData,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting activity heatmap:', error);
      return null;
    }
  }

  /**
   * Get failed login trends
   */
  async getFailedLoginTrends(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const trends = {};
      
      const logs = await DatabaseManager.query(
        `SELECT timestamp, details FROM audit_logs 
         WHERE timestamp >= ? AND action = 'FAILED_LOGIN'
         ORDER BY timestamp ASC`,
        [startDate.toISOString()]
      );

      // Group by date
      logs.forEach(log => {
        const date = log.timestamp.split('T')[0];
        trends[date] = (trends[date] || 0) + 1;
      });

      return {
        period: `Last ${days} days`,
        data: trends,
        total: logs.length
      };
    } catch (error) {
      console.error('Error getting failed login trends:', error);
      return null;
    }
  }

  /**
   * Get authentication methods usage
   */
  async getAuthMethodsUsage(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const logs = await DatabaseManager.query(
        `SELECT action FROM audit_logs 
         WHERE timestamp >= ? AND action IN ('SUCCESSFUL_LOGIN', 'OIDC_TOKEN_ISSUED')
         ORDER BY timestamp DESC`,
        [startDate.toISOString()]
      );

      const usage = {
        'Local Auth': logs.filter(l => l.action === 'SUCCESSFUL_LOGIN').length,
        'OIDC': logs.filter(l => l.action === 'OIDC_TOKEN_ISSUED').length
      };

      return {
        period: `Last ${days} days`,
        data: usage,
        total: logs.length
      };
    } catch (error) {
      console.error('Error getting auth methods usage:', error);
      return null;
    }
  }

  /**
   * Get user creation trends
   */
  async getUserCreationTrends(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const trends = {};
      
      const logs = await DatabaseManager.query(
        `SELECT timestamp, resource FROM audit_logs 
         WHERE timestamp >= ? AND action IN ('USER_CREATED', 'OIDC_USER_CREATED')
         ORDER BY timestamp ASC`,
        [startDate.toISOString()]
      );

      // Group by date
      logs.forEach(log => {
        const date = log.timestamp.split('T')[0];
        trends[date] = (trends[date] || 0) + 1;
      });

      return {
        period: `Last ${days} days`,
        data: trends,
        total: logs.length
      };
    } catch (error) {
      console.error('Error getting user creation trends:', error);
      return null;
    }
  }

  /**
   * Get top users by activity
   */
  async getTopUsersByActivity(limit = 10, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const logs = await DatabaseManager.query(
        `SELECT userId, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= ? AND userId IS NOT NULL
         GROUP BY userId
         ORDER BY count DESC
         LIMIT ?`,
        [startDate.toISOString(), limit]
      );

      return {
        period: `Last ${days} days`,
        data: logs || [],
        total: logs?.length || 0
      };
    } catch (error) {
      console.error('Error getting top users:', error);
      return null;
    }
  }

  /**
   * Get API endpoint usage
   */
  async getApiEndpointUsage(limit = 20, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const logs = await DatabaseManager.query(
        `SELECT resource, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= ? AND resource IS NOT NULL
         GROUP BY resource
         ORDER BY count DESC
         LIMIT ?`,
        [startDate.toISOString(), limit]
      );

      return {
        period: `Last ${days} days`,
        data: logs || [],
        total: logs?.length || 0
      };
    } catch (error) {
      console.error('Error getting API endpoint usage:', error);
      return null;
    }
  }

  /**
   * Get action frequency
   */
  async getActionFrequency(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const logs = await DatabaseManager.query(
        `SELECT action, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= ?
         GROUP BY action
         ORDER BY count DESC`,
        [startDate.toISOString()]
      );

      return {
        period: `Last ${days} days`,
        data: logs || [],
        total: logs?.reduce((sum, log) => sum + log.count, 0) || 0
      };
    } catch (error) {
      console.error('Error getting action frequency:', error);
      return null;
    }
  }

  /**
   * Get security events summary
   */
  async getSecurityEventsSummary(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const logs = await DatabaseManager.query(
        `SELECT action, status, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= ? AND action IN ('FAILED_LOGIN', 'TOKEN_REVOKED', 'BACKUP_DELETED')
         GROUP BY action, status`,
        [startDate.toISOString()]
      );

      return {
        period: `Last ${days} days`,
        data: logs || [],
        failedLogins: logs?.filter(l => l.action === 'FAILED_LOGIN').reduce((sum, l) => sum + l.count, 0) || 0,
        tokensRevoked: logs?.filter(l => l.action === 'TOKEN_REVOKED').reduce((sum, l) => sum + l.count, 0) || 0
      };
    } catch (error) {
      console.error('Error getting security summary:', error);
      return null;
    }
  }

  /**
   * Generate comprehensive analytics report
   */
  async generateAnalyticsReport(days = 30) {
    try {
      const [
        heatmap,
        failedLogins,
        authMethods,
        userCreation,
        topUsers,
        apiUsage,
        actions,
        security
      ] = await Promise.all([
        this.getUserActivityHeatmap(days),
        this.getFailedLoginTrends(days),
        this.getAuthMethodsUsage(days),
        this.getUserCreationTrends(days),
        this.getTopUsersByActivity(10, days),
        this.getApiEndpointUsage(20, days),
        this.getActionFrequency(days),
        this.getSecurityEventsSummary(days)
      ]);

      return {
        period: `Last ${days} days`,
        reportDate: new Date().toISOString(),
        activityHeatmap: heatmap,
        failedLoginTrends: failedLogins,
        authenticationMethods: authMethods,
        userCreationTrends: userCreation,
        topUsers: topUsers,
        apiEndpointUsage: apiUsage,
        actionFrequency: actions,
        securityEvents: security
      };
    } catch (error) {
      console.error('Error generating analytics report:', error);
      return null;
    }
  }

  /**
   * Export analytics data as CSV
   */
  exportAsCSV(data, filename) {
    // Implementation for CSV export
    return JSON.stringify(data, null, 2); // For now, return JSON
  }
}

module.exports = new AnalyticsManager();
