# Security Incident Report - January 21, 2026

## Severity: CRITICAL ⚠️

**Status**: FIXED  
**Date Reported**: January 21, 2026  
**Date Fixed**: January 21, 2026

---

## Issues Found

### 1. **Exposed API Key in Version Control** (CRITICAL)
- **File**: `src/config/setup.json`
- **Issue**: The setup configuration file containing a valid Jellyfin API key was committed to the repository
- **Exposed Data**:
  - API Key: `d20b571fb5b44687aa86c3d829b5d15a`
  - Jellyfin Internal URL: `http://192.168.1.183:8096`
  - Jellyfin Public URL: `https://j.tanjiro.one`
  - Admin Username: `media_admin`

### 2. **Authentication Without Setup Check** (HIGH)
- **Issue**: Login endpoint (`POST /api/auth/login`) was accessible before system setup was complete
- **Impact**: Users could authenticate with Jellyfin credentials without completing the initial setup wizard
- **Affected Routes**:
  - `/api/auth/login`
  - `/api/quickconnect/initiate`
  - `/api/quickconnect/connect`
  - `/api/quickconnect/authorize`
  - `/api/quickconnect/authenticate`
  - `/api/quickconnect/sessions/:code/approve`
  - `/api/quickconnect/sessions/:code/reject`
  - `/api/quickconnect/status`

### 3. **Missing .gitignore Entry** (HIGH)
- **Issue**: `src/config/setup.json` was not in `.gitignore`, allowing configuration files to be committed
- **Impact**: Any secrets stored in config files would be exposed in version control

---

## Fixes Applied

### ✅ Fix 1: Updated .gitignore
Added the following entries to prevent future credential exposure:
```gitignore
# Configuration and secrets
src/config/setup.json
src/config/*.json

# Certificates
certs/
*.pem
*.key
*.crt
```

### ✅ Fix 2: Added Setup Check to Auth Routes
Added `requireSetupComplete` middleware to all authentication and QuickConnect endpoints:
```javascript
const requireSetupComplete = (req, res, next) => {
  if (!SetupManager.isSetupComplete()) {
    const isAjax = req.headers['content-type'] === 'application/json' || req.xhr;
    if (isAjax) {
      return res.status(503).json({ success: false, message: 'System not configured. Please complete setup.' });
    }
    return res.redirect('/setup');
  }
  next();
};
```

Routes updated:
- `POST /api/auth/login`
- `POST /api/quickconnect/initiate`
- `POST /api/quickconnect/connect`
- `POST /api/quickconnect/authorize`
- `POST /api/quickconnect/authenticate`
- `POST /api/quickconnect/sessions/:code/approve`
- `POST /api/quickconnect/sessions/:code/reject`
- `POST /api/quickconnect/status`

---

## Remediation Steps for Users

### IMMEDIATE ACTION REQUIRED:
1. **Rotate your Jellyfin API Key** - The exposed key has been compromised
   - Log into Jellyfin Admin Dashboard
   - Navigate to Users → [Your User]
   - Regenerate Access Tokens
   
2. **Remove from GitHub History** (if already pushed):
   ```bash
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch src/config/setup.json' \
     --prune-empty --tag-name-filter cat -- --all
   ```

3. **Verify Jellyfin Security**:
   - Check recent access logs for unauthorized activity
   - Review shared user permissions
   - Consider resetting all passwords

4. **Update Local Environment**:
   - Pull the latest changes
   - Rebuild Docker container: `docker-compose -f docker-compose.prod.yml up -d --build`

---

## Prevention Measures

### For Future Development:
1. All configuration files containing secrets must be in `.gitignore`
2. Use environment variables for sensitive data instead of config files
3. Implement pre-commit hooks to scan for secrets:
   ```bash
   npm install --save-dev git-secrets
   git secrets --install
   git secrets --register-aws
   ```
4. Use `.env` files for local configuration (already in .gitignore)
5. All authentication endpoints must enforce setup completion
6. New routes must include setup checks by default

### Best Practices:
- Never commit credentials, API keys, or sensitive configuration
- Use GitHub secret scanning to detect exposed credentials
- Rotate credentials regularly
- Implement audit logging for all authentication attempts
- Test setup flow in CI/CD pipeline

---

## Testing

After deployment, verify:
1. ✅ Setup page displays on fresh install before login
2. ✅ Cannot login before setup is complete
3. ✅ Cannot use QuickConnect before setup is complete
4. ✅ `src/config/setup.json` is not tracked by git

---

## Files Modified

- `.gitignore` - Added config and certificate entries
- `src/routes/auth.js` - Added setup check to login route
- `src/routes/quickconnect.js` - Added setup checks to all POST routes

---

## Reference

- [OWASP: Sensitive Data Exposure](https://owasp.org/www-project-top-ten/2017/A3_2017-Sensitive_Data_Exposure)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)

---

**Report Compiled By**: Security Review  
**Last Updated**: January 21, 2026
