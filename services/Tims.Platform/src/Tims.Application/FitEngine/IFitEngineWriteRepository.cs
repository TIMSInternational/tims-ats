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
    /// #312: in the SAME transaction it first takes the withdrawal's per-candidate advisory lock and RE-CHECKS the
    /// candidate's consent; a withdrawal committed after the pre-loop check skips the write and returns false.
    /// </summary>
    Task<bool> UpsertFitScoreUnlessWithdrawnAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
        string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// The FIT v2 write: read the integrity-carrying inputs and write the row ATOMICALLY. In one transaction it
    /// takes the #312 consent lock and re-checks consent (a withdrawn candidate returns false and
    /// <paramref name="buildInLock"/> is never called), then takes a per-(organization, candidate, vacancy) FIT v2
    /// advisory lock, then calls <paramref name="buildInLock"/> ON THAT OPEN TRANSACTION (it re-reads the results
    /// and evaluates them) and writes what it returns. Two v2 computes for the same pair therefore never
    /// interleave a read and a write: the row always reflects the results as of its own in-lock read. If
    /// <paramref name="buildInLock"/> throws or the token is cancelled, the transaction rolls back and the stored
    /// row is left exactly as it was.
    /// </summary>
    /// <remarks>
    /// <paramref name="onlyIfRowExists"/>: a recompute (the recompute queue) writes nothing when no row exists for
    /// the pair once the FIT v2 lock is held, and returns false, unless <paramref name="createIfMissing"/> is given,
    /// the candidate holds an active application for the vacancy (read on the same transaction: the computeForVacancy
    /// population), and <paramref name="createIfMissing"/>, called in the lock, answers true: then the row is created
    /// as a compute would create it.
    /// </remarks>
    Task<bool> UpsertFitScoreV2Async(
        Guid organizationId, Guid candidateId, Guid vacancyId, string weightsJson, DateTimeOffset now,
        Func<CancellationToken, Task<FitScoreWrite>> buildInLock, CancellationToken cancellationToken,
        bool onlyIfRowExists = false, Func<CancellationToken, Task<bool>>? createIfMissing = null);

    /// <summary>
    /// The C#-owned <c>job_profiles.fit_requirements</c> write, one atomic <c>INSERT … ON CONFLICT DO UPDATE</c> on the
    /// vacancy's profile. <paramref name="replaceAssessments"/> false MERGES: the stored <c>assessments</c> key, if
    /// any, is carried over inside the same statement (no read-then-write). Returns the stored jsonb, or null when the
    /// profile row belongs to another organization (nothing written).
    /// </summary>
    Task<string?> UpsertFitRequirementsAsync(
        Guid organizationId, Guid vacancyId, string fitRequirementsJson, bool replaceAssessments, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary><c>getPipelineCandidateIds</c>: candidate ids of the vacancy's <c>status = 'active'</c> applications.</summary>
    Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>
    /// #312/#313 consent guard: the subset of <paramref name="candidateIds"/> whose recruitment consent is
    /// WITHDRAWN in this org — a <c>data_consents</c> row (consent_type 'recruitment_data_processing',
    /// withdrawn_at NOT NULL, same org) whose subject is the candidate itself OR any same-org candidate row whose
    /// normalized email (<c>lower(btrim(email))</c>, exact equality — never LIKE) equals the candidate's
    /// non-blank normalized email. Soft-deleted rows count on both sides.
    /// </summary>
    Task<IReadOnlySet<Guid>> GetConsentWithdrawnCandidateIdsAsync(
        Guid organizationId, IReadOnlyCollection<Guid> candidateIds, CancellationToken cancellationToken);
}
