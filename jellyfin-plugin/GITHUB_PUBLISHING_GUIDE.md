# Publishing JellySSO Plugin to GitHub

## Step 1: Create New GitHub Repository

1. Go to https://github.com/new
2. Repository name: `jellyfin-plugin-jellysso`
3. Description: "Single Sign-On plugin for Jellyfin using JellySSO"
4. Public repository
5. **Do NOT** initialize with README (we already have one)
6. Click **Create repository**

## Step 2: Prepare Plugin for Release

From the `jellyfin-plugin` directory:

```powershell
# Build the plugin
dotnet build --configuration Release

# Create release directory
New-Item -ItemType Directory -Path "release" -Force

# Copy DLL to release
Copy-Item "bin\Release\net9.0\Jellyfin.Plugin.SSOCompanion.dll" "release\"

# Create ZIP file
Compress-Archive -Path "release\*" -DestinationPath "jellyfin-plugin-jellysso_1.0.0.zip" -Force
```

## Step 3: Initialize Git Repository

```bash
cd E:\jellysso\jellyfin-plugin

# Initialize git
git init

# Add .gitignore
echo "bin/
obj/
*.user
*.suo
.vs/
release/" > .gitignore

# Add files
git add .
git commit -m "Initial release v1.0.0"

# Add remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/jellyfin-plugin-jellysso.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 4: Create GitHub Release

1. Go to your repository on GitHub
2. Click **Releases** → **Create a new release**
3. Tag version: `v1.0.0`
4. Release title: `JellySSO Plugin v1.0.0`
5. Description:
```markdown
## Initial Release

JellySSO Companion plugin for Jellyfin - Enable SSO authentication via JellySSO.

### Features
- SSO token validation
- Automatic user creation  
- Session management
- Secure API key authentication

### Installation
See [README](https://github.com/YOUR_USERNAME/jellyfin-plugin-jellysso#installation)

### Requirements
- Jellyfin 10.11.0+
- JellySSO companion app
```
6. Upload `jellyfin-plugin-jellysso_1.0.0.zip`
7. Click **Publish release**

## Step 5: Update manifest.json

After creating the release, update `manifest.json`:

1. Copy the download URL from the release (right-click the ZIP → Copy link)
2. Update `sourceUrl` in manifest.json with the actual URL
3. Generate checksum:

```powershell
# Generate SHA256 checksum
$hash = Get-FileHash "jellyfin-plugin-jellysso_1.0.0.zip" -Algorithm SHA256
$hash.Hash.ToLower()
```

4. Update `checksum` in manifest.json
5. Commit and push:

```bash
git add manifest.json
git commit -m "Update manifest with release URL and checksum"
git push
```

## Step 6: Add to Jellyfin

Now users can add your plugin repository:

1. Jellyfin Dashboard → **Plugins** → **Repositories**
2. Add repository URL:
   ```
   https://raw.githubusercontent.com/YOUR_USERNAME/jellyfin-plugin-jellysso/main/manifest.json
   ```
3. Plugin will appear in **Catalog**

## Step 7: Test Installation

1. Add the repository URL in Jellyfin
2. Go to Plugins → Catalog
3. Find "JellySSO Companion"
4. Click Install
5. Restart Jellyfin
6. Configure the plugin

## Automatic Updates

When you release a new version:

1. Build new version
2. Create new GitHub release (e.g., `v1.1.0`)
3. Update `manifest.json` with new version entry
4. Jellyfin will notify users of available updates

---

## Quick Commands Reference

```powershell
# Build
dotnet build --configuration Release

# Create release ZIP
Compress-Archive -Path "bin\Release\net9.0\Jellyfin.Plugin.SSOCompanion.dll" -DestinationPath "jellyfin-plugin-jellysso_1.0.0.zip" -Force

# Generate checksum
(Get-FileHash "jellyfin-plugin-jellysso_1.0.0.zip" -Algorithm SHA256).Hash.ToLower()

# Git commands
git add .
git commit -m "Version 1.0.0"
git tag v1.0.0
git push origin main --tags
```
