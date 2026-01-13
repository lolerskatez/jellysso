# Production Deployment Guide - JellySSO

**Status:** ✅ Production Ready  
**Last Updated:** January 13, 2026

This guide covers deploying JellySSO to production environments using Docker and Docker Compose.

---

## Quick Start - Production Deployment

### Prerequisites
- Docker and Docker Compose installed
- Jellyfin instance running (local or remote)
- Jellyfin API key
- Strong secrets for SESSION_SECRET, JWT_SECRET, SHARED_SECRET

### 1. Clone and Setup
```bash
git clone <repository-url>
cd jellysso
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` with your production values:
```bash
NODE_ENV=production
JELLYFIN_URL=http://jellyfin:8096
JELLYFIN_API_KEY=your_jellyfin_api_key
SESSION_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
SHARED_SECRET=$(openssl rand -base64 32)
OIDC_ENABLED=false
LOG_LEVEL=info
```

### 3. Deploy
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Verify
```bash
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f jellyfin-companion
```

---

## Detailed Production Setup

### Docker Compose Deployment (Recommended)

The `docker-compose.prod.yml` includes:
- **jellyfin-companion** - JellySSO application
- **jellyfin** - Jellyfin media server
- **nginx** - Reverse proxy for HTTPS termination

#### Step 1: Environment Configuration
```bash
# Copy template
cp .env.example .env

# Generate strong secrets
SESSION_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
SHARED_SECRET=$(openssl rand -base64 32)

# Edit .env with your values
nano .env
```

#### Step 2: SSL/TLS Certificates (Optional but Recommended)
```bash
# Create certs directory
mkdir -p certs

# Option A: Let's Encrypt (Production)
certbot certonly --standalone -d yourdomain.com
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem certs/
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem certs/

# Option B: Self-signed (Testing)
openssl req -x509 -newkey rsa:4096 \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -days 365 -nodes
```

#### Step 3: Deploy
```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Monitor startup
docker-compose -f docker-compose.prod.yml logs -f

# Check service health
docker-compose -f docker-compose.prod.yml ps
```

#### Step 4: Verify Deployment
```bash
# Check application health
curl http://localhost:3000/api/health

# Check Jellyfin connectivity
curl http://localhost:8096/health

# View logs
docker-compose -f docker-compose.prod.yml logs jellyfin-companion
```

---

## HTTPS Configuration

### Option 1: Reverse Proxy (Recommended for Production)

Use **Nginx** (included in docker-compose.prod.yml) to handle HTTPS:

**Nginx Configuration** (`nginx.conf`):
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://jellyfin-companion:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /jellyfin/ {
        proxy_pass http://jellyfin:8096/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy Configuration (Simpler Alternative)**:
```caddyfile
yourdomain.com {
    reverse_proxy jellyfin-companion:3000
}

jellyfin.yourdomain.com {
    reverse_proxy jellyfin:8096
}
```

### Option 2: Direct HTTPS (Built-in)

1. **Place SSL certificates in `certs/` directory:**
   ```bash
   certs/
   ├── privkey.pem
   └── fullchain.pem
   ```

2. **Update `.env` file:**
   ```env
   NODE_ENV=production
   USE_HTTPS=true
   PORT=3000
   HTTPS_PORT=3443
   SESSION_SECRET=your-strong-secret-here
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

   The app will run on both:
   - HTTP: `http://localhost:3000` (for reverse proxy)
   - HTTPS: `https://localhost:3443` (direct access)

## Environment Variables

| Variable | Local/Dev | Production |
|----------|-----------|------------|
| `NODE_ENV` | `development` | `production` |
| `JELLYFIN_URL` | `http://localhost:8096` | `http://jellyfin:8096` |
| `JELLYFIN_API_KEY` | (required) | (required) |
| `SESSION_SECRET` | random | **strong secret** |
| `JWT_SECRET` | random | **strong secret** |
| `SHARED_SECRET` | random | **strong secret** |
| `USE_HTTPS` | (not set) | `true` (if direct HTTPS) |
| `PORT` | `3000` | `3000` |
| `HTTPS_PORT` | - | `3443` |
| `LOG_LEVEL` | `debug` | `info` |
| `OIDC_ENABLED` | `false` | `false` (unless configured) |

## Security Configuration

### Built-in Protections
✅ Non-root user execution (uid 1001)  
✅ Read-only filesystem where possible  
✅ Health checks on all services  
✅ Proper signal handling (dumb-init)  
✅ Security headers (Helmet.js)  
✅ Rate limiting on all endpoints  
✅ CSRF protection  
✅ Session authentication  
✅ Audit logging  

### Security Headers (Production)
- HSTS enabled (max-age: 1 year)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Content-Security-Policy: strict
- Secure cookies (HTTP-only, SameSite)

## Firewall & Port Configuration

### Local Network Deployment
```
Port 3000  → JellySSO Application
Port 8096  → Jellyfin Media Server
Port 80    → Nginx HTTP redirect
Port 443   → Nginx HTTPS (if configured)
```

### Internet-Facing Deployment
```
Port 80    → Nginx (redirect to HTTPS)
Port 443   → Nginx (HTTPS termination)
Port 3000  → JellySSO (internal only)
Port 8096  → Jellyfin (internal only)
```

**Important:** Never expose port 3000 directly to the internet without HTTPS.

## Monitoring & Maintenance

### Health Checks
```bash
# Application health
curl http://localhost:3000/api/health

# Jellyfin health
curl http://localhost:8096/health

# Docker Compose status
docker-compose -f docker-compose.prod.yml ps
```

### Logs
```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service
docker-compose -f docker-compose.prod.yml logs -f jellyfin-companion

# View last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 jellyfin-companion
```

### Database Backup
```bash
# Backup SQLite database
docker-compose -f docker-compose.prod.yml exec jellyfin-companion \
  cp /app/src/config/companion.db /app/backups/companion.db.backup

# List backups
docker-compose -f docker-compose.prod.yml exec jellyfin-companion \
  ls -la /app/backups/
```

### Updates
```bash
# Pull latest images
docker-compose -f docker-compose.prod.yml pull

# Rebuild application image
docker-compose -f docker-compose.prod.yml build --no-cache jellyfin-companion

# Restart services
docker-compose -f docker-compose.prod.yml restart
```

## Troubleshooting

### Container Won't Start
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs jellyfin-companion

# Verify environment variables
docker-compose -f docker-compose.prod.yml config

# Check port availability
netstat -tlnp | grep 3000
```

### Jellyfin Connection Issues
```bash
# Test connectivity from container
docker-compose -f docker-compose.prod.yml exec jellyfin-companion \
  curl http://jellyfin:8096/health

# Verify API key
curl -H "X-MediaBrowser-Token: YOUR_API_KEY" \
  http://localhost:8096/System/Info
```

### Performance Issues
```bash
# Check container resource usage
docker stats jellyfin-companion-prod

# Check disk space
docker-compose -f docker-compose.prod.yml exec jellyfin-companion \
  df -h

# Check database size
docker-compose -f docker-compose.prod.yml exec jellyfin-companion \
  du -sh /app/src/config/companion.db
```

## Recommended Production Stack

```
Internet → Nginx/Caddy (HTTPS:443) → JellySSO (HTTP:3000)
                                   → Jellyfin (HTTP:8096)
```

**Benefits:**
- SSL/TLS termination at proxy
- Better performance (Nginx handles static files)
- Easy certificate management (Let's Encrypt)
- Load balancing capability
- Better logging and monitoring
- Simplified firewall rules

## Production Checklist

Before going live, verify:
- ✅ All environment variables configured in `.env`
- ✅ Strong secrets generated (SESSION_SECRET, JWT_SECRET, SHARED_SECRET)
- ✅ SSL/TLS certificates installed (if using HTTPS)
- ✅ Jellyfin API key is valid
- ✅ Firewall rules configured
- ✅ Database backups configured
- ✅ Logs are being collected
- ✅ Health checks passing
- ✅ Reverse proxy configured (if using)
- ✅ DNS records updated (if applicable)
