using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// Privileged maintenance only: enumerates tenant IDs without text, then
/// deletes expired rows with an explicit tenant predicate. app_tenant has no
/// DELETE grant, so candidate/staff request contexts cannot use this path.
/// </summary>
public sealed class CandidateExplanationRetentionRepository(ProctoringDbContext db)
{
    private readonly ProctoringDbContext _db = db;

    public Task<Guid[]> ListDueOrganizationIdsAsync(int limit, CancellationToken ct)
    {
        if (limit is < 1 or > 10_000) throw new ArgumentOutOfRangeException(nameof(limit));
        var now = DbNow();
        return _db.CandidateExplanations.AsNoTracking()
            .Where(row => row.ExpiresAt <= now)
            .Select(row => row.OrganizationId).Distinct().OrderBy(id => id)
            .Take(limit).ToArrayAsync(ct);
    }

    public async Task<int> DeleteDueAsync(Guid organizationId, int limit, CancellationToken ct)
    {
        if (organizationId == Guid.Empty || limit is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(limit));
        var now = DbNow();
        var ids = await _db.CandidateExplanations.AsNoTracking()
            .Where(row => row.OrganizationId == organizationId && row.ExpiresAt <= now)
            .OrderBy(row => row.ExpiresAt).ThenBy(row => row.Id)
            .Select(row => row.Id).Take(limit).ToArrayAsync(ct);
        if (ids.Length == 0) return 0;
        return await _db.CandidateExplanations
            .Where(row => row.OrganizationId == organizationId && ids.Contains(row.Id)
                && row.ExpiresAt <= now)
            .ExecuteDeleteAsync(ct);
    }

    private static DateTime DbNow() => DateTime.SpecifyKind(DateTime.UtcNow,
        DateTimeKind.Unspecified);
}
