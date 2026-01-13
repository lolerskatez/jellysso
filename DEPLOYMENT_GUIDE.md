# Deployment Guide - HTTP (Local) & HTTPS (Internet)

## Current Setup - Local Development (HTTP)

The application is configured to run on **HTTP** for local network access:
- Access via: `http://192.168.1.125:3000` or `http://localhost:3000`
- No SSL/TLS required
- Works on local network

## Production Deployment (HTTPS for Internet)

When exposing to the internet, you'll need HTTPS. Here's how:

### Option 1: Reverse Proxy (Recommended)

Use a reverse proxy like **Nginx** or **Caddy** to handle HTTPS:

**Nginx Configuration:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Caddy Configuration (simpler):**
```caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}
```

### Option 2: Direct HTTPS (Built-in)

1. **Get SSL Certificates:**
   - Production: Use Let's Encrypt or your hosting provider
   - Testing: Generate self-signed certificates

2. **Place certificates in `certs/` directory:**
   ```bash
   # For Let's Encrypt certificates
   cp /etc/letsencrypt/live/yourdomain.com/privkey.pem certs/key.pem
   cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem certs/cert.pem
   ```

   ```bash
   # Or generate self-signed for testing
   openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
   ```

3. **Update `.env` file:**
   ```env
   NODE_ENV=production
   USE_HTTPS=true
   PORT=3000
   HTTPS_PORT=3443
   SESSION_SECRET=your-strong-secret-here
   ```

4. **Start the application:**
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
| `USE_HTTPS` | (not set) | `true` |
| `PORT` | `3000` | `3000` |
| `HTTPS_PORT` | - | `3443` or `443` |
| `SESSION_SECRET` | random | **strong secret** |

## Security Headers Configuration

The application automatically adjusts security headers based on environment:

**Development (HTTP):**
- No HSTS
- No upgrade-insecure-requests
- Relaxed CSP for local testing

**Production (HTTPS):**
- HSTS enabled (max-age: 1 year)
- upgrade-insecure-requests enabled
- Strict CSP
- Secure cookies only

## Firewall & Port Configuration

**For Local Network:**
- Open port `3000` on local firewall
- No internet exposure

**For Internet Access:**
- Use reverse proxy on ports `80` (HTTP) and `443` (HTTPS)
- Or open port `3443` for direct HTTPS access
- **DO NOT** expose port `3000` directly to internet without HTTPS

## Recommended Production Stack

```
Internet → Nginx/Caddy (HTTPS:443) → Jellyfin Companion (HTTP:3000)
```

Benefits:
- SSL/TLS termination at proxy
- Better performance (Nginx handles static files)
- Easy certificate management (Let's Encrypt)
- Load balancing capability
- Better logging and monitoring

## Quick Commands

**Local Development (HTTP):**
```bash
npm start
# Access: http://192.168.1.125:3000
```

**Production with Reverse Proxy:**
```bash
NODE_ENV=production npm start
# Nginx handles HTTPS, app runs on HTTP:3000
```

**Production Direct HTTPS:**
```bash
NODE_ENV=production USE_HTTPS=true npm start
# Access: https://yourdomain.com:3443
```

## Current Behavior

Right now, your application:
- ✅ Runs on HTTP port 3000
- ✅ Works on local network (192.168.1.125:3000)
- ✅ CSP configured for HTTP development
- ✅ Ready to add HTTPS when needed

**To access now:** `http://192.168.1.125:3000/login`
