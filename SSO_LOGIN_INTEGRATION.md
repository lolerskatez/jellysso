# Jellyfin SSO Login Button Integration

## Overview

The Jellyfin SSO plugin does **NOT** automatically add an SSO button to the Jellyfin login screen. The login button must be added through **custom branding** or **Jellyfin web client modifications**.

---

## Option 1: Custom Branding (Recommended)

Jellyfin supports custom CSS and branding that can be used to add an SSO login button.

### Step 1: Add Custom CSS

1. Navigate to **Jellyfin Dashboard** → **General** → **Branding**
2. In the **Custom CSS** field, add:

```css
/* Add SSO Login Button */
.loginForm::after {
    content: "";
    display: block;
    margin-top: 20px;
}

.sso-login-btn {
    display: block;
    width: 100%;
    padding: 12px;
    margin-top: 15px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    text-align: center;
    border-radius: 4px;
    text-decoration: none;
    font-weight: 500;
    transition: all 0.3s ease;
}

.sso-login-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.sso-login-btn i {
    margin-right: 8px;
}
```

### Step 2: Add Custom JavaScript

In **Dashboard** → **Advanced** → **Custom JavaScript**, add:

```javascript
// Add SSO login button to login form
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.querySelector('.loginForm');
    
    if (loginForm && !document.querySelector('.sso-login-btn')) {
        const ssoButton = document.createElement('a');
        ssoButton.href = '/api/sso/login';
        ssoButton.className = 'sso-login-btn';
        ssoButton.innerHTML = '<i class="md-icon">lock_open</i> Sign in with SSO';
        
        loginForm.appendChild(ssoButton);
    }
});
```

---

## Option 2: Modify Jellyfin Web Client (Advanced)

For deeper integration, modify the Jellyfin web client source code.

### Prerequisites
- Node.js 14+
- Git
- Jellyfin web client source

### Steps

1. **Clone Jellyfin Web Repository**
```bash
git clone https://github.com/jellyfin/jellyfin-web.git
cd jellyfin-web
```

2. **Locate Login Component**
```bash
# Find login template
src/controllers/session/login/login.html
```

3. **Add SSO Button**

In `login.html`, add after the login button:

```html
<button 
    is="emby-button" 
    type="button" 
    class="raised button-submit block btnSSOLogin">
    <i class="md-icon">lock_open</i>
    <span>Sign in with SSO</span>
</button>
```

4. **Add SSO Logic**

In `login.js`, add:

```javascript
view.querySelector('.btnSSOLogin').addEventListener('click', function() {
    window.location.href = ApiClient.getUrl('/api/sso/login');
});
```

5. **Build and Deploy**
```bash
npm install
npm run build:production

# Copy dist/ to your Jellyfin web directory
# Usually: /usr/share/jellyfin/web/ (Linux)
# Or: C:\Program Files\Jellyfin\Server\jellyfin-web\ (Windows)
```

---

## Option 3: Direct URL Access

Users can access SSO login directly by visiting:

```
https://your-jellyfin-server/api/sso/login
```

You can:
- Bookmark this URL
- Create a custom landing page
- Add it to documentation/user guides

---

## SSO Login Flow (Technical)

```
┌─────────────────────────────────────────────────────┐
│  1. User clicks "Sign in with SSO"                  │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  2. Jellyfin redirects to:                          │
│     GET /api/sso/login                              │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  3. SSO Plugin redirects to Companion App:          │
│     GET https://companion-app/api/auth/oidc/login   │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  4. Companion App redirects to Identity Provider    │
│     (Google, Azure AD, Authentik, etc.)             │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  5. User logs in with IdP credentials               │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  6. IdP redirects back to Companion App             │
│     with authorization code                         │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  7. Companion App exchanges code for token          │
│     Creates session, returns to Jellyfin            │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  8. Plugin validates token with Companion App       │
│     POST /api/sso/validate                          │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  9. Plugin creates/updates Jellyfin user            │
│     User is logged into Jellyfin                    │
└─────────────────────────────────────────────────────┘
```

---

## Required Plugin Routes

The SSO plugin exposes these routes in Jellyfin:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sso/login` | GET | Initiates SSO login flow |
| `/api/sso/validate` | POST | Validates SSO tokens |
| `/api/sso/callback` | GET | Handles SSO callback |
| `/api/sso/config` | GET | Returns SSO configuration |

---

## Testing SSO Login

### 1. Verify Plugin Installation
```bash
# Check Jellyfin logs
tail -f /var/log/jellyfin/log.txt

# Look for:
# "SSO Companion Plugin initialized"
```

### 2. Test Direct Access
Visit in browser:
```
https://your-jellyfin-server/api/sso/config
```

Should return:
```json
{
  "ssoEnabled": true,
  "companionUrl": "https://your-companion-app",
  "providerName": "SSO"
}
```

### 3. Test Login Flow
1. Clear browser cookies
2. Visit `/api/sso/login`
3. Should redirect to Companion App
4. Complete login
5. Should redirect back to Jellyfin and be logged in

---

## Troubleshooting

### SSO Button Not Appearing

**Problem:** Custom CSS/JS not loading

**Solution:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Verify custom CSS is saved in Dashboard
3. Check browser console for JavaScript errors
4. Ensure Jellyfin version supports custom branding

### SSO Login Fails

**Problem:** 404 error on `/api/sso/login`

**Solution:**
1. Verify plugin is installed: Dashboard → Plugins
2. Restart Jellyfin server
3. Check plugin configuration has correct Companion App URL

**Problem:** Token validation fails

**Solution:**
1. Verify Shared Secret matches between Plugin and Companion App
2. Check network connectivity between Jellyfin and Companion App
3. Review plugin logs in Jellyfin Dashboard

### Users Not Auto-Created

**Problem:** "User does not exist" error

**Solution:**
1. Enable **Auto Create Users** in plugin configuration
2. Verify user has valid email in identity provider
3. Check Companion App logs for user creation attempts

---

## Security Considerations

1. **Always use HTTPS** in production
2. **Keep Shared Secret secure** - treat it like a password
3. **Enable token expiration** - tokens should expire after reasonable time
4. **Monitor audit logs** - review SSO login attempts regularly
5. **Use strong identity provider** - ensure IdP has MFA enabled

---

## Alternative: Reverse Proxy SSO

For enterprise deployments, consider using a reverse proxy (nginx, Traefik) with SSO:

### nginx Example
```nginx
location /jellyfin {
    auth_request /auth;
    proxy_pass http://jellyfin:8096;
}

location /auth {
    proxy_pass http://companion-app:3000/api/auth/validate-sso;
}
```

This approach:
- ✅ Works without modifying Jellyfin
- ✅ Centralized authentication
- ✅ Compatible with all Jellyfin clients
- ❌ More complex setup
- ❌ Requires reverse proxy knowledge

---

## Summary

**Recommended Approach:**
- Use **Custom CSS/JS** (Option 1) for simplest implementation
- Provide direct `/api/sso/login` URL to users
- Consider reverse proxy for enterprise deployments

**Key Points:**
- SSO button is NOT automatic
- Multiple integration options available
- Custom branding is easiest
- Always test thoroughly before production deployment
