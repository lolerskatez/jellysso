# GitHub Setup & Fresh Deployment Guide

This guide helps you set up JellySSO for fresh deployment after cloning from GitHub.

## Prerequisites

- **Node.js**: 22 or higher
- **npm**: 10 or higher
- **Jellyfin**: Running instance (for integration)
- **Git**: For version control

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/jellysso.git
cd jellysso
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
# Copy the example configuration
cp .env.example .env

# Edit .env with your settings
# Required settings:
# - JELLYFIN_BASE_URL: Your Jellyfin server URL
# - SESSION_SECRET: Generate a secure random string
# - SHARED_SECRET: Generate a secure random string
```

**Generating Secure Secrets:**

```bash
# On Linux/macOS:
openssl rand -base64 32

# On Windows (PowerShell):
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 4. Initialize Database

The application will automatically create the SQLite database on first run. No manual initialization needed.

### 5. Start the Application

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

The application will be available at `http://localhost:3000`

## First Time Setup

1. Navigate to `http://localhost:3000/setup`
2. Follow the setup wizard to:
   - Configure Jellyfin connection
   - Create admin user
   - Configure OIDC (optional)
   - Set application preferences

## Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:comprehensive

# Run with coverage
npm test -- --coverage
```

## Docker Deployment

### Build Image

```bash
docker build -f Dockerfile.prod -t jellysso:latest .
```

### Run Container

```bash
docker run -d \
  -p 3000:3000 \
  -e JELLYFIN_BASE_URL=http://jellyfin:8096 \
  -e SESSION_SECRET=your-secure-secret \
  -e SHARED_SECRET=your-shared-secret \
  -v jellysso-data:/app/src/config \
  --name jellysso \
  jellysso:latest
```

### Docker Compose

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | HTTP server port |
| `HTTPS_PORT` | No | 3443 | HTTPS server port |
| `NODE_ENV` | No | development | Environment mode |
| `JELLYFIN_BASE_URL` | Yes | - | Jellyfin server URL |
| `SESSION_SECRET` | Yes | - | Session encryption secret |
| `SHARED_SECRET` | No | - | Plugin shared secret |
| `USE_HTTPS` | No | false | Enable HTTPS |
| `OIDC_ISSUER` | No | - | OIDC issuer URL |
| `OIDC_CLIENT_ID` | No | - | OIDC client ID |
| `OIDC_CLIENT_SECRET` | No | - | OIDC client secret |

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Database Issues

```bash
# Remove corrupted database (will be recreated)
rm src/config/companion.db

# Restart application
npm start
```

### Jellyfin Connection Failed

- Verify `JELLYFIN_BASE_URL` is correct and accessible
- Check Jellyfin is running and responding
- Verify network connectivity between JellySSO and Jellyfin

### HTTPS Certificate Issues

```bash
# Generate self-signed certificates
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
```

## Security Checklist

Before deploying to production:

- [ ] Set strong `SESSION_SECRET` and `SHARED_SECRET`
- [ ] Enable HTTPS (`USE_HTTPS=true`)
- [ ] Configure firewall rules
- [ ] Set up SSL certificates
- [ ] Review and configure audit logging
- [ ] Set up regular backups
- [ ] Monitor logs for suspicious activity
- [ ] Keep dependencies updated (`npm audit`)

## Next Steps

1. Review [SECURITY.md](SECURITY.md) for security best practices
2. Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for production deployment
3. Read [INFRASTRUCTURE_QUICK_REFERENCE.md](INFRASTRUCTURE_QUICK_REFERENCE.md) for architecture details
4. Explore [API documentation](DOCUMENTATION_FINAL.md) for API endpoints

## Support

For issues, questions, or contributions:

- Open an issue on GitHub
- Check existing documentation
- Review [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.
