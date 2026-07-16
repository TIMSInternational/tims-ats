namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `api_keys` table (only the columns the external-auth
/// path needs). Never written by this backend — see <see cref="IdentityDbContext"/>.
/// <see cref="Scopes"/> is the raw JSON text of the `scopes` (jsonb) column; it is parsed
/// fail-closed by <see cref="Tims.Domain.Identity.ApiKeyScopes.ParseScopes"/> in the resolver.
/// </summary>
public sealed class ApiKeyEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string KeyHash { get; set; } = string.Empty;

    public string Scopes { get; set; } = string.Empty;

    public DateTime? RevokedAt { get; set; }

    public DateTime? ExpiresAt { get; set; }
}
