namespace Tims.Application.FitEngine;

/// <summary>
/// Read side of the FIT-engine slice — the three read projections of fit-engine.repository.ts. Every query
/// AsNoTracking, under TenantScope, with an explicit organizationId filter.
/// </summary>
public interface IFitEngineReadRepository
{
    /// <summary><c>getFitScoresForVacancy</c>: org + vacancy rows, overallScore DESC (ties DB-unspecified), candidate names joined.</summary>
    Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary><c>listWeightProfiles</c>: all org profiles, name ASC (DB collation — both stacks order in the same database).</summary>
    Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
        Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// FIT v2: the given fit_scores rows of this organization (the #312 withdrawn-consent rows excluded), each with its
    /// vacancy and whether its breakdown carries <c>reviewPending: true</c>. Ids not found are simply absent.
    /// </summary>
    Task<IReadOnlyList<FitReviewStateData>> GetReviewStatesAsync(
        Guid organizationId, IReadOnlyCollection<Guid> fitScoreIds, CancellationToken cancellationToken);

    /// <summary>
    /// FIT v2: the candidate's fit_scores rows of this organization (the #312 withdrawn-consent rows excluded),
    /// calculatedAt DESC then id. At most <paramref name="max"/>.
    /// </summary>
    Task<IReadOnlyList<CandidateFitScoreData>> GetFitScoresForCandidateAsync(
        Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken);

    /// <summary><c>getFitScoreForExplain</c>: the (candidate, vacancy) row or null — at most one exists (unique pair).</summary>
    Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);
}
