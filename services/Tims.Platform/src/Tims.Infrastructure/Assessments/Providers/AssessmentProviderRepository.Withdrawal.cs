using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>#312 withdrawal cascade (D15), DSAR export and ATS-initiated erasure of provider subjects.</summary>
public sealed partial class AssessmentProviderRepository
{
    public async Task<int> StageConsentWithdrawalAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var lockKey = candidateId.ToString();
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))", cancellationToken).ConfigureAwait(false);
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
        // served by the partial index ix_assessment_provider_attempts_withdrawal_pending.
        return await _db.Attempts.AsNoTracking()
            .Where(a => a.WithdrawalState == ProviderWithdrawalStates.Pending)
            .Select(a => a.OrganizationId)
            .Distinct()
            .OrderBy(id => id)
            .Take(max)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<AttemptRow>> ListPendingWithdrawalsAsync(
        Guid organizationId, int max, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var rows = await _db.Attempts.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.WithdrawalState == ProviderWithdrawalStates.Pending)
            .OrderBy(a => a.UpdatedAt).ThenBy(a => a.Id)
            .Take(max)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(a => ToRow(a, isNew: false)).ToList();
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
        // Staleness by the DATABASE clock (the same clock that stamped consent_capture_started_at), at this read.
        var rows = await _db.Database.SqlQuery<FenceRow>(
                $"""
                 SELECT id AS "AttemptId", consent_capture_generation AS "Generation",
                        consent_captures_in_flight > 0 AS "InFlight",
                        (consent_captures_in_flight > 0
                         AND consent_capture_started_at < clock_timestamp() - make_interval(secs => {staleSeconds})) AS "Stale"
                   FROM assessment_provider_attempts
                  WHERE organization_id = {organizationId} AND id = ANY({ids})
                 """)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(r => new WithdrawalFence(r.AttemptId, r.Generation, r.InFlight, r.Stale)).ToList();
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
        var timestamp = now.UtcDateTime;
        // Conditional at the database: an orphan recorded meanwhile (marker set) keeps the attempt pending, and so does a
        // consent capture that began or ended after the fence was read (generation changed) or is still in flight and was
        // not stale at that read (same generation means in-flight count and start are unchanged since the read).
        var moved = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts a
                SET withdrawal_state = 'done', updated_at = {timestamp}
               FROM unnest({ids}::uuid[], {generations}::integer[], {stale}::boolean[]) AS f(id, generation, stale)
              WHERE a.organization_id = {organizationId} AND a.id = f.id
                AND a.withdrawal_state = 'pending'
                AND a.last_error_code IS DISTINCT FROM 'provider_cancel_pending'
                AND a.consent_capture_generation = f.generation
                AND (a.consent_captures_in_flight = 0 OR f.stale)
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

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private sealed class FenceRow
    {
        public Guid AttemptId { get; init; }

        public int Generation { get; init; }

        public bool InFlight { get; init; }

        public bool Stale { get; init; }
    }

    public async Task<ProviderSubjectExport?> ExportCandidateAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
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
            result = new ProviderCandidateSubjects(subjects, hasAttempts);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
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
}
