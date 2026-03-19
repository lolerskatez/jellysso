const express = require('express');
const router = express.Router();
const ContactMethodManager = require('../models/ContactMethodManager');
const AuditLogger = require('../models/AuditLogger');
const { csrfProtection } = require('../middleware/csrf');
const { requireAuth } = require('../middleware/auth');

const contactManager = ContactMethodManager.getInstance();

/**
 * GET /api/contact-methods
 * Get all contact methods for the authenticated user
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.Id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    const methods = await contactManager.getContactMethods(userId);
    const verifiedMethods = await contactManager.getVerifiedMethods(userId);

    res.json({
      success: true,
      methods,
      verifiedMethods
    });
  } catch (error) {
    console.error('Error fetching contact methods:', error);
    AuditLogger.log('error', 'GET_CONTACT_METHODS_FAILED', {
      userId: req.session.user?.Id,
      error: error.message
    });
    res.status(500).json({ success: false, error: 'Failed to fetch contact methods' });
  }
});

/**
 * POST /api/contact-methods
 * Add a new contact method (requires verification)
 * Body: { method: 'discord'|'telegram'|'matrix', contactId: string }
 */
router.post('/', csrfProtection, requireAuth, async (req, res) => {
  try {
    const { method, contactId } = req.body;
    const userId = req.session.user?.Id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    // Validate method
    const validMethods = ['discord', 'telegram', 'matrix'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid contact method' });
    }

    // Validate contactId
    if (!contactId || typeof contactId !== 'string' || contactId.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Contact ID is required' });
    }

    // Add the contact method
    if (method === 'discord') {
      await contactManager.addDiscordMethod(userId, contactId);
    } else if (method === 'telegram') {
      await contactManager.addTelegramMethod(userId, contactId);
    } else if (method === 'matrix') {
      await contactManager.addMatrixMethod(userId, contactId);
    }

    // Create verification request
    const verification = await contactManager.createVerificationRequest(userId, method, contactId);

    AuditLogger.log('info', 'CONTACT_METHOD_ADDED', {
      userId,
      method,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `Verification sent to your ${method} account`,
      verification: {
        id: verification.id,
        method: verification.method,
        expiresAt: verification.expiresAt
      }
    });
  } catch (error) {
    console.error('Error adding contact method:', error);
    AuditLogger.log('error', 'ADD_CONTACT_METHOD_FAILED', {
      userId: req.session.user?.Id,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message || 'Failed to add contact method' });
  }
});

/**
 * POST /api/contact-methods/verify
 * Verify a contact method with verification code
 * Body: { verificationId: string, code: string }
 */
router.post('/verify', csrfProtection, requireAuth, async (req, res) => {
  try {
    const { verificationId, code } = req.body;
    const userId = req.session.user?.Id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    if (!verificationId || !code) {
      return res.status(400).json({ success: false, error: 'Verification ID and code are required' });
    }

    if (code.length !== 6 || isNaN(code)) {
      return res.status(400).json({ success: false, error: 'Verification code must be 6 digits' });
    }

    // Verify the code
    const result = await contactManager.verifyWithCode(verificationId, code);

    // Ensure the verification belongs to the current user
    if (result.userId !== userId) {
      AuditLogger.log('warn', 'VERIFY_WRONG_USER', {
        userId,
        attemptedVerification: verificationId
      });
      return res.status(403).json({ success: false, error: 'Verification does not belong to this user' });
    }

    AuditLogger.log('info', 'CONTACT_METHOD_VERIFIED', {
      userId,
      method: result.method,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `${result.method} contact method verified successfully`,
      method: result.method
    });
  } catch (error) {
    console.error('Error verifying contact method:', error);
    AuditLogger.log('warn', 'VERIFY_CONTACT_METHOD_FAILED', {
      userId: req.session.user?.Id,
      error: error.message
    });
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/contact-methods/verification/:id
 * Get verification request details (for displaying verification status)
 */
router.get('/verification/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user?.Id;

    const verification = await contactManager.getVerificationRequest(id);

    // Ensure verification belongs to the current user
    if (verification.userId !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({
      success: true,
      verification: {
        id: verification.id,
        method: verification.method,
        attempts: verification.attempts,
        maxAttempts: verification.maxAttempts,
        expiresAt: verification.expiresAt,
        verified: verification.verified
      }
    });
  } catch (error) {
    console.error('Error getting verification request:', error);
    res.status(404).json({ success: false, error: 'Verification request not found' });
  }
});

/**
 * DELETE /api/contact-methods/:method
 * Remove a contact method
 */
router.delete('/:method', csrfProtection, requireAuth, async (req, res) => {
  try {
    const { method } = req.params;
    const userId = req.session.user?.Id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    // Validate method
    const validMethods = ['discord', 'telegram', 'matrix'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid contact method' });
    }

    // Don't allow removing email (would leave user without contact)
    // but you could check if they have at least one other method

    await contactManager.removeMethod(userId, method);

    AuditLogger.log('info', 'CONTACT_METHOD_REMOVED', {
      userId,
      method,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `${method} contact method removed`
    });
  } catch (error) {
    console.error('Error removing contact method:', error);
    AuditLogger.log('error', 'REMOVE_CONTACT_METHOD_FAILED', {
      userId: req.session.user?.Id,
      method: req.params.method,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/contact-methods/:method/toggle
 * Enable or disable a contact method
 * Body: { enabled: boolean }
 */
router.patch('/:method/toggle', csrfProtection, requireAuth, async (req, res) => {
  try {
    const { method } = req.params;
    const { enabled } = req.body;
    const userId = req.session.user?.Id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }

    // Validate method
    const validMethods = ['discord', 'telegram', 'matrix', 'email'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ success: false, error: 'Invalid contact method' });
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
    }

    // Prevent disabling all methods
    if (method !== 'email' && !enabled) {
      const methods = await contactManager.getContactMethods(userId);
      // Check if user is disabling email (can't disable all methods)
      if (method === 'email' && methods.email_enabled && !Object.values(methods).some(v => v === true && v !== methods.email_enabled)) {
        return res.status(400).json({ success: false, error: 'Must keep at least one contact method enabled' });
      }
    }

    await contactManager.setMethodEnabled(userId, method, enabled);

    AuditLogger.log('info', 'CONTACT_METHOD_TOGGLED', {
      userId,
      method,
      enabled,
      ip: req.ip
    });

    res.json({
      success: true,
      message: `${method} contact method ${enabled ? 'enabled' : 'disabled'}`,
      method,
      enabled
    });
  } catch (error) {
    console.error('Error toggling contact method:', error);
    AuditLogger.log('error', 'TOGGLE_CONTACT_METHOD_FAILED', {
      userId: req.session.user?.Id,
      method: req.params.method,
      error: error.message
    });
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
