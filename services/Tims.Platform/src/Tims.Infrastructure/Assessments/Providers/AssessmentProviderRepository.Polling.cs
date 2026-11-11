using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The D17 polling fallback's work queue: leases on stale attempts (claim, release) and the consent purposes the
/// provider still lacks. Every predicate is judged by the DATABASE clock, so two instances with skewed clocks agree.
/// </summary>
public sealed partial class AssessmentProviderRepository
{
    // The claimable predicate (the same text in the org listing and in the claim; every value a bound parameter).
    // Mapped attempts only, never one in a #312 cascade, an ATS-requested erasure or an orphan cleanup (those have their
    // own retries); the lease free or expired; and stale: a sitting state untouched (no write, no poll) for StaleAfter,
    // a created/launched one only until a week after its expiry (the provider then reports it expired), and an attempt
    // holding a stored result (result_ready, or voided/expired by a revision) re-read for revisions every
    // ResultRevisionStaleAfter during ResultRevisionWindow after completion.
    private static readonly string[] SittingStates = [.. ProviderAttemptPolling.SittingStates];

    private static readonly string[] RevisionStates = [.. ProviderAttemptPolling.RevisionStates];

    private static readonly string[] NotStartedStates = [ProviderAttemptStates.Created, ProviderAttemptStates.Launched];

    public async Task<IReadOnlyList<Guid>> ListOrganizationsWithPollableAttemptsAsync(int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection (no TenantScope), like ListOrganizationsWithPendingWithdrawalsAsync:
        // only organization ids leave this query; each is then claimed under its own tenant scope.
        // Fairness (Codex ATS P2): ordered by the org's most recent visit (the latest last_polled_at over ALL its
        // attempts; never visited first), not by id. A visit stamps last_polled_at on what it claimed, so a visited org
        // goes to the back even while it keeps more pollable work than one run takes (MaxAttemptsPerOrganization): with
        // ORDER BY id, an org past the first MaxOrganizations ids was never visited at all.
        var (stale, revisionStale, window) = PollIntervals();
        return await _db.Database.SqlQuery<Guid>(
                $"""
                 SELECT o.organization_id AS "Value"
                   FROM (
                 SELECT DISTINCT p.organization_id
                   FROM assessment_provider_attempts p
                  WHERE p.provider_assignment_id IS NOT NULL AND p.withdrawal_state IS NULL
                    AND p.provider_erasure_requested_at IS NULL
                    AND p.last_error_code IS DISTINCT FROM {ProviderCleanup.CancelPending}
                    AND (p.poll_lease_until IS NULL OR p.poll_lease_until < clock_timestamp())
                    AND ((p.state = ANY({SittingStates})
                          AND GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity'))
                              < clock_timestamp() - make_interval(secs => {stale})
                          AND (p.state <> ALL({NotStartedStates}) OR p.expires_at IS NULL
                               OR p.expires_at > clock_timestamp() - interval '7 days'))
                      OR (p.state = ANY({RevisionStates}) AND p.latest_result_id IS NOT NULL
                          AND COALESCE(p.completed_at, p.updated_at) > clock_timestamp() - make_interval(secs => {window})
                          AND GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity'))
                              < clock_timestamp() - make_interval(secs => {revisionStale})))
                        ) o
                  ORDER BY (SELECT max(v.last_polled_at) FROM assessment_provider_attempts v
                             WHERE v.organization_id = o.organization_id) NULLS FIRST,
                           o.organization_id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<PolledAttempt>> ClaimPollableAttemptsAsync(
        Guid organizationId, Guid owner, int max, CancellationToken cancellationToken)
    {
        var (stale, revisionStale, window) = PollIntervals();
        var lease = ProviderAttemptPolling.LeaseDuration.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // ONE statement: the subquery locks the rows it picks (SKIP LOCKED: a row another poller is claiming right now is
        // skipped, never waited for), and a row another poller claimed and committed meanwhile is re-checked against its
        // new version, whose live lease excludes it. So no attempt is ever leased to two owners at once. The pick is a
        // MATERIALIZED CTE: as an `id IN (subquery LIMIT n)` semi-join the planner may re-run the subquery per outer
        // row, and with SKIP LOCKED each run can pick a different row, so more than `max` rows were claimed (seen with
        // max = 1: the poller then polled one and left the other leased, unpolled, until its lease ran out).
        var claimed = await _db.Database.SqlQuery<Guid>(
                $"""
                 WITH picked AS MATERIALIZED (
                        SELECT p.id FROM assessment_provider_attempts p
                         WHERE p.organization_id = {organizationId}
                           AND p.provider_assignment_id IS NOT NULL AND p.withdrawal_state IS NULL
                           AND p.provider_erasure_requested_at IS NULL
                           AND p.last_error_code IS DISTINCT FROM {ProviderCleanup.CancelPending}
                           AND (p.poll_lease_until IS NULL OR p.poll_lease_until < clock_timestamp())
                           AND ((p.state = ANY({SittingStates})
                                 AND GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity'))
                                     < clock_timestamp() - make_interval(secs => {stale})
                                 AND (p.state <> ALL({NotStartedStates}) OR p.expires_at IS NULL
                                      OR p.expires_at > clock_timestamp() - interval '7 days'))
                             OR (p.state = ANY({RevisionStates}) AND p.latest_result_id IS NOT NULL
                                 AND COALESCE(p.completed_at, p.updated_at)
                                     > clock_timestamp() - make_interval(secs => {window})
                                 AND GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity'))
                                     < clock_timestamp() - make_interval(secs => {revisionStale})))
                         ORDER BY GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity')), p.id
                         LIMIT {max}
                         FOR UPDATE SKIP LOCKED)
                 UPDATE assessment_provider_attempts a
                    SET poll_lease_owner = {owner},
                        poll_lease_until = clock_timestamp() + make_interval(secs => {lease})
                   FROM picked
                  WHERE a.organization_id = {organizationId} AND a.id = picked.id
                 RETURNING a.id AS "Value"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var rows = claimed.Count == 0
            ? []
            : await (
                    from a in _db.Attempts.AsNoTracking()
                    where a.OrganizationId == organizationId && claimed.Contains(a.Id)
                    join b in _db.Bindings.AsNoTracking() on a.BindingId equals b.Id
                    orderby a.UpdatedAt, a.Id
                    select new { Attempt = a, b.ProviderTenantId })
                .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new PolledAttempt(ToRow(r.Attempt, isNew: false), r.ProviderTenantId)).ToList();
    }

    private static (double Stale, double RevisionStale, double Window) PollIntervals() =>
        (ProviderAttemptPolling.StaleAfter.TotalSeconds, ProviderAttemptPolling.ResultRevisionStaleAfter.TotalSeconds,
            ProviderAttemptPolling.ResultRevisionWindow.TotalSeconds);

    public async Task ReleasePollLeaseAsync(Guid organizationId, Guid attemptId, Guid owner, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET poll_lease_owner = NULL, poll_lease_until = NULL, last_polled_at = clock_timestamp()
              WHERE organization_id = {organizationId} AND id = {attemptId} AND poll_lease_owner = {owner}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<UnconfirmedCancel>> ListUnconfirmedCancelsAsync(int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection, like the org listing above: only ids leave; each attempt is then read
        // and confirmed under its own tenant scope. Oldest first, so one that keeps failing (stamped by
        // TouchUnconfirmedCancelAsync) never starves the rest.
        var stale = ProviderAttemptPolling.StaleAfter.TotalSeconds;
        var rows = await _db.Database.SqlQuery<UnconfirmedCancelRow>(
                $"""
                 SELECT p.organization_id AS "OrganizationId", p.id AS "AttemptId"
                   FROM assessment_provider_attempts p
                  WHERE p.state = 'cancelled' AND p.last_error_code = {ProviderCleanup.CancelPending}
                    AND p.withdrawal_state IS DISTINCT FROM 'pending'
                    AND GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity'))
                        < clock_timestamp() - make_interval(secs => {stale})
                  ORDER BY GREATEST(p.updated_at, COALESCE(p.last_polled_at, '-infinity')), p.id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new UnconfirmedCancel(r.OrganizationId, r.AttemptId)).ToList();
    }

    public async Task TouchUnconfirmedCancelAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts SET last_polled_at = clock_timestamp()
              WHERE organization_id = {organizationId} AND id = {attemptId} AND state = 'cancelled'
                AND last_error_code = {ProviderCleanup.CancelPending}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private sealed class UnconfirmedCancelRow
    {
        public Guid OrganizationId { get; init; }

        public Guid AttemptId { get; init; }
    }

    public async Task SetMissingConsentsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> missingConsents, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(missingConsents);
        var missing = missingConsents.Where(ConsentPurposes.IsKnown).Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal).ToArray();
        var open = ProviderAttemptStates.Open.ToArray();
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts SET missing_consents = {missing}
              WHERE organization_id = {organizationId} AND id = {attemptId} AND state = ANY({open})
                AND missing_consents IS DISTINCT FROM {missing}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }
}
