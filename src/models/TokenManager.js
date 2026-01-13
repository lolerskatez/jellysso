const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class TokenManager {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'default-jwt-secret';
    this.refreshTokens = new Map(); // In-memory store for refresh tokens (use Redis in production)
    this.tokenExpiry = 3600; // 1 hour in seconds
    this.refreshTokenExpiry = 2592000; // 30 days in seconds
  }

  /**
   * Generate a new access token
   */
  generateAccessToken(user, customClaims = {}) {
    const payload = {
      userId: user.Id,
      username: user.Name,
      email: user.Email || `${user.Name}@jellyfin.local`,
      isAdmin: user.Policy?.IsAdministrator || false,
      groups: user.Policy?.IsAdministrator ? ['admin', 'users'] : ['users'],
      ...customClaims
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.tokenExpiry,
      issuer: 'jellysso',
      audience: 'jellysso-app',
      jti: crypto.randomUUID() // Unique token ID for revocation support
    });
  }

  /**
   * Generate a refresh token
   */
  generateRefreshToken(userId) {
    const refreshTokenId = crypto.randomBytes(32).toString('hex');
    const payload = {
      userId: userId,
      tokenId: refreshTokenId,
      type: 'refresh'
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'jellyfin-companion'
    });

    // Store refresh token metadata (in production, use Redis with TTL)
    this.refreshTokens.set(refreshTokenId, {
      userId: userId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + this.refreshTokenExpiry * 1000),
      isRevoked: false
    });

    return token;
  }

  /**
   * Verify and decode a token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'jellyfin-companion',
        audience: 'jellyfin-companion-app'
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      }
      throw error;
    }
  }

  /**
   * Verify refresh token and check if still valid
   */
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'jellyfin-companion'
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      const tokenMetadata = this.refreshTokens.get(decoded.tokenId);
      if (!tokenMetadata || tokenMetadata.isRevoked) {
        throw new Error('Refresh token has been revoked');
      }

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Refresh token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid refresh token');
      }
      throw error;
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  refreshAccessToken(refreshToken, user) {
    try {
      this.verifyRefreshToken(refreshToken);
      return this.generateAccessToken(user);
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Revoke a refresh token
   */
  revokeRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'jellyfin-companion',
        ignoreExpiration: true
      });

      const tokenMetadata = this.refreshTokens.get(decoded.tokenId);
      if (tokenMetadata) {
        tokenMetadata.isRevoked = true;
      }
    } catch (error) {
      console.warn('Error revoking refresh token:', error.message);
    }
  }

  /**
   * Revoke all tokens for a user (e.g., on logout)
   */
  revokeUserTokens(userId) {
    let count = 0;
    for (const [tokenId, metadata] of this.refreshTokens.entries()) {
      if (metadata.userId === userId) {
        metadata.isRevoked = true;
        count++;
      }
    }
    return count;
  }

  /**
   * Clean up expired refresh tokens
   */
  cleanupExpiredTokens() {
    const now = new Date();
    let count = 0;

    for (const [tokenId, metadata] of this.refreshTokens.entries()) {
      if (metadata.expiresAt < now) {
        this.refreshTokens.delete(tokenId);
        count++;
      }
    }

    return count;
  }

  /**
   * Get token statistics for monitoring
   */
  getTokenStats() {
    let activeTokens = 0;
    let revokedTokens = 0;
    let expiredTokens = 0;
    const now = new Date();

    for (const [_, metadata] of this.refreshTokens.entries()) {
      if (metadata.isRevoked) {
        revokedTokens++;
      } else if (metadata.expiresAt < now) {
        expiredTokens++;
      } else {
        activeTokens++;
      }
    }

    return {
      active: activeTokens,
      revoked: revokedTokens,
      expired: expiredTokens,
      total: this.refreshTokens.size
    };
  }
}

// Export singleton instance
module.exports = new TokenManager();
