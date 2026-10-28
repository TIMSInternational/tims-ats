using Microsoft.EntityFrameworkCore;
using Tims.Application.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// EF implementation of <see cref="IFitEngineReadRepository"/> — the three read projections of
/// fit-engine.repository.ts. Every query AsNoTracking, under <see cref="TenantScope"/> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS). The DRIVING table (<c>fit_scores</c> / <c>role_family_weight_profiles</c>)
/// additionally carries an explicit organizationId predicate (defense-in-depth); the JOINED
/// <c>candidates</c>/<c>vacancies</c> do NOT — they rest on RLS plus FK/PK integrity, which is sufficient
/// because the join key is a primary key and the driving row is already org-filtered. Said precisely because
/// an earlier draft claimed "every query … with an explicit organizationId filter", which over-describes it. Candidate/vacancy
/// joins are INNER (required Prisma relations — the FK guarantees the row). Timestamps re-kind to UTC at this
/// boundary so the Node-ISO converter emits <c>…fffZ</c>.
/// </summary>
public sealed class FitEngineReadRepository(FitEngineReadDbContext db) : IFitEngineReadRepository
{
    private readonly FitEngineReadDbContext _db = db;

    public async Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // orderBy overallScore DESC only (no tiebreaker in the TS) — tie order is DB-unspecified in BOTH stacks.
        var rows = await (
                from f in VisibleFitScores(organizationId)
                join c in _db.Candidates.AsNoTracking() on f.CandidateId equals c.Id
                where f.OrganizationId == organizationId && f.VacancyId == vacancyId
                orderby f.OverallScore descending
                select new
                {
                    f.Id,
                    f.OverallScore,
                    f.Breakdown,
                    f.IsPartial,
                    f.CalculatedAt,
                    CandidateId = c.Id,
                    c.FirstName,
                    c.LastName,
                })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows
            .Select(r => new FitScoreForVacancyData(
                r.Id, r.OverallScore, r.Breakdown, r.IsPartial, ToUtc(r.CalculatedAt), r.CandidateId, r.FirstName,
                r.LastName))
            .ToList();
    }

    public async Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
        Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var rows = await _db.WeightProfiles.AsNoTracking()
            .Where(p => p.OrganizationId == organizationId)
            .OrderBy(p => p.Name)
            .Select(p => new { p.Id, p.Name, p.Weights })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return rows.Select(r => new WeightProfileData(r.Id, r.Name, r.Weights)).ToList();
    }

    public async Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var row = await (
                from f in VisibleFitScores(organizationId)
                join c in _db.Candidates.AsNoTracking() on f.CandidateId equals c.Id
                join v in _db.Vacancies.AsNoTracking() on f.VacancyId equals v.Id
                where f.CandidateId == candidateId && f.VacancyId == vacancyId
                    && f.OrganizationId == organizationId
                select new { f.OverallScore, f.Breakdown, c.FirstName, c.LastName, v.Title })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null
            ? null
            : new ExplainFitRowData(row.OverallScore, row.Breakdown, row.FirstName, row.LastName, row.Title);
    }

    // #312: fit_scores minus every row whose candidate's recruitment consent is withdrawn — a data_consents row
    // (recruitment_data_processing, withdrawn_at NOT NULL, same org) on the candidate itself OR on any same-org
    // candidate whose lower(btrim(email)) EQUALS the scored candidate's non-blank one (exact equality, never LIKE).
    // A correlated NOT EXISTS in the same query, so ranking, simulate and explain all hide the row; never deleted.
    private IQueryable<FitScoreReadEntity> VisibleFitScores(Guid organizationId) =>
        _db.FitScores.AsNoTracking()
            .Where(f => f.OrganizationId == organizationId
                && !_db.DataConsents.Any(dc => dc.OrganizationId == organizationId
                    && dc.ConsentType == RecruitmentConsentType
                    && dc.WithdrawnAt != null
                    && (dc.SubjectUserId == f.CandidateId
                        || _db.Candidates.Any(other => other.OrganizationId == organizationId
                            && other.Id == dc.SubjectUserId
                            && _db.Candidates.Any(target => target.Id == f.CandidateId
                                && target.OrganizationId == organizationId
                                && target.Email.Trim() != string.Empty
                                && other.Email.Trim().ToLower() == target.Email.Trim().ToLower())))));

    // Mirrors CandidateConsentConstants.ConsentType (same duplication as FitEngineWriteRepository).
    private const string RecruitmentConsentType = "recruitment_data_processing";

    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
