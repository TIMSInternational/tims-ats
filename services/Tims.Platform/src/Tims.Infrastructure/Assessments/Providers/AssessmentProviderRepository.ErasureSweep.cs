using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The erasure sweep's work queue (<c>assessment_provider_subject_checks</c>): which subjects still hold stored results and
/// when each was last asked about. Every predicate is judged by the DATABASE clock, so instances with skewed clocks agree.
/// </summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task<IReadOnlyList<SubjectErasureCheck>> ListSubjectsDueForErasureCheckAsync(
        TimeSpan checkInterval, int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection (no TenantScope), like ListOrganizationsWithPollableAttemptsAsync: only
        // ids and the check stamp leave this query; each subject is then claimed and erased under its own tenant scope.
        var seconds = checkInterval.TotalSeconds;
        var rows = await _db.Database.SqlQuery<DueSubject>(
                $"""
                 SELECT s.organization_id AS "OrganizationId", s.provider_subject_id AS "ProviderSubjectId",
                        c.last_checked_at AS "LastCheckedAt"
                   FROM (SELECT DISTINCT a.organization_id, a.provider_subject_id
                           FROM assessment_provider_attempts a
                          WHERE a.provider_subject_id IS NOT NULL
                            AND EXISTS (SELECT 1 FROM assessment_provider_results r
                                         WHERE r.organization_id = a.organization_id AND r.attempt_id = a.id)) s
                   LEFT JOIN assessment_provider_subject_checks c
                     ON c.organization_id = s.organization_id AND c.provider_subject_id = s.provider_subject_id
                  WHERE c.last_checked_at IS NULL
                     OR c.last_checked_at <= clock_timestamp() - make_interval(secs => {seconds})
                  ORDER BY c.last_checked_at NULLS FIRST, s.organization_id, s.provider_subject_id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new SubjectErasureCheck(r.OrganizationId, r.ProviderSubjectId, ToOffset(r.LastCheckedAt)))
            .ToList();
    }

    public async Task<DateTimeOffset?> ClaimSubjectErasureCheckAsync(
        Guid organizationId, Guid providerSubjectId, TimeSpan checkInterval, CancellationToken cancellationToken)
    {
        var seconds = checkInterval.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // ONE statement: a concurrent claim of the same subject waits on the row (or the conflicting insert) and then
        // re-checks the stamp it committed, which is no longer due, so it claims nothing.
        var stamped = await _db.Database.SqlQuery<DateTime>(
                $"""
                 INSERT INTO assessment_provider_subject_checks AS c (organization_id, provider_subject_id, last_checked_at)
                 VALUES ({organizationId}, {providerSubjectId}, clock_timestamp())
                 ON CONFLICT (organization_id, provider_subject_id) DO UPDATE
                    SET last_checked_at = clock_timestamp()
                  WHERE c.last_checked_at IS NULL
                     OR c.last_checked_at <= clock_timestamp() - make_interval(secs => {seconds})
                 RETURNING c.last_checked_at AS "Value"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return stamped.Count == 0 ? null : new DateTimeOffset(DateTime.SpecifyKind(stamped[0], DateTimeKind.Utc));
    }

    public async Task ReleaseSubjectErasureCheckAsync(
        Guid organizationId, Guid providerSubjectId, DateTimeOffset claimedAt, DateTimeOffset? previous,
        CancellationToken cancellationToken)
    {
        var claimed = claimedAt.UtcDateTime;
        var restored = previous?.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_subject_checks SET last_checked_at = {restored}
              WHERE organization_id = {organizationId} AND provider_subject_id = {providerSubjectId}
                AND last_checked_at = {claimed}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private sealed class DueSubject
    {
        public Guid OrganizationId { get; set; }

        public Guid ProviderSubjectId { get; set; }

        public DateTime? LastCheckedAt { get; set; }
    }
}
