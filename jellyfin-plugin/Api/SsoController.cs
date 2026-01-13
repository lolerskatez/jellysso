using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Jellyfin.Plugin.SSOCompanion.Configuration;
using MediaBrowser.Controller.Authentication;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.SSOCompanion.Api
{
    /// <summary>
    /// SSO API Controller - Handles authentication and authorization with companion app
    /// </summary>
    [Route("api/[controller]")]
    [ApiController]
    public class SsoController : ControllerBase
    {
        private readonly IUserManager _userManager;
        private readonly ILogger<SsoController> _logger;
        private readonly PluginConfiguration _config;

        public SsoController(IUserManager userManager, ILogger<SsoController> logger)
        {
            _userManager = userManager;
            _logger = logger;
            
            // Get plugin configuration
            var plugin = Plugin.Instance;
            _config = plugin?.Configuration as PluginConfiguration ?? new PluginConfiguration();
        }

        /// <summary>
        /// Validate SSO token from companion application
        /// </summary>
        [HttpPost("validate")]
        [AllowAnonymous]
        public async Task<ActionResult<ValidateSsoResponse>> ValidateToken([FromBody] ValidateSsoRequest request)
        {
            if (!_config.EnableSSO)
            {
                return BadRequest(new { error = "SSO is not enabled" });
            }

            if (string.IsNullOrEmpty(request?.Token))
            {
                return BadRequest(new { error = "Token is required" });
            }

            try
            {
                // Call companion app to validate token
                using var httpClient = new HttpClient();
                httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.SharedSecret);

                var validateUrl = $"{_config.CompanionBaseUrl}/api/auth/validate-sso";
                var content = new StringContent(
                    JsonSerializer.Serialize(new { token = request.Token }),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await httpClient.PostAsync(validateUrl, content);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("SSO token validation failed: {StatusCode}", response.StatusCode);
                    return Unauthorized(new { error = "Invalid token" });
                }

                var responseContent = await response.Content.ReadAsStringAsync();
                using var jsonDoc = JsonDocument.Parse(responseContent);
                var root = jsonDoc.RootElement;

                // Extract user information from companion app response
                var username = root.GetProperty("username").GetString();
                var email = root.GetProperty("email").GetString();
                var isAdmin = root.GetProperty("isAdmin").GetBoolean();

                if (string.IsNullOrEmpty(username))
                {
                    return BadRequest(new { error = "Invalid user information in token" });
                }

                // Find or create user
                var user = _userManager.GetUserByName(username);
                if (user == null)
                {
                    if (!_config.AutoCreateUsers)
                    {
                        return BadRequest(new { error = "User does not exist and auto-create is disabled" });
                    }

                    // Create new user with username
                    user = await _userManager.CreateUserAsync(username);
                    _logger.LogInformation("Created new SSO user: {Username}", username);
                }

                // Note: Admin status management requires Jellyfin.Data package which has changed API
                // For now, users can be manually promoted to admin in Jellyfin dashboard
                // TODO: Update when stable API is available

                return Ok(new ValidateSsoResponse
                {
                    Success = true,
                    UserId = user.Id.ToString(),
                    Username = username,
                    Message = "Token validated successfully"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating SSO token");
                return StatusCode(500, new { error = "Internal server error during token validation" });
            }
        }

        /// <summary>
        /// Get plugin configuration (admin only)
        /// </summary>
        [HttpGet("config")]
        [Authorize(Policy = "RequireAdministratorRole")]
        public ActionResult<SsoConfigResponse> GetConfig()
        {
            try
            {
                return Ok(new SsoConfigResponse
                {
                    Enabled = _config.EnableSSO,
                    CompanionUrl = _config.CompanionBaseUrl,
                    AutoCreateUsers = _config.AutoCreateUsers,
                    UpdateUserPolicies = _config.UpdateUserPolicies
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving SSO config");
                return StatusCode(500, new { error = "Internal server error" });
            }
        }

        /// <summary>
        /// Test connection to companion app
        /// </summary>
        [HttpGet("test")]
        [Authorize(Policy = "RequireAdministratorRole")]
        public async Task<ActionResult<TestConnectionResponse>> TestConnection()
        {
            try
            {
                using var httpClient = new HttpClient();
                httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.SharedSecret);
                httpClient.Timeout = TimeSpan.FromSeconds(10);

                var healthUrl = $"{_config.CompanionBaseUrl}/api/health";
                var response = await httpClient.GetAsync(healthUrl);

                if (response.IsSuccessStatusCode)
                {
                    return Ok(new TestConnectionResponse
                    {
                        Success = true,
                        Message = "Connection to companion app successful",
                        Timestamp = DateTime.UtcNow
                    });
                }
                else
                {
                    return BadRequest(new TestConnectionResponse
                    {
                        Success = false,
                        Message = $"Companion app returned status code: {response.StatusCode}",
                        Timestamp = DateTime.UtcNow
                    });
                }
            }
            catch (HttpRequestException ex)
            {
                _logger.LogError(ex, "Connection test failed");
                return BadRequest(new TestConnectionResponse
                {
                    Success = false,
                    Message = $"Failed to connect to companion app: {ex.Message}",
                    Timestamp = DateTime.UtcNow
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error testing connection");
                return StatusCode(500, new TestConnectionResponse
                {
                    Success = false,
                    Message = "Internal server error",
                    Timestamp = DateTime.UtcNow
                });
            }
        }
    }

    /// <summary>
    /// Request model for validating SSO token
    /// </summary>
    public class ValidateSsoRequest
    {
        public required string Token { get; set; }
    }

    /// <summary>
    /// Response model for SSO token validation
    /// </summary>
    public class ValidateSsoResponse
    {
        public bool Success { get; set; }
        public required string UserId { get; set; }
        public required string Username { get; set; }
        public required string Message { get; set; }
    }

    /// <summary>
    /// Response model for SSO configuration
    /// </summary>
    public class SsoConfigResponse
    {
        public bool Enabled { get; set; }
        public required string CompanionUrl { get; set; }
        public bool AutoCreateUsers { get; set; }
        public bool UpdateUserPolicies { get; set; }
    }

    /// <summary>
    /// Response model for connection test
    /// </summary>
    public class TestConnectionResponse
    {
        public bool Success { get; set; }
        public required string Message { get; set; }
        public DateTime Timestamp { get; set; }
    }
}
