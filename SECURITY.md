# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in JellySSO, please **do not** open a public issue. Instead:

1. **Email** the security concern to the maintainers (check repository for contact info)
2. **Include details** about the vulnerability and potential impact
3. **Allow time** for the team to investigate and prepare a fix

We appreciate your responsible disclosure and will acknowledge your report promptly.

## Security Best Practices

### For Deployment

- **Use HTTPS** in production (`USE_HTTPS=true`)
- **Set strong secrets**: Use cryptographically secure random values for:
  - `SESSION_SECRET`
  - `SHARED_SECRET`
  - `JWT_SECRET`
  - `OIDC_CLIENT_SECRET`
- **Environment variables**: Store all secrets in `.env` file (never commit to git)
- **Keep dependencies updated**: Regularly run `npm audit` and update packages
- **Monitor logs**: Review audit logs regularly for suspicious activity

### For Users

- **Strong passwords**: Enforce strong password policies in Jellyfin
- **OIDC integration**: Use trusted OIDC providers with proper validation
- **Rate limiting**: Default 100 requests/15min per IP is enabled
- **Session timeout**: Default 24-hour session timeout is configured
- **Audit logging**: All admin actions are logged with timestamps and IPs

## Security Features

JellySSO includes built-in protections:

- ✅ **CSRF Protection**: Token validation on state-changing requests
- ✅ **Session Security**: HTTP-only, SameSite cookies
- ✅ **Input Validation**: All endpoints validate and sanitize input
- ✅ **Rate Limiting**: Prevents brute force attacks
- ✅ **Audit Logging**: Complete activity tracking
- ✅ **Error Handling**: No sensitive information leakage in errors
- ✅ **Security Headers**: Helmet.js provides comprehensive header protection
- ✅ **Authentication**: Multi-layer auth (session + role-based access)

## Dependency Security

- Dependencies are regularly audited
- Security patches are applied promptly
- Use `npm audit` to check for vulnerabilities in your installation

## Compliance

JellySSO is designed with security best practices in mind but is provided as-is. Ensure your deployment meets your organization's security requirements.

## Questions?

For security-related questions or concerns, please reach out to the maintainers privately.
