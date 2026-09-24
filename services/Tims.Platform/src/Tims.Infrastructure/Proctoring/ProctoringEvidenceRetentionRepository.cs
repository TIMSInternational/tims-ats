using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;

namespace Tims.Infrastructure.Proctoring;

public sealed record DueProctoringEvidence(Guid OrganizationId, Guid EvidenceId,
    string StagingObjectKey, string? SealedObjectKey);

/// <summary>
/// Cross-tenant bootstrap returns organization IDs only. Every evidence read
/// and state change then runs under app_tenant RLS for that organization.
/// Deletion itself is idempotent and occurs outside the database transaction.
/// </summary>
public sealed class ProctoringEvidenceRetentionRepository(ProctoringDbContext db)
{
    private readonly ProctoringDbContext _db = db;

    public Task<Guid[]> ListDueOrganizationIdsAsync(int limit, CancellationToken ct)
    {
        if (limit is < 1 or > 10_000) throw new ArgumentOutOfRangeException(nameof(limit));
        var now = DbNow();
        var staleIntent = now.AddMinutes(-5);
        // This is the sole privileged cross-org read: IDs only, no media or PII.
        return _db.Evidence.AsNoTracking()
            .Where(row => row.DeletedAt == null
                && ((row.ExpiresAt != null && row.ExpiresAt <= now)
                    || (row.ExpiresAt == null && row.IntentExpiresAt <= staleIntent)))
            .Select(row => row.OrganizationId).Distinct().OrderBy(id => id)
            .Take(limit).ToArrayAsync(ct);
    }

    public async Task<IReadOnlyList<DueProctoringEvidence>> ExpireDueAsync(
        Guid organizationId, int limit, IReadOnlyCollection<Guid> visitedIds,
        CancellationToken ct)
    {
        if (organizationId == Guid.Empty || limit is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(limit));
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        var now = DbNow();
        var staleIntent = now.AddMinutes(-5);
        var excluded = visitedIds.ToArray();
        var rows = await _db.Evidence.AsNoTracking()
            .Where(row => row.OrganizationId == organizationId && row.DeletedAt == null
                && !excluded.Contains(row.Id)
                && ((row.ExpiresAt != null && row.ExpiresAt <= now)
                    || (row.ExpiresAt == null && row.IntentExpiresAt <= staleIntent)))
            .OrderBy(row => row.ExpiresAt).ThenBy(row => row.Id)
            .Take(limit).ToArrayAsync(ct);

        var due = new List<DueProctoringEvidence>(rows.Length);
        foreach (var row in rows)
        {
            if (row.Status != "expired")
            {
                var changed = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE proctoring_evidence
                       SET status = 'expired', updated_at = {Timestamp(now)}
                     WHERE id = {row.Id} AND organization_id = {organizationId}
                       AND status = {row.Status} AND deleted_at IS NULL
                       AND ((expires_at IS NOT NULL AND expires_at <= {Timestamp(now)})
                         OR (expires_at IS NULL AND intent_expires_at <= {Timestamp(staleIntent)}))
                    """, ct);
                if (changed != 1) continue;
            }
            due.Add(new DueProctoringEvidence(organizationId, row.Id,
                row.StagingObjectKey, row.SealedObjectKey));
        }
        await tenant.CommitAsync(ct);
        return due;
    }

    public async Task MarkDeletedAsync(Guid organizationId, Guid evidenceId,
        CancellationToken ct)
    {
        await using var tenant = await TenantScope.BeginAsync(_db, organizationId, ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE proctoring_evidence
               SET deleted_at = {Timestamp(DbNow())}, updated_at = {Timestamp(DbNow())}
             WHERE id = {evidenceId} AND organization_id = {organizationId}
               AND status = 'expired' AND deleted_at IS NULL
            """, ct);
        await tenant.CommitAsync(ct);
    }

    private static DateTime DbNow() =>
        DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified);

    private static NpgsqlParameter Timestamp(DateTime value) => new()
    {
        NpgsqlDbType = NpgsqlDbType.Timestamp,
        Value = value,
    };
}
