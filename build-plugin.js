#!/usr/bin/env node

/**
 * Build Script for Jellyfin SSO Plugin
 * Builds the .NET plugin and copies it to the build directory
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const PLUGIN_DIR = path.join(__dirname, 'jellyfin-plugin');
const BUILD_DIR = path.join(PLUGIN_DIR, 'build');
const OUTPUT_DIR = path.join(PLUGIN_DIR, 'bin', 'Release', 'net9.0');
const DLL_NAME = 'Jellyfin.Plugin.SSOCompanion.dll';

async function ensureBuildDir() {
  try {
    await fs.mkdir(BUILD_DIR, { recursive: true });
    console.log('✅ Build directory created');
  } catch (error) {
    console.error('❌ Failed to create build directory:', error.message);
    throw error;
  }
}

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔨 Running: ${command} ${args.join(' ')}`);
    
    const process = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    process.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    process.on('error', (error) => {
      reject(error);
    });
  });
}

async function buildPlugin() {
  console.log('🏗️  Building Jellyfin SSO Plugin...\n');

  try {
    // Step 1: Ensure build directory exists
    await ensureBuildDir();

    // Step 2: Clean previous builds
    console.log('\n🧹 Cleaning previous builds...');
    await runCommand('dotnet', ['clean', '--configuration', 'Release'], PLUGIN_DIR);

    // Step 3: Restore dependencies
    console.log('\n📦 Restoring NuGet packages...');
    await runCommand('dotnet', ['restore'], PLUGIN_DIR);

    // Step 4: Build the plugin
    console.log('\n🔨 Building plugin (Release configuration)...');
    await runCommand('dotnet', ['build', '--configuration', 'Release', '--no-restore'], PLUGIN_DIR);

    // Step 5: Copy DLL to build directory
    console.log('\n📋 Copying DLL to build directory...');
    const sourceDll = path.join(OUTPUT_DIR, DLL_NAME);
    const targetDll = path.join(BUILD_DIR, DLL_NAME);

    await fs.copyFile(sourceDll, targetDll);

    // Step 6: Verify the file
    const stats = await fs.stat(targetDll);
    const fileSizeKB = (stats.size / 1024).toFixed(2);

    console.log('\n✅ Build completed successfully!');
    console.log(`\n📦 Plugin Details:`);
    console.log(`   File: ${DLL_NAME}`);
    console.log(`   Size: ${fileSizeKB} KB`);
    console.log(`   Location: ${targetDll}`);
    console.log('\n🎉 Plugin is ready for download from the admin panel!');

  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Ensure .NET 6.0 SDK is installed: dotnet --version');
    console.error('   2. Try: dotnet nuget locals all --clear');
    console.error('   3. Check the BUILD_GUIDE.md for detailed instructions');
    process.exit(1);
  }
}

// Run the build
buildPlugin();
