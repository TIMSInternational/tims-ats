using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>#312 withdrawal cascade (D15), DSAR export and ATS-initiated erasure of provider subjects.</summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task<int> StageConsentWithdrawalAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await CandidateConsentLocks.LockCandidateAndSiblingsAsync(_db.Database, organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        if (!await IsWithdrawnAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return 0;
        }

        var staged = await ProviderWithdrawalSql.StageAsync(
            _db.Database, organizationId, candidateId, now.UtcDateTime, cancellationToken).ConfigureAwait(false);
        if (staged > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_withdrawal_staged", candidateId, new Dictionary<string, object?>
            {
                ["attempts"] = staged,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return staged;
    }

    public async Task<IReadOnlyList<Guid>> ListOrganizationsWithPendingWithdrawalsAsync(int max, CancellationToken cancellationToken)
    {
        // PRE-TENANT on the privileged connection (no TenantScope), like FindAttemptOwnerAsync: only org ids leave it,
        // served by the partial index ix_assessment_provider_attempts_withdrawal_pending. Ordered by each organization's
        // OLDEST pending attempt (then id), not by id: a pass defers what it leaves pending (DeferPendingWithdrawalsAsync),
        // so an organization whose attempts keep failing moves behind the others and the bound can never starve the
        // organizations after it (Codex release round 3 [P2]).
        // Attempts another pass holds under a live lease are skipped (by the database clock), so a sweep does not visit an
        // organization whose pending work is already being done elsewhere.
        return await _db.Database.SqlQuery<Guid>(
                $"""
                 SELECT organization_id AS "Value"
                   FROM assessment_provider_attempts
                  WHERE withdrawal_state = 'pending'
                    AND (withdrawal_lease_until IS NULL OR withdrawal_lease_until < clock_timestamp())
                  GROUP BY organization_id
                  ORDER BY min(updated_at), organization_id
                  LIMIT {max}
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<AttemptRow>> ClaimPendingWithdrawalsAsync(
        Guid organizationId, Guid owner, int max, CancellationToken cancellationToken)
    {
        var lease = ProviderWithdrawalLeasing.LeaseDuration.TotalSeconds;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // ONE statement, like the poller's claim: the subquery locks what it picks (SKIP LOCKED: never waits on a row
        // another pass is claiming), and a row another pass claimed and committed meanwhile is re-checked against its new
        // version, whose live lease excludes it. Oldest first (updated_at, id): a pass defers what it leaves pending.
        // A MATERIALIZED CTE, as in the poller's claim: an `id IN (subquery LIMIT n FOR UPDATE SKIP LOCKED)` semi-join
        // may re-run the subquery and claim more than `max` rows (reproduced there, Codex ATS r2 P2).
        var claimed = await _db.Database.SqlQuery<Guid>(
                $"""
                 WITH picked AS MATERIALIZED (
                        SELECT p.id FROM assessment_provider_attempts p
                         WHERE p.organization_id = {organizationId} AND p.withdrawal_state = 'pending'
                           AND (p.withdrawal_lease_until IS NULL OR p.withdrawal_lease_until < clock_timestamp())
                         ORDER BY p.updated_at, p.id
                         LIMIT {max}
                         FOR UPDATE SKIP LOCKED)
                 UPDATE assessment_provider_attempts a
                    SET withdrawal_lease_owner = {owner},
                        withdrawal_lease_until = clock_timestamp() + make_interval(secs => {lease})
                   FROM picked
                  WHERE a.organization_id = {organizationId} AND a.id = picked.id
                 RETURNING a.id AS "Value"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var rows = claimed.Count == 0
            ? []
            : await _db.Attempts.AsNoTracking()
                .Where(a => a.OrganizationId == organizationId && claimed.Contains(a.Id))
                .OrderBy(a => a.UpdatedAt).ThenBy(a => a.Id)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(a => ToRow(a, isNew: false)).ToList();
    }

    public async Task ReleaseWithdrawalLeasesAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, Guid owner, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attemptIds);
        if (attemptIds.Count == 0)
        {
            return;
        }

        var ids = attemptIds.ToArray();
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET withdrawal_lease_owner = NULL, withdrawal_lease_until = NULL
              WHERE organization_id = {organizationId} AND id = ANY({ids}) AND withdrawal_lease_owner = {owner}
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task RecordSubjectAsync(
        Guid organizationId, Guid attemptId, Guid providerSubjectId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts SET provider_subject_id = {providerSubjectId}
              WHERE organization_id = {organizationId} AND id = {attemptId} AND provider_subject_id IS NULL
                AND provider_assignment_id IS NULL
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<DateTimeOffset?> BeginCreateAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // Refused (0 rows) once the attempt is in a withdrawal, under an erasure request, or no longer pending. Against the
        // withdrawal's staging UPDATE of the same row, row locking decides the order: the loser re-evaluates its WHERE on
        // the winner's row version, so either the staging sees the announcement or the announcement sees the staging.
        // The token is THIS create's own (database clock, bumped past every token already on the row so it is unique).
        // Stale tokens are KEPT (Codex ats round 13 run 5): a stale token is the only evidence that a create which died
        // before recording its subject may have made one, and a later create that ends without resolving a subject must
        // not erase that evidence. A stale token blocks nothing (withdrawals and unbinds wait only for live ones); it
        // keeps the candidate's export Incomplete until a current subject is recorded, and an erasure retires it.
        // One read of the clock: the CTE is evaluated once.
        var tokens = await _db.Database.SqlQuery<DateTime>(
                $"""
                 WITH clock AS (SELECT clock_timestamp() AS ts)
                 UPDATE assessment_provider_attempts a
                    SET create_fences = array_append(
                          a.create_fences,
                          GREATEST(clock.ts, (SELECT max(f) + interval '1 microsecond' FROM unnest(a.create_fences) AS f)))
                   FROM clock
                  WHERE a.organization_id = {organizationId} AND a.id = {attemptId} AND a.state = 'pending_create'
                    AND a.withdrawal_state IS NULL AND a.provider_erasure_requested_at IS NULL
                 RETURNING a.create_fences[cardinality(a.create_fences)] AS "Value"
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return tokens.Count == 0 ? null : new DateTimeOffset(DateTime.SpecifyKind(tokens[0], DateTimeKind.Utc));
    }

    public async Task EndCreateAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset fence, ProviderAssignment? assignment,
        CancellationToken cancellationToken, Guid? resolvedSubjectId = null)
    {
        var token = fence.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        // One conditional, atomic write (never a read-modify-write of the array: a concurrent create's append must
        // survive). An answered create ends its fence only when the attempt records ITS assignment and subject; a
        // definitive refusal only while no erasure touched the attempt (see the interface for why).
        if (assignment is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE assessment_provider_attempts SET create_fences = array_remove(create_fences, {token})
                  WHERE organization_id = {organizationId} AND id = {attemptId}
                    AND provider_assignment_id = {assignment.AssignmentId} AND provider_subject_id = {assignment.SubjectId}
                 """, cancellationToken).ConfigureAwait(false);
        }
        else if (resolvedSubjectId is { } subject)
        {
            // A refusal after the create resolved a subject: only when the attempt records THAT subject (Codex ats
            // round 13 run 4), else the subject stays reachable through the unanswered fence.
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE assessment_provider_attempts SET create_fences = array_remove(create_fences, {token})
                  WHERE organization_id = {organizationId} AND id = {attemptId}
                    AND state <> 'erased' AND provider_erasure_requested_at IS NULL
                    AND provider_subject_id = {subject}
                 """, cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 UPDATE assessment_provider_attempts SET create_fences = array_remove(create_fences, {token})
                  WHERE organization_id = {organizationId} AND id = {attemptId}
                    AND state <> 'erased' AND provider_erasure_requested_at IS NULL
                 """, cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<WithdrawalFence>> ReadWithdrawalFencesAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attemptIds);
        if (attemptIds.Count == 0)
        {
            return [];
        }

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var ids = attemptIds.ToArray();
        var staleSeconds = ProviderCleanup.ConsentCaptureStaleAfter.TotalSeconds;
        var createStaleSeconds = ProviderCreateFence.StaleAfter.TotalSeconds;
        // Staleness by the DATABASE clock (the same clock that stamped both fences), at this read.
        var rows = await _db.Database.SqlQuery<FenceRow>(
                $"""
                 SELECT id AS "AttemptId", consent_capture_generation AS "Generation",
                        consent_captures_in_flight > 0 AS "InFlight",
                        (consent_captures_in_flight > 0
                         AND consent_capture_started_at < clock_timestamp() - make_interval(secs => {staleSeconds})) AS "Stale",
                        cardinality(create_fences) > 0 AS "CreateInFlight",
                        (cardinality(create_fences) > 0
                         AND NOT EXISTS (SELECT 1 FROM unnest(create_fences) AS f
                                          WHERE f >= clock_timestamp() - make_interval(secs => {createStaleSeconds}))) AS "CreateStale"
                   FROM assessment_provider_attempts
                  WHERE organization_id = {organizationId} AND id = ANY({ids})
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new WithdrawalFence(r.AttemptId, r.Generation, r.InFlight, r.Stale, r.CreateInFlight, r.CreateStale)).ToList();
    }

    public async Task DeferPendingWithdrawalsAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attemptIds);
        if (attemptIds.Count == 0)
        {
            return;
        }

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var ids = attemptIds.ToArray();
        var timestamp = now.UtcDateTime;
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND id = ANY({ids}) AND withdrawal_state = 'pending'
             """, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<int> MarkWithdrawalDoneAsync(
        Guid organizationId, IReadOnlyList<WithdrawalFence> fences, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(fences);
        if (fences.Count == 0)
        {
            return 0;
        }

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var ids = fences.Select(f => f.AttemptId).ToArray();
        var generations = fences.Select(f => f.CaptureGeneration).ToArray();
        var stale = fences.Select(f => f.CaptureStale).ToArray();
        var createStale = fences.Select(f => f.CreateStale).ToArray();
        var timestamp = now.UtcDateTime;
        // Conditional at the database: an orphan recorded meanwhile (marker set) keeps the attempt pending, and so does a
        // consent capture that began or ended after the fence was read (generation changed) or is still in flight and was
        // not stale at that read (same generation means in-flight count and start are unchanged since the read), and so
        // does any create still announced that was not stale at that read (no create can be announced after staging).
        var moved = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts a
                SET withdrawal_state = 'done', updated_at = {timestamp}
               FROM unnest({ids}::uuid[], {generations}::integer[], {stale}::boolean[], {createStale}::boolean[])
                    AS f(id, generation, stale, create_stale)
              WHERE a.organization_id = {organizationId} AND a.id = f.id
                AND a.withdrawal_state = 'pending'
                AND a.last_error_code IS DISTINCT FROM 'provider_cancel_pending'
                AND a.consent_capture_generation = f.generation
                AND (a.consent_captures_in_flight = 0 OR f.stale)
                AND (cardinality(a.create_fences) = 0 OR f.create_stale)
             """, cancellationToken).ConfigureAwait(false);
        if (moved > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_withdrawal_confirmed", ids[0], new Dictionary<string, object?>
            {
                ["attempts"] = moved,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return moved;
    }

    public async Task<bool> BeginConsentCaptureAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // The attempt lock a launch holds across its provider call: an announcement waits for a launch in progress, so a
        // launch that enforces the candidate's optional declines under that lock sees every capture that can still land.
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        var timestamp = now.UtcDateTime;
        // Refused (0 rows) for an attempt already in a withdrawal. Against the withdrawal's staging UPDATE of the same row,
        // row locking decides the order: the loser re-evaluates its WHERE on the winner's row version.
        var begun = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET consent_capture_generation = consent_capture_generation + 1,
                    consent_captures_in_flight = consent_captures_in_flight + 1,
                    consent_capture_started_at = clock_timestamp(),
                    updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND id = {attemptId} AND withdrawal_state IS NULL
                AND provider_erasure_requested_at IS NULL
             """, cancellationToken).ConfigureAwait(false);
        if (begun > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_consent_capture_started", attemptId, []);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return begun > 0;
    }

    public async Task EndConsentCaptureAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await EndConsentCaptureCoreAsync(organizationId, attemptId, now, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task EndConsentCaptureAndRecordDecisionsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> granted, IReadOnlyList<string> declined,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(granted);
        ArgumentNullException.ThrowIfNull(declined);
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        // The attempt lock FIRST, as a launch holds it while it reads the recorded declines and checks the fence: that
        // launch either ran before (and saw the fence in flight, so it retried) or runs after this commit and sees both the
        // fence ended and the decision recorded. Never one without the other.
        await LockAttemptAsync(attemptId, cancellationToken).ConfigureAwait(false);
        await ApplyOptionalConsentDecisionsAsync(organizationId, attemptId, granted, declined, cancellationToken)
            .ConfigureAwait(false);
        await EndConsentCaptureCoreAsync(organizationId, attemptId, now, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task EndConsentCaptureCoreAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var timestamp = now.UtcDateTime;
        var ended = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET consent_capture_generation = consent_capture_generation + 1,
                    consent_captures_in_flight = GREATEST(consent_captures_in_flight - 1, 0),
                    consent_capture_started_at = CASE WHEN consent_captures_in_flight <= 1 THEN NULL
                                                      ELSE consent_capture_started_at END,
                    updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND id = {attemptId}
             """, cancellationToken).ConfigureAwait(false);
        if (ended > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_consent_capture_ended", attemptId, []);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private sealed class FenceRow
    {
        public Guid AttemptId { get; init; }

        public int Generation { get; init; }

        public bool InFlight { get; init; }

        public bool Stale { get; init; }

        public bool CreateInFlight { get; init; }

        public bool CreateStale { get; init; }
    }

    public async Task<ProviderSubjectExport?> ExportCandidateAsync(
        Guid organizationId, Guid candidateId, Guid actorId, int providerExports, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var exists = await _db.Candidates.AsNoTracking()
            .AnyAsync(c => c.Id == candidateId && c.OrganizationId == organizationId, cancellationToken).ConfigureAwait(false);
        if (!exists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var attempts = await _db.Attempts.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.CandidateId == candidateId)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        var attemptIds = attempts.Select(a => a.Id).ToList();
        var results = await _db.Results.AsNoTracking()
            .Where(r => r.OrganizationId == organizationId && attemptIds.Contains(r.AttemptId))
            .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        // Fail-closed: the export is returned only once its audit row is committed with it.
        AddAudit(organizationId, actorId, "assessment_provider_subject_exported", candidateId, new Dictionary<string, object?>
        {
            ["attempts"] = attempts.Count,
            ["results"] = results.Count,
            ["providerExports"] = providerExports,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new ProviderSubjectExport(
            attempts.Select(a => new ProviderExportAttempt(
                a.Id, a.VacancyId, a.Instrument, a.State, a.Locale, a.TimeMultiplier, a.Aids, a.InstrumentVersion,
                a.ContentVersion, ToOffset(a.ExpiresAt), ToOffset(a.StartedAt), ToOffset(a.CompletedAt),
                ToOffset(a.CreatedAt)!.Value, a.WithdrawalState, ToOffset(a.ProviderErasureRequestedAt))).ToList(),
            results.Select(r => new ProviderExportResult(
                r.AttemptId, r.ProviderResultId, r.ResultRevision, r.Instrument, r.InstrumentVersion, r.ValidityStatus,
                r.ValidityReasons, r.Completion, r.GlobalPercentile, r.Cefr, r.Level, r.Scores,
                ToOffset(r.CompletedAt)!.Value, ToOffset(r.ScoredAt)!.Value)).ToList());
    }

    public async Task<ProviderCandidateSubjects?> ListProviderSubjectsAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var exists = await _db.Candidates.AsNoTracking()
            .AnyAsync(c => c.Id == candidateId && c.OrganizationId == organizationId, cancellationToken).ConfigureAwait(false);
        ProviderCandidateSubjects? result = null;
        if (exists)
        {
            var subjects = await _db.Attempts.AsNoTracking()
                .Where(a => a.OrganizationId == organizationId && a.CandidateId == candidateId && a.ProviderSubjectId != null)
                .Select(a => a.ProviderSubjectId!.Value)
                .Distinct()
                .OrderBy(id => id)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            var hasAttempts = await _db.Attempts.AsNoTracking()
                .AnyAsync(a => a.OrganizationId == organizationId && a.CandidateId == candidateId, cancellationToken)
                .ConfigureAwait(false);
            // The subjects whose erasure the provider confirmed (subject.erased is in the inbox), whether or not the inbox
            // worker has erased their attempts yet.
            var erased = new List<Guid>();
            foreach (var subject in subjects)
            {
                if (await IsSubjectErasedAsync(organizationId, subject, cancellationToken).ConfigureAwait(false))
                {
                    erased.Add(subject);
                }
            }

            // A stored erasure is terminal: an attempt erased, under an accepted erasure request, or recorded against a
            // subject the provider confirmed erased (Codex ats round 13 run 2 [P2]: between subject.erased landing in the
            // inbox and its worker erasing the attempts) needs no subject resolution. The provider forgot that subject's
            // external_ref, so resolving would create a fresh subject for an erased person.
            var liveRecorded = await _db.Attempts.AsNoTracking()
                .Where(a => a.OrganizationId == organizationId && a.CandidateId == candidateId
                    && a.State != ProviderAttemptStates.Erased && a.ProviderErasureRequestedAt == null
                    && (a.ProviderSubjectId == null || !erased.Contains(a.ProviderSubjectId.Value)))
                .Select(a => a.ProviderSubjectId)
                .Distinct()
                .ToListAsync(cancellationToken).ConfigureAwait(false);
            var liveAttemptNeedsResolution = liveRecorded.Count > 0;
            // A create announced (BeginCreateAsync) and never answered: its EnsureSubject may have created a provider
            // subject no attempt records (Codex ats-final runs 2 and 3) - before the subject was recorded, or AFTER an
            // erasure made the provider forget the recorded one's external_ref (RecordSubjectAsync never replaces a
            // recorded subject, and MarkCreatedAsync ignores an erased attempt). So ANY unanswered fence, whatever the
            // attempt's subject or state, makes the candidate's subject be resolved by (tenant, candidate id) again, even
            // under an erasure request. And one still live (database clock) may create a subject after this read.
            var createStaleSeconds = ProviderCreateFence.StaleAfter.TotalSeconds;
            var fences = await _db.Database.SqlQuery<CreateFenceFacts>(
                    $"""
                     SELECT count(*) > 0 AS "Unanswered", clock_timestamp() AS "ReadAt",
                            COALESCE(bool_or(EXISTS (
                                SELECT 1 FROM unnest(create_fences) AS f
                                 WHERE f >= clock_timestamp() - make_interval(secs => {createStaleSeconds}))), false) AS "Live"
                       FROM assessment_provider_attempts
                      WHERE organization_id = {organizationId} AND candidate_id = {candidateId}
                        AND cardinality(create_fences) > 0
                     """)
                .SingleAsync(cancellationToken).ConfigureAwait(false);
            var needsResolution = liveAttemptNeedsResolution || fences.Unanswered;

            result = new ProviderCandidateSubjects(
                subjects, hasAttempts, erased, needsResolution, fences.Live,
                OnlyUnansweredCreatesNeedResolution: fences.Unanswered && !liveAttemptNeedsResolution,
                ReadAt: new DateTimeOffset(DateTime.SpecifyKind(fences.ReadAt, DateTimeKind.Utc)),
                UnansweredCreates: fences.Unanswered,
                LiveSubjects: [.. liveRecorded.Where(id => id is not null).Select(id => id!.Value).Order()]);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    public async Task<int> RetireStaleCreateFencesAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset staleAsOf, CancellationToken cancellationToken)
    {
        // Codex ats round 13 [P2]: only fences already stale at staleAsOf (their create was dead before the erasure
        // resolved the candidate's subject by external_ref and erased it), and only on attempts an erasure touched: a
        // fence on any other attempt, or one younger than that, keeps forcing resolution. One atomic write per row, so a
        // concurrent create's append (refused anyway under an erasure request) is never lost.
        var staleSeconds = ProviderCreateFence.StaleAfter.TotalSeconds;
        var cutoff = staleAsOf.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var retired = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET create_fences = ARRAY(SELECT f FROM unnest(create_fences) AS f
                                           WHERE f >= {cutoff} - make_interval(secs => {staleSeconds}) ORDER BY f)
              WHERE organization_id = {organizationId} AND candidate_id = {candidateId}
                AND (state = 'erased' OR provider_erasure_requested_at IS NOT NULL)
                AND EXISTS (SELECT 1 FROM unnest(create_fences) AS f
                             WHERE f < {cutoff} - make_interval(secs => {staleSeconds}))
             """, cancellationToken).ConfigureAwait(false);
        if (retired > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_create_fences_retired", candidateId,
                new Dictionary<string, object?> { ["attempts"] = retired });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return retired;
    }

    public async Task ReopenWithdrawalAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var timestamp = now.UtcDateTime;
        var reopened = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts SET withdrawal_state = 'pending', updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND id = {attemptId} AND withdrawal_state = 'done'
             """, cancellationToken).ConfigureAwait(false);
        if (reopened > 0)
        {
            AddAudit(organizationId, null, "assessment_provider_withdrawal_reopened", attemptId, []);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task MarkErasureRequestedAsync(
        Guid organizationId, Guid candidateId, Guid providerSubjectId, string receiptStatus, Guid actorId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        await LockSubjectAsync(providerSubjectId, cancellationToken).ConfigureAwait(false);
        var timestamp = now.UtcDateTime;
        var marked = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET provider_erasure_requested_at = COALESCE(provider_erasure_requested_at, {timestamp}),
                    updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND candidate_id = {candidateId}
                AND (provider_subject_id = {providerSubjectId} OR provider_subject_id IS NULL)
             """, cancellationToken).ConfigureAwait(false);
        AddAudit(organizationId, actorId, "assessment_provider_erasure_requested", candidateId, new Dictionary<string, object?>
        {
            ["providerSubjectId"] = providerSubjectId,
            ["receipt"] = receiptStatus,
            ["attempts"] = marked,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private sealed class CreateFenceFacts
    {
        public bool Unanswered { get; init; }

        public bool Live { get; init; }

        public DateTime ReadAt { get; init; }
    }
}
