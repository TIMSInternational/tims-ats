using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// The HR report downloads' reads and audit row. Same tenancy rules as the rest of the repository: <see cref="TenantScope"/>
/// AND an explicit <c>organization_id</c> filter on every query.
/// </summary>
public sealed partial class AssessmentProviderRepository : IProviderReportRepository
{
    public async Task<ProviderReportTarget?> GetReportTargetAsync(
        Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var row = await (
                from a in _db.Attempts.AsNoTracking()
                where a.OrganizationId == organizationId && a.Id == attemptId
                join r in _db.Results.AsNoTracking().Where(r => r.OrganizationId == organizationId)
                    on a.LatestResultId equals (Guid?)r.ProviderResultId into results
                from r in results.DefaultIfEmpty()
                select new
                {
                    a.CandidateId,
                    a.VacancyId,
                    a.Instrument,
                    a.Locale,
                    a.State,
                    a.WithdrawalState,
                    a.ProviderErasureRequestedAt,
                    ResultId = r == null ? (Guid?)null : r.ProviderResultId,
                    Validity = r == null ? null : r.ValidityStatus,
                    Level = r == null ? null : r.RenderedLevel,
                    Revision = r == null ? (int?)null : r.ResultRevision,
                })
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var withdrawn = row is not null
            && await IsWithdrawnAsync(organizationId, row.CandidateId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        if (row is null)
        {
            return null;
        }

        var stopped = row.WithdrawalState is not null || row.ProviderErasureRequestedAt is not null
            || row.State == ProviderAttemptStates.Erased;
        return new ProviderReportTarget(
            row.CandidateId, row.VacancyId, row.Instrument, row.Locale, row.ResultId, row.Validity, row.Level, stopped,
            withdrawn, row.Revision);
    }

    public async Task AuditReportDownloadAsync(
        Guid organizationId, Guid actorId, Guid attemptId, Guid candidateId, string instrument, string? variant,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        AddAudit(organizationId, actorId, "assessment_provider_report_downloaded", attemptId, new Dictionary<string, object?>
        {
            ["candidateId"] = candidateId,
            ["instrument"] = instrument,
            ["variant"] = variant,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }
}
