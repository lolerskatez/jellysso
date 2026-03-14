# JellySSO Reverse Proxy Setup Guide

This guide explains how to properly configure JellySSO behind a reverse proxy (like cloudflared, nginx, Caddy, etc.).

## The Problem

When JellySSO runs behind a reverse proxy, CSRF token validation can fail because:
- The app receives HTTP from the proxy but clients see HTTPS
- Session cookies need the `secure` flag to work over HTTPS
- Without proper configuration, the session cookie won't be sent back from the client

## The Solution

### 1. Set Environment Variables

When running JellySSO behind a reverse proxy, set ONE of these environment variables:

```bash
# For Docker container
docker run -e TRUST_PROXY=true -e DOCKER=true jellysso:latest

# Or set in .env file
TRUST_PROXY=true
DOCKER=true
```

**Why?** This tells the application that it's behind a trusted proxy and enables secure session cookies.

### 2. Cloudflared Configuration

If using Cloudflared, ensure it's configured to forward the necessary headers:

```yaml
originRequest:
  headers:
    Host:
      - header: Host
        value: jc.tanjiro.one  # Your domain
    X-Forwarded-Proto:
      - header: X-Forwarded-Proto
        value: https
    X-Forwarded-For:
      - header: X-Forwarded-For
        value: []  # Auto-populated by Cloudflared
    X-Forwarded-Host:
      - header: X-Forwarded-Host  
        value: jc.tanjiro.one  # Your domain
```

### 3. Nginx Configuration (if using Nginx reverse proxy)

```nginx
upstream jellysso {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name jc.tanjiro.one;

    # SSL configuration
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://jellysso;
        
        # Essential headers for reverse proxy
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### 4. Docker Compose Example

```yaml
version: '3.8'

services:
  jellysso:
    image: jellysso:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - TRUST_PROXY=true
      - DOCKER=true
      - PORT=3000
    volumes:
      - ./config:/app/src/config
      - ./logs:/app/logs
      - ./logs/backups:/app/backups
    restart: unless-stopped
```

## How It Works

1. **Session Cookie Detection**: When `TRUST_PROXY=true` or `DOCKER=true`, the app enables secure session cookies
2. **Proxy Header Trust**: The app trusts `X-Forwarded-*` headers from the proxy to determine the actual protocol, host, and IP
3. **CSRF Token Generation**: CSRF tokens are now generated with knowledge that clients see HTTPS
4. **Token Refresh**: If a CSRF token becomes invalid, the client can fetch a fresh one from `/api/csrf-token`

## Debugging

If you still see "Invalid security token" errors:

1. **Check Server Logs**: Look for `CSRF token validation failed` messages with debug info
2. **Verify Environment Variables**: Ensure `TRUST_PROXY` or `DOCKER` is set
3. **Check Proxy Headers**: Confirm your reverse proxy is sending `X-Forwarded-Proto: https`
4. **Browser Console**: Check the browser DevTools Network tab to see request/response details
5. **Fetch Fresh Token**: The app will automatically try to fetch a fresh CSRF token after a failed login

## Key Changes Made

- ✅ Session cookies now use `secure: true` when behind a reverse proxy
- ✅ Sessions are initialized on first page load (`saveUninitialized: true`)
- ✅ New `/api/csrf-token` endpoint for fetching fresh tokens
- ✅ Improved error logging with detailed debug information
- ✅ Client-side improvements with `credentials: 'include'` for cookie support
- ✅ Automatic token refresh on CSRF errors

## Testing

1. Start the app with environment variables set:
   ```bash
   TRUST_PROXY=true npm start
   ```

2. Access via your reverse proxy domain (e.g., `https://jc.tanjiro.one`)

3. Try logging in - it should now work with CSRF protection enabled

4. If still failing, check the browser console and server logs for debug information

## Support

If issues persist, collect:
- Server logs showing CSRF validation failure with debug info
- Browser Network tab screenshot of the POST to `/api/auth/login`
- Your reverse proxy configuration
- Environment variables being used
