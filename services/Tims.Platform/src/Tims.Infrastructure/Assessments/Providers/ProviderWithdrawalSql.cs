using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The one statement that puts a #312 withdrawal into the provider tables (owner default D15, 2026-11-08). It runs
/// inside the caller's transaction, which must already hold the per-candidate advisory lock
/// (<c>pg_advisory_xact_lock(hashtextextended(candidate_id, 0))</c>) that the withdrawal, the assignment reserve and
/// the result store all take. So it is atomic with the withdrawal itself: the consent row and the attempts change in
/// one commit, and no reserve or result store of that candidate can interleave.
///
/// <para>Every attempt of the candidate (and of a same-org candidate with the same non-blank <c>lower(btrim(email))</c>,
/// the #312 sibling predicate) not yet in the cascade and not erased becomes <c>withdrawal_state = pending</c>. One that
/// has not finished is cancelled locally; if it is mapped to a provider assignment it also gets the
/// <c>provider_cancel_pending</c> marker, so the cancel at the provider is retried until confirmed. A finished attempt
/// keeps its state and its stored result (#312 deletes nothing: that is a human DSAR decision), but no result is
/// fetched or stored for it again.</para>
/// </summary>
public static class ProviderWithdrawalSql
{
    public static Task<int> StageAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, DateTime timestamp,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(database);
        // The #312 repository stores `timestamp without time zone` values (Kind Unspecified, UTC by convention); this
        // column is timestamptz, which Npgsql writes only from a UTC DateTime.
        var updatedAt = DateTime.SpecifyKind(timestamp, DateTimeKind.Utc);
        return database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts AS a
                SET state = CASE WHEN a.state IN ('pending_create', 'created', 'launched', 'in_progress')
                                 THEN 'cancelled' ELSE a.state END,
                    last_error_code = CASE WHEN a.state IN ('created', 'launched', 'in_progress')
                                                AND a.provider_assignment_id IS NOT NULL
                                           THEN 'provider_cancel_pending' ELSE a.last_error_code END,
                    withdrawal_state = 'pending',
                    updated_at = {updatedAt}
              WHERE a.organization_id = {organizationId}
                AND a.withdrawal_state IS NULL
                AND a.state <> 'erased'
                AND (a.candidate_id = {candidateId}
                     OR a.candidate_id IN (
                         SELECT other.id
                           FROM candidates AS other
                           JOIN candidates AS target ON target.organization_id = other.organization_id
                          WHERE target.id = {candidateId}
                            AND target.organization_id = {organizationId}
                            AND btrim(target.email) <> ''
                            AND lower(btrim(other.email)) = lower(btrim(target.email))))
             """,
            cancellationToken);
    }
}
