namespace Tims.Application.Identity;

/// <summary>
/// The minimal shape the external-auth path needs from an ACTIVE key row. NEVER includes the
/// key hash. <see cref="RawScopesJson"/> is the raw JSON text of the Prisma <c>scopes</c> column,
/// parsed (fail-closed) by <see cref="Tims.Domain.Identity.ApiKeyScopes.ParseScopes"/> in the resolver.
/// </summary>
public sealed record ActiveApiKey(string ApiKeyId, string OrganizationId, string? RawScopesJson);

/// <summary>
/// Read-only port over the Prisma-OWNED `api_keys` + `organizations` tables (efcoreReadOnly in
/// docs/architecture/table-ownership.md). Implemented in Tims.Infrastructure by an EF Core context
/// that NEVER writes these rows. This is the privileged, pre-tenant lookup that resolves an
/// external `tims_` API key to its principal — it runs before any tenant context exists, so it does
/// not go through the RLS <c>TenantScope</c>.
/// </summary>
public interface IApiKeyRepository
{
    /// <summary>
    /// Faithful port of external-auth.repository.ts <c>findActiveApiKeyByHash</c>: returns the
    /// active key matching <paramref name="keyHash"/> (not revoked, and either no expiry or an
    /// expiry still in the future at <paramref name="now"/>) ONLY when its owning organization is
    /// active and not soft-deleted (suspended-org lockout). Selects only id/organization_id/scopes;
    /// never the hash. Returns null (fail closed) for every missing/expired/revoked/suspended case.
    /// </summary>
    Task<ActiveApiKey?> FindActiveByHashAsync(string keyHash, DateTime now, CancellationToken ct);
}
