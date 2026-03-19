const EventEmitter = require('events');

/**
 * NotificationEventEmitter - Global event system for notifications
 * 
 * Usage:
 *   const emitter = NotificationEventEmitter.getInstance();
 *   
 *   // Emit event
 *   emitter.emit('user:created', { id, username, email });
 *   
 *   // Listen to event
 *   emitter.on('user:created', async (data) => {
 *     await NotificationManager.sendWelcome(data.id);
 *   });
 */
class NotificationEventEmitter extends EventEmitter {
  static instance = null;

  constructor() {
    super();
    this.setMaxListeners(100); // Prevent memory leak warnings
    this.setupDefaultHandlers();
  }

  static getInstance() {
    if (!NotificationEventEmitter.instance) {
      NotificationEventEmitter.instance = new NotificationEventEmitter();
    }
    return NotificationEventEmitter.instance;
  }

  /**
   * Setup default event handlers (can be overridden)
   */
  setupDefaultHandlers() {
    // Default handlers will be attached from NotificationManager
    // when system starts up
  }

  /**
   * Define all possible events in the system
   */
  static EVENTS = {
    // User Lifecycle Events
    USER_CREATED: 'user:created',
    USER_ENABLED: 'user:enabled',
    USER_DISABLED: 'user:disabled',
    USER_DELETED: 'user:deleted',
    
    // User Expiry Events
    USER_EXPIRING_SOON: 'user:expiring_soon',
    USER_EXPIRED: 'user:expired',
    
    // Password Events
    PASSWORD_RESET_REQUESTED: 'password:reset_requested',
    PASSWORD_RESET_CONFIRMED: 'password:reset_confirmed',
    
    // Invite Events
    INVITE_CREATED: 'invite:created',
    INVITE_ACCEPTED: 'invite:accepted',
    INVITE_EXPIRED: 'invite:expired',
    
    // Admin Events
    ANNOUNCEMENT_PUBLISHED: 'announcement:published',
    
    // Security Events
    SUSPICIOUS_ACTIVITY: 'security:suspicious_activity'
  };

  /**
   * Emit user:created event
   * @param {Object} userData - { id, username, email, tier, ... }
   */
  emitUserCreated(userData) {
    this.emit(NotificationEventEmitter.EVENTS.USER_CREATED, userData);
  }

  /**
   * Emit user:enabled event
   */
  emitUserEnabled(userData) {
    this.emit(NotificationEventEmitter.EVENTS.USER_ENABLED, userData);
  }

  /**
   * Emit user:disabled event
   */
  emitUserDisabled(userData, reason = null) {
    this.emit(NotificationEventEmitter.EVENTS.USER_DISABLED, { ...userData, reason });
  }

  /**
   * Emit user:deleted event
   */
  emitUserDeleted(userData) {
    this.emit(NotificationEventEmitter.EVENTS.USER_DELETED, userData);
  }

  /**
   * Emit user:expiring_soon event
   */
  emitUserExpiringSoon(userData, daysRemaining) {
    this.emit(NotificationEventEmitter.EVENTS.USER_EXPIRING_SOON, { ...userData, daysRemaining });
  }

  /**
   * Emit user:expired event
   */
  emitUserExpired(userData) {
    this.emit(NotificationEventEmitter.EVENTS.USER_EXPIRED, userData);
  }

  /**
   * Emit password:reset_requested event
   */
  emitPasswordResetRequested(userData, resetCode, resetLink) {
    this.emit(NotificationEventEmitter.EVENTS.PASSWORD_RESET_REQUESTED, {
      ...userData,
      resetCode,
      resetLink
    });
  }

  /**
   * Emit password:reset_confirmed event
   */
  emitPasswordResetConfirmed(userData) {
    this.emit(NotificationEventEmitter.EVENTS.PASSWORD_RESET_CONFIRMED, userData);
  }

  /**
   * Emit invite:created event
   */
  emitInviteCreated(inviteData) {
    this.emit(NotificationEventEmitter.EVENTS.INVITE_CREATED, inviteData);
  }

  /**
   * Emit invite:accepted event
   */
  emitInviteAccepted(inviteData, userData) {
    this.emit(NotificationEventEmitter.EVENTS.INVITE_ACCEPTED, { ...inviteData, user: userData });
  }

  /**
   * Emit invite:expired event
   */
  emitInviteExpired(inviteData) {
    this.emit(NotificationEventEmitter.EVENTS.INVITE_EXPIRED, inviteData);
  }

  /**
   * Emit announcement:published event
   */
  emitAnnouncementPublished(announcementData) {
    this.emit(NotificationEventEmitter.EVENTS.ANNOUNCEMENT_PUBLISHED, announcementData);
  }

  /**
   * Emit security:suspicious_activity event
   */
  emitSuspiciousActivity(activityData) {
    this.emit(NotificationEventEmitter.EVENTS.SUSPICIOUS_ACTIVITY, activityData);
  }

  /**
   * Register notification handler for an event
   * 
   * @param {string} event - Event key from EVENTS
   * @param {Function} handler - Handler function
   */
  onNotification(event, handler) {
    this.on(event, handler);
  }

  /**
   * Remove notification handler
   */
  offNotification(event, handler) {
    this.off(event, handler);
  }

  /**
   * Get list of all registered listeners for debugging
   */
  getListenerCount(event) {
    return this.listenerCount(event);
  }

  /**
   * Get all event names
   */
  getEventNames() {
    return Object.values(NotificationEventEmitter.EVENTS);
  }
}

module.exports = NotificationEventEmitter;
