# Plugin Installation Troubleshooting - JellySSO Companion

**Status:** 🛠️ **TROUBLESHOOTING IN PROGRESS**  
**Date:** January 13, 2026  
**Version:** 1.0.1 (Plugin)

---

## Issue Identified

**Error Message:**
```
The checksums didn't match while installing JellySSO Companion, expected: 05d26336b6a1df84de8679b6842a51e2ece14381c10c41f1f4d42da5d67720b1, got: 6C1909FD5323CFEEE5D429A25ABBF470
Package installation failed: System.IO.InvalidDataException: The checksum of the received data doesn't match.
```

**Root Cause:**
The Jellyfin server encountered a checksum mismatch during the plugin installation process. The file downloaded from the repository URL does not match the checksum specified in the manifest.json. This could be due to an updated or corrupted file at the download URL or an error in the manifest.

**Impact:**
The JellySSO Companion plugin cannot be installed automatically through the Jellyfin UI due to the checksum verification failure.

---

## Resolution Steps

### Step 1: Manual Download and Verification
- **Download the Plugin:**
  Visit https://github.com/lolerskatez/jellysso-plugin/releases/download/v1.0.1/jellyfin-plugin-jellysso_1.0.1.zip and download the file locally.
- **Verify Checksum (Optional but Recommended):**
  Ensure the downloaded file matches the expected checksum `05d26336b6a1df84de8679b6842a51e2ece14381c10c41f1f4d42da5d67720b1`.
  - On Linux/Mac: `sha256sum jellyfin-plugin-jellysso_1.0.1.zip`
  - On Windows: Use a tool like 7-Zip or PowerShell's `Get-FileHash -Algorithm SHA256` to verify.

### Step 2: Manual Installation in Jellyfin
Since automatic installation fails due to checksum mismatch, manually place the plugin in Jellyfin's plugin directory:

**For Docker Compose Setup:**
```bash
# Ensure the plugin directory exists in the Jellyfin container
docker-compose -f docker-compose.prod.yml exec jellyfin mkdir -p /config/plugins/JellySSO_Companion

# Copy the downloaded zip file to the container (adjust the local path if needed)
docker cp ./jellyfin-plugin-jellysso_1.0.1.zip jellyfin-prod:/config/plugins/JellySSO_Companion/

# Restart Jellyfin to load the plugin
docker-compose -f docker-compose.prod.yml restart jellyfin
```

**For Non-Docker Setup:**
- Locate your Jellyfin configuration directory (typically under `config/plugins/`).
- Create a folder named `JellySSO_Companion` if it doesn't exist.
- Place the `jellyfin-plugin-jellysso_1.0.1.zip` file in this folder.
- Restart the Jellyfin server.

### Step 3: Verify Installation
- Access the Jellyfin dashboard.
- Navigate to the Plugins section.
- Check if "JellySSO Companion" is listed and active.
- If the plugin is not listed or inactive, check the Jellyfin logs again for any errors:
  ```bash
  docker-compose -f docker-compose.prod.yml logs jellyfin | grep -i error
  ```

### Step 4: Alternative Solution if Manual Installation Fails
If manual installation does not work, the plugin file or manifest may need to be updated:
- **Contact Plugin Developer:** Report the checksum mismatch issue to the plugin developer (lolerskatez on GitHub) via the repository's issue tracker.
- **Rebuild Plugin (Advanced):** If you have access to the plugin source code, rebuild the plugin zip file and update the manifest.json with the correct checksum. Then, try manual installation again with the updated files.

---

## Additional Notes

- **Checksum Mismatch Cause:** This error suggests that the file at the download URL may have been updated or corrupted after the manifest.json was created, or there might be an error in the manifest itself.
- **Temporary Workaround:** Manual installation bypasses the automatic checksum verification process in Jellyfin, allowing the plugin to be installed despite the mismatch.
- **Long-Term Fix:** The plugin repository owner should ensure that the manifest.json checksum matches the actual file at the download URL. If the file was updated, the manifest should be updated accordingly.

---

## Status

✅ **Root cause identified as checksum mismatch**  
✅ **Manual installation instructions provided**  
🛠️ **Awaiting user feedback on manual installation outcome**  

**Next Step:** Follow the manual installation steps above and report the result. If issues persist, provide additional log output or consider contacting the plugin developer for an updated manifest or plugin file.

---

**Last Updated:** January 13, 2026
