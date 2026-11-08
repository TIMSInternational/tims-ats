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

    public async Task<int> MarkWithdrawalDoneAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, DateTimeOffset now, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(attemptIds);
        if (attemptIds.Count == 0)
        {
            return 0;
        }

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var ids = attemptIds.ToArray();
        var timestamp = now.UtcDateTime;
        // Conditional at the database: an orphan recorded meanwhile (marker set) keeps the attempt pending.
        var moved = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE assessment_provider_attempts
                SET withdrawal_state = 'done', updated_at = {timestamp}
              WHERE organization_id = {organizationId} AND id = ANY({ids})
                AND withdrawal_state = 'pending'
                AND last_error_code IS DISTINCT FROM 'provider_cancel_pending'
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

    public async Task<IReadOnlyList<Guid>?> ListProviderSubjectsAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var exists = await _db.Candidates.AsNoTracking()
            .AnyAsync(c => c.Id == candidateId && c.OrganizationId == organizationId, cancellationToken).ConfigureAwait(false);
        List<Guid>? subjects = null;
        if (exists)
        {
            subjects = await _db.Attempts.AsNoTracking()
                .Where(a => a.OrganizationId == organizationId && a.CandidateId == candidateId && a.ProviderSubjectId != null)
                .Select(a => a.ProviderSubjectId!.Value)
                .Distinct()
                .OrderBy(id => id)
                .ToListAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return subjects;
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
                AND provider_subject_id = {providerSubjectId}
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
