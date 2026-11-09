using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// Staff reads (the HR results view, status chips and the vacancy's pinned versions) and the version pin a new attempt
/// takes at reserve. Same tenancy rules as the rest of the repository: <see cref="TenantScope"/> AND an explicit
/// <c>organization_id</c> filter on every query.
/// </summary>
public sealed partial class AssessmentProviderRepository : IProviderStaffReadRepository
{
    public async Task<IReadOnlyDictionary<string, string>> GetVacancyPinnedVersionsAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var pinned = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var instrument in ProviderInstruments.All)
        {
            if (await PinnedVersionAsync(organizationId, vacancyId, instrument, cancellationToken).ConfigureAwait(false)
                is { } version)
            {
                pinned[instrument] = version;
            }
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return pinned;
    }

    public async Task<StaffCandidateAttempts> ListCandidateAttemptsAsync(
        Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        if (await IsWithdrawnAsync(organizationId, candidateId, cancellationToken).ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new StaffCandidateAttempts(true, [], new Dictionary<Guid, string?>());
        }

        var rows = await (
                from a in _db.Attempts.AsNoTracking()
                where a.OrganizationId == organizationId && a.CandidateId == candidateId
                join r in _db.Results.AsNoTracking().Where(r => r.OrganizationId == organizationId)
                    on a.LatestResultId equals (Guid?)r.ProviderResultId into results
                from r in results.DefaultIfEmpty()
                orderby a.CreatedAt descending, a.Id
                select new { Attempt = a, Result = r })
            .Take(max)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var vacancyIds = rows.Select(r => r.Attempt.VacancyId).Distinct().ToList();
        var requirements = await _db.JobProfiles.AsNoTracking()
            .Where(j => j.OrganizationId == organizationId && vacancyIds.Contains(j.VacancyId))
            .Select(j => new { j.VacancyId, j.FitRequirements })
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var byVacancy = vacancyIds.ToDictionary(
            id => id, id => requirements.FirstOrDefault(j => j.VacancyId == id)?.FitRequirements);
        var attempts = rows.Select(row => new StaffAttemptRecord(
                ToRow(row.Attempt, isNew: false),
                ToOffset(row.Attempt.CreatedAt)!.Value,
                ToOffset(row.Attempt.CompletedAt),
                row.Result is not { } r
                    ? null
                    : new StaffResultRecord(
                        r.ProviderResultId, r.Purpose, r.InstrumentVersion, r.NormVersion, r.ValidityStatus,
                        r.ValidityReasons, r.RequiresHumanReview, r.GlobalPercentile, r.Cefr, r.Level,
                        r.TimeMultiplierApplied, ToOffset(r.CompletedAt)!.Value)))
            .ToList();
        return new StaffCandidateAttempts(false, attempts, byVacancy);
    }

    /// <summary>
    /// The version every assignment of (vacancy, instrument) is pinned to: the EARLIEST attempt carrying one, in any
    /// state. Runs on the caller's open tenant scope.
    /// </summary>
    private async Task<string?> PinnedVersionAsync(
        Guid organizationId, Guid vacancyId, string instrument, CancellationToken cancellationToken) =>
        await _db.Attempts.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.VacancyId == vacancyId && a.Instrument == instrument
                && a.InstrumentVersion != null)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .Select(a => a.InstrumentVersion)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
}
