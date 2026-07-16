using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Tims.Application.Identity;

namespace Tims.Api.Authentication;

/// <summary>
/// Authenticates an external integration presenting <c>Authorization: Bearer tims_...</c>. Delegates
/// entirely to the fail-closed <see cref="ApiKeyResolver"/> (extract → hash → active-key + active-org
/// lookup → parse scopes); on success it issues a <see cref="ClaimsPrincipal"/> carrying the org id,
/// the api key id, and the parsed scopes. Any missing/malformed/expired/revoked/suspended-org
/// condition yields <see cref="AuthenticateResult.NoResult"/> → the authorization layer returns 401.
/// This is the API-key analog of the JWT scheme; it never writes and never issues a User principal.
/// </summary>
public sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    ApiKeyResolver resolver)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiKey";

    public const string OrganizationIdClaimType = "org_id";
    public const string ApiKeyIdClaimType = "api_key_id";
    public const string ScopeClaimType = "scope";

    private readonly ApiKeyResolver _resolver = resolver;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();

        var tenant = await _resolver.ResolveAsync(header, DateTime.UtcNow, Context.RequestAborted);
        if (tenant is null)
        {
            // Fail closed: no valid credential. NoResult (not Fail) lets the challenge surface a
            // clean 401 without leaking why the key was rejected.
            return AuthenticateResult.NoResult();
        }

        var claims = new List<Claim>
        {
            new(OrganizationIdClaimType, tenant.OrganizationId),
            new(ApiKeyIdClaimType, tenant.UserId),
        };
        foreach (var scope in tenant.ApiKeyScopes ?? [])
        {
            claims.Add(new Claim(ScopeClaimType, scope));
        }

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);
        return AuthenticateResult.Success(ticket);
    }
}
