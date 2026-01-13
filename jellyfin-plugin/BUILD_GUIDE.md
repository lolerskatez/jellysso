# Jellyfin SSO Plugin - Build & Deployment Guide

Complete instructions for building, testing, and deploying the Jellyfin SSO Companion Plugin.

---

## Prerequisites

### System Requirements
- **.NET SDK 6.0+** - [Download](https://dotnet.microsoft.com/download/dotnet/6.0)
- **Git** (optional, for version control)
- **Jellyfin 10.8.0+** - Target server for deployment

### Windows Prerequisites
```powershell
# Check .NET installation
dotnet --version

# Install .NET 6.0 SDK (if needed)
# https://dotnet.microsoft.com/download/dotnet/6.0
```

### Linux/macOS Prerequisites
```bash
# Check .NET installation
dotnet --version

# Ubuntu/Debian
sudo apt-get install dotnet-sdk-6.0

# macOS (using Homebrew)
brew install dotnet-sdk
```

---

## Building the Plugin

### Step 1: Navigate to Plugin Directory
```bash
cd jellyfin-plugin
```

### Step 2: Restore Dependencies
```bash
dotnet restore
```

### Step 3: Build Release Version
```bash
dotnet build --configuration Release
```

### Step 4: Verify Build Output
- **Windows:** `bin\Release\net6.0\Jellyfin.Plugin.SSOCompanion.dll`
- **Linux/macOS:** `bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll`

File should be approximately **50-100 KB**.

### Step 5: Check Build Success
```bash
# You should see:
# Build succeeded.
```

---

## Troubleshooting Build Issues

### Error: "NuGet packages not found"
```bash
# Clear NuGet cache and restore
dotnet nuget locals all --clear
dotnet restore
```

### Error: ".NET SDK version not found"
```bash
# Check available .NET versions
dotnet --list-sdks

# Install required version
# https://dotnet.microsoft.com/download/dotnet/6.0
```

### Error: "TargetFramework not supported"
- Ensure you have **.NET 6.0 SDK** installed
- Run `dotnet --version` to verify

---

## Testing the Build

### Unit Tests (if present)
```bash
dotnet test --configuration Release
```

### Manual Build Verification
```powershell
# PowerShell (Windows)
$dll = "bin\Release\net6.0\Jellyfin.Plugin.SSOCompanion.dll"
if (Test-Path $dll) {
    Write-Host "✓ Plugin DLL found: $dll"
    Write-Host "✓ File size: $(Get-Item $dll).Length bytes"
    Write-Host "✓ Ready for deployment"
} else {
    Write-Host "✗ Plugin DLL not found!"
}
```

```bash
# Bash (Linux/macOS)
dll="bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll"
if [ -f "$dll" ]; then
    echo "✓ Plugin DLL found: $dll"
    echo "✓ File size: $(du -h "$dll" | cut -f1)"
    echo "✓ Ready for deployment"
else
    echo "✗ Plugin DLL not found!"
fi
```

---

## Deployment

### Option 1: Manual Installation

#### Windows
```powershell
# 1. Stop Jellyfin service
Stop-Service Jellyfin

# 2. Copy plugin DLL
$source = "bin\Release\net6.0\Jellyfin.Plugin.SSOCompanion.dll"
$dest = "C:\ProgramData\Jellyfin\Server\plugins\"
Copy-Item $source $dest -Force

# 3. Restart Jellyfin service
Start-Service Jellyfin

# 4. Verify in Jellyfin Dashboard > Plugins
```

#### Linux (Systemd)
```bash
# 1. Stop Jellyfin service
sudo systemctl stop jellyfin

# 2. Copy plugin DLL
sudo cp bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll \
    /var/lib/jellyfin/plugins/

# 3. Fix permissions
sudo chown jellyfin:jellyfin /var/lib/jellyfin/plugins/Jellyfin.Plugin.SSOCompanion.dll

# 4. Restart Jellyfin service
sudo systemctl start jellyfin

# 5. View logs
sudo journalctl -u jellyfin -f
```

#### Docker
```bash
# 1. Copy plugin to Docker volume
docker cp bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll \
    jellyfin_container:/config/plugins/

# 2. Restart container
docker restart jellyfin_container

# 3. View logs
docker logs -f jellyfin_container
```

### Option 2: Docker Build Integration

Create a `Dockerfile` to include plugin:

```dockerfile
FROM jellyfin/jellyfin:latest

# Copy built plugin
COPY bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll \
    /config/plugins/

# Ensure correct permissions
RUN chown -R jellyfin:jellyfin /config/plugins/
```

Build and run:
```bash
docker build -t jellyfin-with-sso .
docker run -d -p 8096:8096 jellyfin-with-sso
```

---

## Post-Installation Verification

### 1. Check Plugin Loaded
1. Open Jellyfin Dashboard: `http://localhost:8096/`
2. Go to **Dashboard > Plugins**
3. Look for **SSO Companion Plugin** in the list
4. Status should show **Enabled**

### 2. Verify Configuration Page
1. Click on **SSO Companion Plugin**
2. Configuration form should display all 8 settings
3. **Test Connection** button should be present

### 3. Test Connection
1. Enter **Companion Base URL**: `http://localhost:3000` (or your URL)
2. Enter **Shared Secret**: Same as configured in companion app
3. Click **Test Connection**
4. Should see: "Connection to companion app successful"

### 4. Check Logs
```bash
# Jellyfin logs location
# Windows: C:\ProgramData\Jellyfin\Server\logs\
# Linux: /var/log/jellyfin/
# Docker: docker logs jellyfin_container

# Look for messages like:
# "SSO Companion Plugin initialized"
# "Validating SSO token with companion app"
```

---

## Configuration via Dashboard

Once installed:

1. **Go to Dashboard > Plugins > SSO Companion Plugin**
2. **Configure Settings:**
   - Companion Base URL: `http://localhost:3000`
   - Shared Secret: (from companion app config)
   - Enable SSO: ✓ (checked)
   - Auto Create Users: ✓ (checked)
   - Update User Policies: ✓ (checked)
   - Log SSO Attempts: ✓ (checked)
3. **Click Test Connection** to verify connectivity
4. **Save Changes**

---

## API Testing

### Using curl to test endpoints

#### 1. Test Connection Endpoint
```bash
curl -X GET http://jellyfin-server:8096/api/sso/test \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

#### 2. Validate Token Endpoint
```bash
curl -X POST http://jellyfin-server:8096/api/sso/validate \
  -H "Content-Type: application/json" \
  -d '{"token": "your_sso_token_here"}'
```

#### 3. Get Configuration (Admin Only)
```bash
curl -X GET http://jellyfin-server:8096/api/sso/config \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Using Postman

1. **Import Collection** - Create new requests:
   - **POST** `/api/sso/validate` with token in JSON body
   - **GET** `/api/sso/test` with auth header
   - **GET** `/api/sso/config` with auth header

2. **Test Responses** - Verify expected output

---

## Troubleshooting Installation

### Plugin Not Loading
```bash
# 1. Check plugin file exists
ls -la /var/lib/jellyfin/plugins/ | grep SSOCompanion

# 2. Check Jellyfin logs for errors
tail -100 /var/log/jellyfin/jellyfin.log

# 3. Verify .NET 6.0 is available
dotnet --list-runtimes
```

### Connection Test Fails
```bash
# 1. Test companion app reachability
curl http://localhost:3000/api/health

# 2. Check firewall rules
# Ensure port 3000 (or configured port) is accessible

# 3. Verify shared secret matches
# Check both plugin and companion app configuration
```

### Verify Installation Locations

**Windows:**
```powershell
Get-ChildItem "C:\ProgramData\Jellyfin\Server\plugins\" | 
  Where-Object { $_.Name -like "*SSO*" }
```

**Linux:**
```bash
ls -la /var/lib/jellyfin/plugins/ | grep -i sso
```

**Docker:**
```bash
docker exec jellyfin_container ls -la /config/plugins/ | grep -i sso
```

---

## Version Management

### Updating the Plugin

1. **Build new version:**
   ```bash
   dotnet build --configuration Release
   ```

2. **Stop Jellyfin service**

3. **Replace old DLL** with new version

4. **Restart Jellyfin service**

5. **Verify in Dashboard > Plugins**

### Rollback

If issues occur after update:
1. Stop Jellyfin
2. Restore previous version of DLL
3. Restart Jellyfin
4. Check logs for issues

---

## Performance Considerations

### Plugin Performance Impact
- **Minimal**: Plugin only loads when SSO validation occurs
- **Memory**: ~10-20 MB typical usage
- **Startup**: <1 second additional startup time
- **Request time**: Token validation adds ~100-500ms per request

### Optimization Tips
1. Use HTTP keep-alive for companion app connections
2. Cache companion app responses when possible
3. Configure appropriate logging levels
4. Monitor Jellyfin performance metrics

---

## Build Automation

### GitHub Actions (Optional)

Create `.github/workflows/build.yml`:

```yaml
name: Build SSO Plugin

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '6.0'
      - run: dotnet build jellyfin-plugin --configuration Release
      - uses: actions/upload-artifact@v3
        with:
          name: plugin-dll
          path: jellyfin-plugin/bin/Release/net6.0/Jellyfin.Plugin.SSOCompanion.dll
```

---

## Support & Issues

### Reporting Build Issues
1. Include .NET version: `dotnet --version`
2. Include build output: Copy full error messages
3. Include OS and architecture
4. Check NuGet package versions

### Getting Help
- Check [README.md](README.md) for configuration help
- Review [/logs] directory for error details
- Test companion app endpoints separately

---

## Checklist

Before deploying to production:

- [ ] Plugin builds without errors
- [ ] DLL file is ~50-100 KB
- [ ] Jellyfin version is 10.8.0+
- [ ] .NET 6.0+ is installed on server
- [ ] Companion app is running and accessible
- [ ] Plugin appears in Dashboard > Plugins
- [ ] Test Connection returns success
- [ ] Configuration page displays correctly
- [ ] Logs show "SSO Companion Plugin initialized"
- [ ] Sample SSO token validates successfully

---

**Last Updated:** January 13, 2026  
**Version:** 1.0.0
