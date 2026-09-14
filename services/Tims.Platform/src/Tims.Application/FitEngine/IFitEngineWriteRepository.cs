namespace Tims.Application.FitEngine;

/// <summary>
/// Write side of the FIT-engine slice — the data steps of <c>computeForVacancy</c> and
/// <c>upsertRoleFamilyWeightProfile</c> (fit-engine.repository.ts). Reads AsNoTracking; the two upserts are
/// atomic <c>INSERT … ON CONFLICT DO UPDATE</c> (the same SQL Prisma emits for these eligible upserts). All
/// under TenantScope with explicit organizationId filters/values.
/// </summary>
public interface IFitEngineWriteRepository
{
    /// <summary><c>getCandidateForFit</c>: {id, org, deletedAt null} → yearsExperience + education/languages jsonb, or null.</summary>
    Task<CandidateForFitData?> GetCandidateForFitAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken);

    /// <summary><c>getVacancyForFit</c>: {id, org, deletedAt null} → roleFamily + jobProfile.fitRequirements, or null.</summary>
    Task<VacancyForFitData?> GetVacancyForFitAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>getLatestAssessmentScore</c>: latest (completedAt DESC — plain DESC, so SQL NULLS FIRST, matching
    /// Prisma) assignment WITH a result row → its normalizedScore (itself nullable), else null.
    /// </summary>
    Task<double?> GetLatestAssessmentScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary><c>getLatestInterviewFitScore</c>: latest (createdAt DESC) session with a non-null fitScore, else null.</summary>
    Task<int?> GetLatestInterviewFitScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary><c>findWeightProfile</c>: the unique (org, name) profile, or null.</summary>
    Task<WeightProfileData?> FindWeightProfileAsync(
        Guid organizationId, string name, CancellationToken cancellationToken);

    /// <summary>
    /// <c>upsertWeightProfile</c>: create {org, name, weights} / update {weights} on the (org, name) unique,
    /// returning the stored row (weights in jsonb-canonical key order, exactly what Prisma echoes).
    /// </summary>
    Task<WeightProfileData> UpsertWeightProfileAsync(
        Guid organizationId, string name, string weightsJson, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// <c>upsertFitScore</c>: create/update on the (candidateId, vacancyId) unique — update touches
    /// overallScore/breakdown/weights/isPartial/calculatedAt (+updatedAt), never organizationId/createdAt.
    /// </summary>
    Task UpsertFitScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
        string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary><c>getPipelineCandidateIds</c>: candidate ids of the vacancy's <c>status = 'active'</c> applications.</summary>
    Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);
}
