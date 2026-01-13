# Jellyfin SSO Companion Plugin

This plugin enables **Single Sign-On (SSO)** authentication for Jellyfin using the companion application. Users can authenticate via the companion app, and their session will automatically log them into Jellyfin.

---

## Features

✅ **Single Sign-On via Companion App** - Users authenticate through companion app and automatically gain Jellyfin access  
✅ **Automatic User Creation** - New users are automatically created in Jellyfin when SSO validation succeeds  
✅ **Group-Based Admin Mapping** - Admin status synced from companion app admin groups  
✅ **Secure Token Validation** - All tokens validated with companion app via API key authentication  
✅ **Connection Testing** - Built-in test to verify companion app connectivity  
✅ **Debug Logging** - Optional logging of all SSO validation attempts  

---

## Installation

### Prerequisites
- Jellyfin server running (10.8.0 or later)
- .NET 6.0 or later for building
- Companion application running and accessible from Jellyfin server

### Build & Install

1. **Build the plugin:**
   ```bash
   dotnet build --configuration Release
   ```

2. **Locate the built DLL:**
   ```
   bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll
   ```

3. **Copy to Jellyfin plugins directory:**
   - **Windows:** `C:\ProgramData\Jellyfin\Server\plugins\`
   - **Linux:** `/var/lib/jellyfin/plugins/`
   - **Docker:** `/config/plugins/`

4. **Restart Jellyfin:**
   - The plugin will be loaded on server restart
   - Navigate to Dashboard > Plugins to confirm installation

---

## Configuration

### Via Jellyfin Dashboard

1. Go to **Dashboard > Plugins > SSO Companion Plugin**
2. Configure the following settings:

#### Required Settings
- **Companion Base URL** - URL of companion application (e.g., `http://localhost:3000`)
- **Shared Secret / API Key** - Must match the API key configured in companion app

#### Optional Settings
- **Enable SSO Authentication** - Toggle SSO on/off (default: enabled)
- **Auto Create Users** - Automatically create Jellyfin users for new SSO users (default: enabled)
- **Update User Policies** - Sync admin status from companion app (default: enabled)
- **Log SSO Attempts** - Log validation attempts in Jellyfin logs (default: enabled)

### Test Connection

Click **Test Connection** button in plugin configuration to verify:
- Companion app is reachable
- API key is correct
- Network connectivity is working

---

## API Endpoints

The plugin exposes the following REST API endpoints:

### Validate SSO Token
```
POST /api/sso/validate
```
**Request:**
```json
{
  "token": "sso_token_from_companion_app"
}
```

**Response (Success):**
```json
{
  "success": true,
  "userId": "jellyfin-user-id",
  "username": "username",
  "message": "Token validated successfully"
}
```

**Response (Error):**
```json
{
  "error": "Invalid token"
}
```

### Get Plugin Configuration (Admin Only)
```
GET /api/sso/config
```

**Response:**
```json
{
  "enabled": true,
  "companionUrl": "http://localhost:3000",
  "autoCreateUsers": true,
  "updateUserPolicies": true
}
```

### Test Connection (Admin Only)
```
GET /api/sso/test
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Connection to companion app successful",
  "timestamp": "2026-01-13T00:00:00Z"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Failed to connect to companion app: Connection refused",
  "timestamp": "2026-01-13T00:00:00Z"
}
```

---

## Integration with Companion App

### Required Companion App Endpoints

The plugin expects the companion app to provide these endpoints:

#### 1. Token Validation Endpoint
```
POST /api/auth/validate-sso
```
**Request Headers:**
- `X-API-Key`: Shared secret configured in plugin

**Request Body:**
```json
{
  "token": "sso_token_to_validate"
}
```

**Response (Success - 200 OK):**
```json
{
  "username": "john.doe",
  "email": "john@example.com",
  "isAdmin": true
}
```

#### 2. Health Check Endpoint
```
GET /api/health
```

**Response (Success - 200 OK):**
```json
{
  "status": "healthy"
}
```

---

## Security

### Plugin Security Features

✅ **API Key Authentication** - All requests to companion app use shared secret  
✅ **Token Validation** - Every SSO token is validated with companion app  
✅ **User Policy Isolation** - Users can only access resources permitted by Jellyfin  
✅ **Audit Logging** - All SSO attempts can be logged for audit trails  
✅ **HTTPS Support** - Recommended for production use  

### Best Practices

1. **Use HTTPS in Production** - Configure plugin to use HTTPS URLs
2. **Secure Shared Secret** - Use a strong, randomly generated API key
3. **Companion App Security** - Ensure companion app is only accessible from Jellyfin server or VPN
4. **Regular Updates** - Keep Jellyfin and companion app updated
5. **Monitor Logs** - Enable SSO logging and review for suspicious activity
6. **Restrict Admin Creation** - Only set isAdmin=true in companion app for actual administrators

---

## Troubleshooting

### Plugin Not Loading
- Check Jellyfin logs: `Dashboard > Logs`
- Verify plugin DLL is in correct plugins directory
- Ensure .NET 6.0+ is installed on Jellyfin server
- Restart Jellyfin service

### Connection Test Fails
- Verify companion app URL is correct and accessible
- Check companion app is running: `curl http://localhost:3000/api/health`
- Verify firewall allows connection between Jellyfin and companion app
- Check shared secret matches in both plugin and companion app

### SSO Token Validation Fails
- Verify token is valid in companion app
- Check plugin logs for detailed error messages
- Ensure "Log SSO Attempts" is enabled for debugging
- Verify companion app `/api/auth/validate-sso` endpoint works

### Users Not Created Automatically
- Ensure "Auto Create Users" is enabled in plugin configuration
- Check Jellyfin user creation permissions
- Review companion app token to ensure username is present
- Check Jellyfin logs for creation errors

### Admin Status Not Updating
- Ensure "Update User Policies" is enabled
- Verify companion app returns `isAdmin` in token response
- Check user hasn't been manually promoted/demoted in Jellyfin
- Review plugin logs for policy update errors

---

## Logging & Debugging

### Enable Detailed Logging

1. Enable SSO logging in plugin configuration
2. Check Jellyfin logs at: `Dashboard > Logs`
3. Filter for "SSO" or "SsoController" messages
4. Look for validation successes/failures and error details

### Common Log Messages

```
SSO Companion Plugin initialized
Validating SSO token with companion app
SSO token validation successful
Error validating SSO token: [error details]
Created new SSO user: username
Updated admin status for user username: true
```

---

## Development

### Plugin Structure
```
jellyfin-plugin/
├── Plugin.cs                           # Main plugin class
├── Configuration/
│   ├── PluginConfiguration.cs         # Configuration model
│   └── configPage.html                # Web UI config page
├── Api/
│   └── SsoController.cs               # REST API controller
├── meta.json                          # Plugin metadata
└── README.md                          # This file
```

### Building from Source
```bash
cd jellyfin-plugin
dotnet build --configuration Release
```

### Project Requirements
- Target Framework: `.net6.0`
- Jellyfin NuGet packages: 10.8.0+

---

## Version History

### v1.0.0 (Current)
- ✅ Initial release with SSO support
- ✅ Automatic user creation
- ✅ Admin group mapping
- ✅ Connection testing
- ✅ Debug logging

---

## License & Attribution

This plugin is part of the Jellyfin Companion application suite.

**Status:** Production Ready  
**Last Updated:** January 13, 2026
