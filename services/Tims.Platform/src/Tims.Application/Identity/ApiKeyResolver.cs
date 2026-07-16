using Tims.Domain.Identity;

namespace Tims.Application.Identity;

/// <summary>
/// Orchestrates external `tims_` API-key resolution — the use-case port of
/// resolveApiKeyPrincipal + buildExternalAccessUser (packages/api/src/access/external-auth.ts).
/// Steps (each fails CLOSED to null): extract the bearer token from the Authorization header →
/// hash it → look up an ACTIVE key on an active org (IO, via <see cref="IApiKeyRepository"/>) →
/// parse scopes (malformed → null) → build the <see cref="TenantContext"/>.
///
/// The resolved principal has <see cref="PrincipalType.ExternalApiKey"/>: the key IS the principal
/// (no User row), UserId = api key id (audit actor / rate-limit key), Roles = ['external'], and the
/// parsed per-key scopes. Never a platform owner.
/// </summary>
public sealed class ApiKeyResolver(IApiKeyRepository apiKeys)
{
    private static readonly IReadOnlyList<string> ExternalRoles = new[] { "external" };

    private readonly IApiKeyRepository _apiKeys = apiKeys;

    /// <summary>
    /// Resolves the external <see cref="TenantContext"/> for the given raw Authorization header
    /// value at <paramref name="now"/>, or null (fail closed) for any missing/malformed/expired/
    /// revoked/suspended-org/malformed-scopes condition.
    /// </summary>
    public async Task<TenantContext?> ResolveAsync(
        string? authorizationHeaderValue,
        DateTime now,
        CancellationToken ct)
    {
        var token = BearerToken.ExtractBearerToken(authorizationHeaderValue);
        if (token is null)
        {
            return null;
        }

        var row = await _apiKeys.FindActiveByHashAsync(ApiKeyHash.Sha256Hex(token), now, ct);
        if (row is null)
        {
            return null;
        }

        var scopes = ApiKeyScopes.ParseScopes(row.RawScopesJson);
        if (scopes is null)
        {
            return null; // malformed scopes → fail closed (deny auth)
        }

        return new TenantContext(
            PrincipalType: PrincipalType.ExternalApiKey,
            OrganizationId: row.OrganizationId,
            UserId: row.ApiKeyId,
            Roles: ExternalRoles,
            ApiKeyScopes: scopes);
    }
}
