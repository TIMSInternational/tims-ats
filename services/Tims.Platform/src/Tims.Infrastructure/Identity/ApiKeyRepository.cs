using Microsoft.EntityFrameworkCore;
using Tims.Application.Identity;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// EF Core implementation of <see cref="IApiKeyRepository"/> over <see cref="IdentityDbContext"/>.
/// Faithful port of external-auth.repository.ts <c>findActiveApiKeyByHash</c>: strictly read-only
/// (<c>AsNoTracking</c>, no writes), selects only the principal fields (id/organization_id/scopes —
/// NEVER the hash), and fails closed when the owning organization is suspended or soft-deleted.
/// </summary>
public sealed class ApiKeyRepository(IdentityDbContext db) : IApiKeyRepository
{
    private readonly IdentityDbContext _db = db;

    public async Task<ActiveApiKey?> FindActiveByHashAsync(string keyHash, DateTime now, CancellationToken ct)
    {
        // Active-key gate: matching hash, not revoked, and either no expiry (never expires) or an
        // expiry still in the future. Never selects key_hash.
        var key = await _db.ApiKeys
            .AsNoTracking()
            .Where(k => k.KeyHash == keyHash
                && k.RevokedAt == null
                && (k.ExpiresAt == null || k.ExpiresAt >= now))
            .Select(k => new { k.Id, k.OrganizationId, k.Scopes })
            .FirstOrDefaultAsync(ct);

        if (key is null)
        {
            return null;
        }

        // Suspended-org lockout: a suspended (is_active=false) or soft-deleted (deleted_at≠null)
        // tenant's keys must immediately stop exporting data, without needing each key revoked.
        var orgActive = await _db.Organizations
            .AsNoTracking()
            .AnyAsync(o => o.Id == key.OrganizationId && o.IsActive && o.DeletedAt == null, ct);

        if (!orgActive)
        {
            return null;
        }

        return new ActiveApiKey(key.Id.ToString(), key.OrganizationId.ToString(), key.Scopes);
    }
}
