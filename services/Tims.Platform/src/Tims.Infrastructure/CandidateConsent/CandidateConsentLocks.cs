using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// The #312 lock a writer takes before it re-checks "is this candidate's recruitment consent withdrawn". A withdrawal
/// takes the transaction-scoped advisory lock of the candidate ROW it withdraws
/// (<c>pg_advisory_xact_lock(hashtextextended(candidate_id, 0))</c>, <see cref="CandidateConsentRepository"/>), but the
/// withdrawn check is email-aware: a same-org candidate row with the same non-blank <c>lower(btrim(email))</c> (a
/// sibling) that carries a withdrawal counts too. Locking only the target's own id therefore let a sibling's withdrawal
/// commit between the check and the write (Codex P1, EssayGradingRepository). This takes the lock of the target AND of
/// every sibling, so any withdrawal of that person is either committed before the re-check (and seen) or waits until the
/// writer commits.
///
/// <para>Deadlock-free against the withdrawals: ids are locked in ascending uuid order, the same order
/// <c>WithdrawByEmailAsync</c> locks its rows in. A sibling row inserted while the locks are taken is picked up by a
/// re-read and locked too (rare; out of order, so a deadlock there is detected by Postgres and fails the writer, which
/// writes nothing).</para>
/// </summary>
public static class CandidateConsentLocks
{
    /// <summary>
    /// At most this many rows are locked (WithdrawByEmailAsync itself withdraws at most 20); more fails the caller
    /// closed instead of locking a partial set.
    /// </summary>
    public const int MaxRows = 50;

    public static async Task LockCandidateAndSiblingsAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(database);
        var locked = new HashSet<Guid>();
        for (var round = 0; round < 3; round++)
        {
            var ids = await SiblingIdsAsync(database, organizationId, candidateId, cancellationToken).ConfigureAwait(false);
            if (ids.Count > MaxRows)
            {
                // Fail closed: a set this large cannot be locked within the bound, and a partial set could leave out
                // a row whose withdrawal the caller's re-check counts. The caller writes nothing.
                throw new InvalidOperationException("Too many same-email candidate rows to lock for the #312 re-check.");
            }

            if (!ids.Contains(candidateId))
            {
                // No candidate row (a pipeline id): its own lock, as before. The target is ALWAYS locked.
                ids.Add(candidateId);
            }

            var added = false;
            foreach (var id in ids.Where(id => !locked.Contains(id)))
            {
                var key = id.ToString();
                await database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken).ConfigureAwait(false);
                locked.Add(id);
                added = true;
            }

            if (!added)
            {
                return;
            }
        }
    }

    // The target and every same-org row with the same non-blank normalized email, in ascending uuid order (Postgres's,
    // which is what WithdrawByEmailAsync's ORDER BY uses). The target is included whenever its row exists.
    private static Task<List<Guid>> SiblingIdsAsync(
        DatabaseFacade database, Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        database.SqlQuery<Guid>(
                $"""
                 SELECT other.id AS "Value"
                   FROM candidates AS other
                   JOIN candidates AS target ON target.organization_id = other.organization_id
                  WHERE target.id = {candidateId} AND target.organization_id = {organizationId}
                    AND (other.id = target.id
                         OR (btrim(target.email) <> '' AND lower(btrim(other.email)) = lower(btrim(target.email))))
                  ORDER BY other.id
                  LIMIT {MaxRows + 1}
                 """)
            .ToListAsync(cancellationToken);
}
