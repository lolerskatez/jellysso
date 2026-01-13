using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Jellyfin.Plugin.SSOCompanion.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.SSOCompanion
{
    /// <summary>
    /// SSO Companion Plugin - Facilitates Single Sign-On with companion application
    /// </summary>
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        /// <summary>
        /// Static instance for plugin access
        /// </summary>
        public static Plugin Instance { get; private set; } = null!;

        public override string Name => "SSO Companion Plugin";
        public override string Description => "Enables SSO authentication with companion application";
        public override Guid Id => Guid.Parse("a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d");

        private readonly ILogger<Plugin> _logger;

        public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer, ILogger<Plugin> logger)
            : base(applicationPaths, xmlSerializer)
        {
            _logger = logger;
            Instance = this;
            
            _logger.LogInformation("SSO Companion Plugin initialized");
        }

        /// <summary>
        /// Get plugin web pages
        /// </summary>
        public IEnumerable<PluginPageInfo> GetPages()
        {
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "SSOCompanion",
                    EmbeddedResourcePath = GetType().Namespace + ".Configuration.configPage.html"
                }
            };
        }

        /// <summary>
        /// Validate SSO token with companion application
        /// </summary>
        public async Task<bool> ValidateSSOToken(string token)
        {
            if (!Configuration.EnableSSO)
            {
                _logger.LogWarning("SSO is disabled");
                return false;
            }

            if (string.IsNullOrEmpty(token))
            {
                _logger.LogWarning("Empty token provided for validation");
                return false;
            }

            try
            {
                if (Configuration.LogSsoAttempts)
                {
                    _logger.LogInformation("Validating SSO token with companion app");
                }

                var companionUrl = Configuration.CompanionBaseUrl;
                using var client = new HttpClient();
                client.DefaultRequestHeaders.Add("X-API-Key", Configuration.SharedSecret);
                client.Timeout = TimeSpan.FromSeconds(10);

                var validateUrl = $"{companionUrl}/api/auth/validate-sso";
                var content = new StringContent(
                    JsonSerializer.Serialize(new { token = token }),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await client.PostAsync(validateUrl, content);
                
                if (response.IsSuccessStatusCode)
                {
                    if (Configuration.LogSsoAttempts)
                    {
                        _logger.LogInformation("SSO token validation successful");
                    }
                    return true;
                }
                else
                {
                    _logger.LogWarning("SSO token validation failed with status code: {StatusCode}", response.StatusCode);
                    return false;
                }
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Failed to connect to companion app for SSO validation");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during SSO token validation");
                return false;
            }
        }

        /// <summary>
        /// Test connection to companion application
        /// </summary>
        public async Task<(bool Success, string Message)> TestConnection()
        {
            try
            {
                using var client = new HttpClient();
                client.DefaultRequestHeaders.Add("X-API-Key", Configuration.SharedSecret);
                client.Timeout = TimeSpan.FromSeconds(10);

                var healthUrl = $"{Configuration.CompanionBaseUrl}/api/health";
                var response = await client.GetAsync(healthUrl);

                if (response.IsSuccessStatusCode)
                {
                    return (true, "Connection to companion app successful");
                }
                else
                {
                    return (false, $"Companion app returned status code: {response.StatusCode}");
                }
            }
            catch (HttpRequestException ex)
            {
                return (false, $"Failed to connect: {ex.Message}");
            }
            catch (Exception ex)
            {
                return (false, $"Error: {ex.Message}");
            }
        }
    }
}
