# JellySSO - Single Sign-On for Jellyfin

**Status:** ✅ Production Ready - Live Deployment Enabled  
**Last Updated:** January 13, 2026  
**Version:** 1.0.0

JellySSO is a powerful Single Sign-On (SSO) companion application for Jellyfin, enabling seamless authentication via OIDC providers and advanced user management. Fully containerized and optimized for production environments.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the application
npm start

# Run tests
npm test

# Run benchmarks
npm run benchmark
```

The application will be available at `http://localhost:3000`

---

## Features

### 🔐 Authentication & Security
- **Jellyfin Login** - Native Jellyfin user authentication with error handling
- **OIDC/SSO** - Full OIDC provider integration with group-based admin mapping
- **QuickConnect** - Secure device pairing using Jellyfin's temporary codes
- **Session Management** - Database-backed persistent sessions (24-hour timeout)
- **CSRF Protection** - Security headers and token validation
- **Rate Limiting** - 100 requests/15min per IP to prevent abuse
- **Audit Logging** - Complete activity tracking for all admin actions

### 👥 User Management
- CRUD operations for Jellyfin users
- Search and filtering
- Activity logs
- Admin permission enforcement
- Policy configuration

### ⚙️ Settings & Configuration
- Application settings (theme, language, notifications)
- Jellyfin system configuration
- Backup/restore functionality
- Database maintenance tasks
- Performance monitoring

### 🔌 Extensibility
- Plugin system with hook-based architecture
- Admin dashboard with 5 pre-built pages
- API endpoints for custom integrations
- Performance metrics collection

---

## Architecture

### Core Stack
- **Runtime:** Node.js 22+
- **Framework:** Express.js 4.x
- **Template Engine:** EJS
- **Database:** SQLite 3
- **Session Store:** Database-backed
- **Testing:** Jest + Supertest

### Key Components
| Component | Purpose | Location |
|-----------|---------|----------|
| **SessionStore** | Persistent session management | src/models/SessionStore.js |
| **CacheManager** | In-memory LRU caching | src/models/CacheManager.js |
| **PluginManager** | Plugin system orchestration | src/models/PluginManager.js |
| **AuditLogger** | Activity tracking | src/models/AuditLogger.js |
| **JellyfinAPI** | Jellyfin integration | src/models/JellyfinAPI.js |
| **DatabaseManager** | SQLite operations | src/models/DatabaseManager.js |

---

## Configuration

### Environment Variables
```bash
# Server
PORT=3000
HTTPS_PORT=3443
NODE_ENV=development

# Jellyfin
JELLYFIN_URL=http://localhost:8096
JELLYFIN_API_KEY=your_api_key

# OIDC (Optional)
OIDC_ENABLED=false
OIDC_ISSUER_URL=https://your-oidc-provider.com
OIDC_CLIENT_ID=your_client_id
OIDC_CLIENT_SECRET=your_client_secret

# Session
SESSION_SECRET=your_session_secret

# Security
USE_HTTPS=false
```

---

## API Endpoints

### User Management
- `GET /api/users` - List all users
- `POST /api/users` - Create user
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Settings
- `GET /api/settings` - Get all settings
- `PUT /api/settings` - Update settings

### Admin
- `GET /admin/dashboard` - Main admin page
- `GET /admin/users` - User management page
- `GET /admin/audit-logs` - Audit logs page
- `GET /admin/backups` - Backup management page
- `GET /admin/analytics` - Analytics page

### QuickConnect
- `POST /api/quickconnect/authorize` - Authorize device
- `GET /api/quickconnect/enabled` - Check if enabled

### System
- `GET /api/server-info` - Server information
- `GET /api/health` - Health check
- `GET /api/performance` - Performance metrics

---

## Security

### Built-in Protections
✅ Session authentication on all protected routes  
✅ Admin role verification for sensitive operations  
✅ CSRF tokens for state-changing requests  
✅ Rate limiting (100 req/15min per IP)  
✅ Input validation on all endpoints  
✅ Error handling without information leakage  
✅ Secure session cookies (HTTP-only, SameSite)  
✅ Helmet.js security headers  
✅ Full audit logging with timestamps and IPs  

### Recommendations
- Use HTTPS in production (`USE_HTTPS=true`)
- Store sensitive env vars in `.env` file (not in git)
- Regularly backup the SQLite database
- Monitor audit logs for suspicious activity
- Keep Node.js and dependencies updated

---

## Testing

### Run Tests
```bash
npm test
```

### Test Coverage
- 36+ unit tests for core functionality
- Integration tests with mocked Jellyfin API
- Admin features testing
- Database operations testing

---

## Deployment

### Production Docker Compose (Recommended)
```bash
# Copy environment template
cp .env.example .env

# Edit .env with your production values
nano .env

# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f jellyfin-companion
```

### Docker Build & Run
```bash
# Build production image
docker build -f Dockerfile.prod -t jellysso:latest .

# Run container
docker run -d \
  --name jellysso-prod \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JELLYFIN_URL=http://jellyfin:8096 \
  -e JELLYFIN_API_KEY=your_api_key \
  -e SESSION_SECRET=your_strong_secret \
  -v jellysso-logs:/app/logs \
  jellysso:latest
```

### Environment Setup for Production
Create a `.env` file with production values:
```bash
NODE_ENV=production
JELLYFIN_URL=http://jellyfin:8096
JELLYFIN_API_KEY=your_jellyfin_api_key
SESSION_SECRET=generate_strong_random_secret
JWT_SECRET=generate_strong_random_secret
SHARED_SECRET=generate_strong_random_secret
OIDC_ENABLED=false
USE_HTTPS=false
LOG_LEVEL=info
```

See `DEPLOYMENT_GUIDE.md` for comprehensive production deployment instructions.

---

## Maintenance

### Automated Tasks
- Session cleanup - Every 60 minutes
- Database optimization - Weekly
- Audit log cleanup - Daily
- Backups - Monthly

### Manual Tasks
- Monitor disk usage
- Review audit logs
- Keep dependencies updated

---

## Troubleshooting

### Application Won't Start
- Check Node.js version: `node --version` (requires 22+)
- Verify Jellyfin connection
- Check port availability: `lsof -i :3000`
- Review logs: `tail -f logs/combined.log`

### Database Issues
- Verify permissions on `src/config/companion.db`
- Check available disk space
- Review database backups in `backups/`

---

## Documentation

- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Production deployment instructions
- [INFRASTRUCTURE_QUICK_REFERENCE.md](INFRASTRUCTURE_QUICK_REFERENCE.md) - Infrastructure reference
- [TESTING_AND_BENCHMARKS.md](TESTING_AND_BENCHMARKS.md) - Testing documentation
- [SECURITY.md](SECURITY.md) - Security policies and best practices
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contribution guidelines
- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) - System design details
- [AUTHENTICATION_INFRASTRUCTURE.md](AUTHENTICATION_INFRASTRUCTURE.md) - Authentication details

---

## Production Deployment

### Quick Deploy with Docker Compose
```bash
# 1. Clone repository
git clone <repository-url>
cd jellysso

# 2. Setup environment
cp .env.example .env
# Edit .env with your production values

# 3. Deploy
docker-compose -f docker-compose.prod.yml up -d

# 4. Verify
docker-compose -f docker-compose.prod.yml logs -f jellyfin-companion
```

### What's Included
- ✅ Multi-stage Docker build for optimized images
- ✅ Health checks on all services
- ✅ Nginx reverse proxy for HTTPS termination
- ✅ Non-root user execution for security
- ✅ Persistent volumes for data
- ✅ Comprehensive logging
- ✅ Production-grade configuration

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

---

**Status:** ✅ Production Ready - Live Deployment Enabled  
**Next Step:** Deploy to production using Docker Compose or run locally for testing