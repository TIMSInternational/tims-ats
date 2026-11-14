using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The erasure sweep's work queue (<c>assessment_provider_subject_checks</c>): which subjects still hold stored results,
/// when each is due, and when each was last attempted. Every predicate is judged by the DATABASE clock, so instances with
/// skewed clocks agree.
/// </summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task<IReadOnlyList<SubjectErasureCheck>> ListSubjectsDueForErasureCheckAsync(
        int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection (no TenantScope), like ListOrganizationsWithPollableAttemptsAsync: only
        // ids and the attempt stamp leave this query; each subject is then claimed and erased under its own tenant scope.
        var rows = await _db.Database.SqlQuery<DueSubject>(
                $"""
                 SELECT s.organization_id AS "OrganizationId", s.provider_subject_id AS "ProviderSubjectId",
                        c.last_attempted_at AS "LastAttemptedAt"
                   FROM (SELECT DISTINCT a.organization_id, a.provider_subject_id
                           FROM assessment_provider_attempts a
                          WHERE a.provider_subject_id IS NOT NULL
                            AND EXISTS (SELECT 1 FROM assessment_provider_results r
                                         WHERE r.organization_id = a.organization_id AND r.attempt_id = a.id)) s
                   LEFT JOIN assessment_provider_subject_checks c
                     ON c.organization_id = s.organization_id AND c.provider_subject_id = s.provider_subject_id
                  WHERE c.next_check_at IS NULL OR c.next_check_at <= clock_timestamp()
                  ORDER BY c.last_attempted_at NULLS FIRST, s.organization_id, s.provider_subject_id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new SubjectErasureCheck(r.OrganizationId, r.ProviderSubjectId, ToOffset(r.LastAttemptedAt)))
            .ToList();
    }

    public async Task<DateTimeOffset?> ClaimSubjectErasureCheckAsync(
        Guid organizationId, Guid providerSubjectId, CancellationToken cancellationToken)
    {
        var lease = ProviderErasureSweepSettings.ClaimLease.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // ONE statement: a concurrent claim of the same subject waits on the row (or the conflicting insert) and then
        // re-checks the next_check_at it committed, which is a lease ahead, so it claims nothing.
        var stamped = await _db.Database.SqlQuery<DateTime>(
                $"""
                 INSERT INTO assessment_provider_subject_checks AS c
                        (organization_id, provider_subject_id, last_attempted_at, next_check_at)
                 VALUES ({organizationId}, {providerSubjectId}, clock_timestamp(),
                         clock_timestamp() + make_interval(secs => {lease}))
                 ON CONFLICT (organization_id, provider_subject_id) DO UPDATE
                    SET last_attempted_at = clock_timestamp(),
                        next_check_at = clock_timestamp() + make_interval(secs => {lease})
                  WHERE c.next_check_at <= clock_timestamp()
                 RETURNING c.last_attempted_at AS "Value"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return stamped.Count == 0 ? null : new DateTimeOffset(DateTime.SpecifyKind(stamped[0], DateTimeKind.Utc));
    }

    public async Task RecordSubjectErasureCheckAsync(
        Guid organizationId, Guid providerSubjectId, DateTimeOffset claimedAt, bool conclusive, TimeSpan checkInterval,
        CancellationToken cancellationToken)
    {
        var claimed = claimedAt.UtcDateTime;
        var interval = checkInterval.TotalSeconds;
        var backoff = ProviderErasureSweepSettings.RetryBackoff.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        if (conclusive)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE assessment_provider_subject_checks
                    SET last_checked_at = last_attempted_at, consecutive_failures = 0,
                        next_check_at = last_attempted_at + make_interval(secs => {interval})
                  WHERE organization_id = {organizationId} AND provider_subject_id = {providerSubjectId}
                    AND last_attempted_at = {claimed}
                 """, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            // The backoff doubles per consecutive failure (the exponent capped, so it can never overflow) and never
            // exceeds the interval; last_attempted_at stays the claim, so the subject also waits behind every other one.
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE assessment_provider_subject_checks
                    SET consecutive_failures = consecutive_failures + 1,
                        next_check_at = last_attempted_at + make_interval(secs => LEAST(
                            {interval}::double precision,
                            {backoff}::double precision * power(2, LEAST(consecutive_failures, 20))))
                  WHERE organization_id = {organizationId} AND provider_subject_id = {providerSubjectId}
                    AND last_attempted_at = {claimed}
                 """, cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private sealed class DueSubject
    {
        public Guid OrganizationId { get; set; }

        public Guid ProviderSubjectId { get; set; }

        public DateTime? LastAttemptedAt { get; set; }
    }
}
