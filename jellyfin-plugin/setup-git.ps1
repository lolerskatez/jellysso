#!/usr/bin/env pwsh
# Quick setup script to initialize git and prepare for GitHub push

Write-Host "🚀 JellySSO Plugin - Git Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is installed
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git is not installed. Please install Git first." -ForegroundColor Red
    exit 1
}

# Navigate to plugin directory
Set-Location $PSScriptRoot

# Initialize git if not already initialized
if (!(Test-Path ".git")) {
    Write-Host "📝 Initializing git repository..." -ForegroundColor Yellow
    git init
    Write-Host "✅ Git initialized" -ForegroundColor Green
} else {
    Write-Host "✅ Git repository already initialized" -ForegroundColor Green
}

# Configure git user if not set
$userName = git config user.name
$userEmail = git config user.email

if (!$userName -or !$userEmail) {
    Write-Host ""
    Write-Host "⚙️  Git user configuration needed" -ForegroundColor Yellow
    $name = Read-Host "Enter your name"
    $email = Read-Host "Enter your email"
    
    git config user.name "$name"
    git config user.email "$email"
    Write-Host "✅ Git user configured" -ForegroundColor Green
}

# Add all files
Write-Host ""
Write-Host "📦 Adding files to git..." -ForegroundColor Yellow
git add .

# Show status
Write-Host ""
Write-Host "📊 Git status:" -ForegroundColor Cyan
git status

# Create initial commit
Write-Host ""
$commit = Read-Host "Create initial commit? (y/n)"
if ($commit -eq 'y') {
    git commit -m "Initial commit: JellySSO Plugin v1.0.0

- SSO token validation
- Automatic user creation
- Session management
- Secure API key authentication"
    
    Write-Host "✅ Initial commit created" -ForegroundColor Green
    
    # Ask for GitHub repository
    Write-Host ""
    Write-Host "📡 Next steps:" -ForegroundColor Cyan
    Write-Host "1. Create a new repository on GitHub: https://github.com/new" -ForegroundColor White
    Write-Host "   Repository name: jellyfin-plugin-jellysso" -ForegroundColor White
    Write-Host "   Description: Single Sign-On plugin for Jellyfin using JellySSO" -ForegroundColor White
    Write-Host "   Public repository" -ForegroundColor White
    Write-Host ""
    
    $setupRemote = Read-Host "Have you created the GitHub repository? (y/n)"
    
    if ($setupRemote -eq 'y') {
        Write-Host ""
        $username = Read-Host "Enter your GitHub username"
        $repoUrl = "https://github.com/$username/jellyfin-plugin-jellysso.git"
        
        # Add remote
        git remote add origin $repoUrl
        Write-Host "✅ Remote added: $repoUrl" -ForegroundColor Green
        
        # Rename branch to main
        git branch -M main
        
        # Push to GitHub
        Write-Host ""
        Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Yellow
        git push -u origin main
        
        Write-Host ""
        Write-Host "✅ Successfully pushed to GitHub!" -ForegroundColor Green
        Write-Host ""
        Write-Host "🎉 Next steps:" -ForegroundColor Cyan
        Write-Host "1. Build the plugin: dotnet build --configuration Release" -ForegroundColor White
        Write-Host "2. Create a GitHub release (see GITHUB_PUBLISHING_GUIDE.md)" -ForegroundColor White
        Write-Host "3. Update manifest.json with release URL" -ForegroundColor White
        Write-Host ""
        Write-Host "Repository URL: https://github.com/$username/jellyfin-plugin-jellysso" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "⏸️  Setup paused. After creating the GitHub repository, run:" -ForegroundColor Yellow
        Write-Host "   git remote add origin https://github.com/YOUR_USERNAME/jellyfin-plugin-jellysso.git" -ForegroundColor White
        Write-Host "   git branch -M main" -ForegroundColor White
        Write-Host "   git push -u origin main" -ForegroundColor White
    }
} else {
    Write-Host ""
    Write-Host "⏸️  Commit skipped. When ready, run:" -ForegroundColor Yellow
    Write-Host "   git commit -m 'Initial commit'" -ForegroundColor White
}

Write-Host ""
Write-Host "📚 See GITHUB_PUBLISHING_GUIDE.md for complete publishing instructions" -ForegroundColor Cyan
