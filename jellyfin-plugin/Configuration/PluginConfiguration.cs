using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.SSOCompanion.Configuration
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>
        /// Base URL of the companion application
        /// </summary>
        public string CompanionBaseUrl { get; set; } = "http://localhost:3000";

        /// <summary>
        /// Shared secret for API communication with companion app
        /// </summary>
        public string SharedSecret { get; set; } = "";

        /// <summary>
        /// Enable/disable SSO authentication
        /// </summary>
        public bool EnableSSO { get; set; } = true;

        /// <summary>
        /// Automatically create users that don't exist in Jellyfin when SSO validation succeeds
        /// </summary>
        public bool AutoCreateUsers { get; set; } = true;

        /// <summary>
        /// Update user policies (admin status) based on companion app settings
        /// </summary>
        public bool UpdateUserPolicies { get; set; } = true;

        /// <summary>
        /// Use HTTPS for companion app communication (recommended for production)
        /// </summary>
        public bool UseHttps { get; set; } = false;

        /// <summary>
        /// Log all SSO validation attempts (for debugging)
        /// </summary>
        public bool LogSsoAttempts { get; set; } = true;
    }
}