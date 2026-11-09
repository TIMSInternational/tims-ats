using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.FitEngine;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// EF implementation of <see cref="IFitEngineWriteRepository"/> — the data steps of <c>computeForVacancy</c> /
/// <c>upsertRoleFamilyWeightProfile</c> (fit-engine.repository.ts). Reads AsNoTracking; the two upserts are raw
/// <c>INSERT … ON CONFLICT DO UPDATE</c> (EF has no native upsert; mirrors the nine-box vote / fx-rate raw
/// upserts — and Prisma emits the same statement for these eligible upserts, so the write is atomic in BOTH
/// stacks). Every op runs UNDER <see cref="TenantScope"/>; the DRIVING table of each query carries an
/// explicit organizationId filter/value, while the joined <c>job_profiles</c> / <c>assessment_results</c>
/// do not — those rest on RLS plus their unique FKs (<c>job_profiles.vacancy_id</c>,
/// <c>assessment_results.assignment_id</c>), so only the same-org row is reachable either way.
/// Client-set ids (<c>Guid.NewGuid()</c>) + explicit created/updated/calculated timestamps — Prisma
/// <c>@default(uuid())</c>/<c>@default(now())</c>/<c>@updatedAt</c> are client-side. Timestamps bind as
/// ms-truncated Unspecified-kind <c>NpgsqlDbType.Timestamp</c> (TRAP 10/11: a bare hole would bind
/// <c>timestamptz</c>; a Utc-kind value is rejected outright); jsonb binds as
/// <c>NpgsqlDbType.Jsonb</c> strings. The ON-CONFLICT UPDATE never touches organization_id/created_at (the
/// Prisma update object doesn't), and RLS + the org-scoped candidate/vacancy fetches make a cross-org conflict
/// row unreachable.
/// </summary>
public sealed class FitEngineWriteRepository(FitEngineWriteDbContext db) : IFitEngineWriteRepository
{
    private readonly FitEngineWriteDbContext _db = db;

    public async Task<CandidateForFitData?> GetCandidateForFitAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var row = await _db.Candidates.AsNoTracking()
            .Where(c => c.Id == candidateId && c.OrganizationId == organizationId && c.DeletedAt == null)
            .Select(c => new { c.YearsExperience, c.Education, c.Languages })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null ? null : new CandidateForFitData(row.YearsExperience, row.Education, row.Languages);
    }

    public async Task<VacancyForFitData?> GetVacancyForFitAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // LEFT JOIN job_profiles (a vacancy may have none — the TS `jobProfile?.fitRequirements` chain).
        var row = await (
                from v in _db.Vacancies.AsNoTracking()
                where v.Id == vacancyId && v.OrganizationId == organizationId && v.DeletedAt == null
                join jp in _db.JobProfiles.AsNoTracking() on v.Id equals jp.VacancyId into profiles
                from jp in profiles.DefaultIfEmpty()
                select new { v.RoleFamily, FitRequirements = jp != null ? jp.FitRequirements : null })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null ? null : new VacancyForFitData(row.RoleFamily, row.FitRequirements);
    }

    public async Task<double?> GetLatestAssessmentScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // `result: { isNot: null }` + nested select ≡ INNER JOIN on the 1-1 (assignment_id unique).
        // ORDER BY completed_at DESC — plain DESC, so Postgres NULLS FIRST, exactly what Prisma emits.
        var row = await (
                from a in _db.AssessmentAssignments.AsNoTracking()
                join r in _db.AssessmentResults.AsNoTracking() on a.Id equals r.AssignmentId
                where a.OrganizationId == organizationId && a.CandidateId == candidateId && a.VacancyId == vacancyId
                orderby a.CompletedAt descending
                select new { r.NormalizedScore })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        // No assignment-with-result → null; a result row whose normalizedScore is NULL → null (TS `?? null`).
        return row?.NormalizedScore;
    }

    public async Task<int?> GetLatestInterviewFitScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var row = await _db.AiInterviewSessions.AsNoTracking()
            .Where(s => s.OrganizationId == organizationId && s.CandidateId == candidateId
                && s.VacancyId == vacancyId && s.FitScore != null)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => new { s.FitScore })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row?.FitScore;
    }

    public async Task<WeightProfileData?> FindWeightProfileAsync(
        Guid organizationId, string name, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var row = await _db.WeightProfiles.AsNoTracking()
            .Where(p => p.OrganizationId == organizationId && p.Name == name)
            .Select(p => new { p.Id, p.Name, p.Weights })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return row is null ? null : new WeightProfileData(row.Id, row.Name, row.Weights);
    }

    public async Task<WeightProfileData> UpsertWeightProfileAsync(
        Guid organizationId, string name, string weightsJson, DateTimeOffset now, CancellationToken cancellationToken)
    {
        const string sql =
            "INSERT INTO role_family_weight_profiles (id, organization_id, name, weights, created_at, updated_at) "
            + "VALUES (@id, @org, @name, @weights, @now, @now) "
            + "ON CONFLICT (organization_id, name) "
            + "DO UPDATE SET weights = EXCLUDED.weights, updated_at = EXCLUDED.updated_at "
            + "RETURNING id, name, weights";

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.Add(new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = Guid.NewGuid() });
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("name", NpgsqlDbType.Text) { Value = name });
        command.Parameters.Add(new NpgsqlParameter("weights", NpgsqlDbType.Jsonb) { Value = weightsJson });
        command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
        var saved = new WeightProfileData(reader.GetGuid(0), reader.GetString(1), reader.GetString(2));
        await reader.CloseAsync().ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return saved;
    }

    public async Task<bool> UpsertFitScoreUnlessWithdrawnAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
        string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // #312: the same transaction-scoped advisory lock a withdrawal of this candidate takes
        // (CandidateConsentRepository.WithdrawOneAsync), then a re-check — a withdrawal that committed after the
        // pre-loop check (or one waiting on this lock) is seen here, so the score is not written. A withdrawal on a
        // same-email row takes that row's lock instead; the email-aware re-check still sees it once committed.
        await CandidateConsentLocks.LockCandidateAndSiblingsAsync(_db.Database, organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        var withdrawn = await QueryWithdrawnAsync(organizationId, [candidateId], cancellationToken)
            .ConfigureAwait(false);
        if (withdrawn.Count > 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        await ExecuteFitScoreUpsertAsync(
            organizationId, candidateId, vacancyId, overallScore, breakdownJson, weightsJson, isPartial, now,
            restrictedOverallScore: null, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    private async Task<bool> FitScoreExistsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            FitScoreExistsSql,
            (NpgsqlConnection)_db.Database.GetDbConnection(),
            (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction());
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("cand", NpgsqlDbType.Uuid) { Value = candidateId });
        command.Parameters.Add(new NpgsqlParameter("vac", NpgsqlDbType.Uuid) { Value = vacancyId });
        return (bool)(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false))!;
    }

    // The fit_scores upsert, on the caller's open TenantScope transaction. The C# engine knows both FIT versions, so
    // it marks its write (transaction-local) for the fit_scores_keep_v2 trigger (migration
    // 20261109100000_fit_v2_integrity): only a writer that does NOT set this is kept from replacing a v2 row with v1.
    private async Task ExecuteFitScoreUpsertAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
        string weightsJson, bool isPartial, DateTimeOffset now, double? restrictedOverallScore,
        CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        await using (var mark = new NpgsqlCommand(FitV2AwareWriterSql, connection, transaction))
        {
            await mark.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var command = new NpgsqlCommand(FitScoreUpsertSql, connection, transaction);
        command.Parameters.Add(new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = Guid.NewGuid() });
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("cand", NpgsqlDbType.Uuid) { Value = candidateId });
        command.Parameters.Add(new NpgsqlParameter("vac", NpgsqlDbType.Uuid) { Value = vacancyId });
        command.Parameters.Add(new NpgsqlParameter("score", NpgsqlDbType.Double) { Value = overallScore });
        command.Parameters.Add(new NpgsqlParameter("breakdown", NpgsqlDbType.Jsonb) { Value = breakdownJson });
        command.Parameters.Add(new NpgsqlParameter("weights", NpgsqlDbType.Jsonb) { Value = weightsJson });
        command.Parameters.Add(new NpgsqlParameter("partial", NpgsqlDbType.Boolean) { Value = isPartial });
        command.Parameters.Add(new NpgsqlParameter("restricted", NpgsqlDbType.Double)
        {
            Value = restrictedOverallScore is { } restricted ? restricted : DBNull.Value,
        });
        command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });

        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task<bool> UpsertFitScoreV2Async(
        Guid organizationId, Guid candidateId, Guid vacancyId, string weightsJson, DateTimeOffset now,
        Func<CancellationToken, Task<FitScoreWrite>> buildInLock, CancellationToken cancellationToken,
        bool onlyIfRowExists = false)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // #312 first (the same lock and re-check as the v1 write), so the lock order is always consent → FIT v2.
        await CandidateConsentLocks.LockCandidateAndSiblingsAsync(_db.Database, organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        var withdrawn = await QueryWithdrawnAsync(organizationId, [candidateId], cancellationToken)
            .ConfigureAwait(false);
        if (withdrawn.Count > 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        // The FIT v2 lock: every v2 compute for this (org, candidate, vacancy) reads its results and writes the row
        // while holding it, so no compute can write a value read before another compute's write. It does not rely
        // on the consent lock above, which serves a different purpose.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({FitV2LockKey(organizationId, candidateId, vacancyId)}, 0))",
            cancellationToken).ConfigureAwait(false);

        // A recompute keeps an existing row current and never creates one. Checked under the lock: a first compute
        // still in flight holds it, so its row is visible here once it commits.
        if (onlyIfRowExists && !await FitScoreExistsAsync(organizationId, candidateId, vacancyId, cancellationToken)
                .ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return false;
        }

        // The in-lock read and evaluation, on this open transaction. A throw or a cancellation here (or in the write
        // below) disposes the scope without a commit: rollback, and the stored row is untouched.
        var write = await buildInLock(cancellationToken).ConfigureAwait(false);

        await ExecuteFitScoreUpsertAsync(
            organizationId, candidateId, vacancyId, write.OverallScore, write.BreakdownJson, weightsJson,
            write.IsPartial, now, write.RestrictedOverallScore, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    public async Task<string?> UpsertFitRequirementsAsync(
        Guid organizationId, Guid vacancyId, string fitRequirementsJson, bool replaceAssessments, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // The merge happens in the statement itself: a concurrent writer can never make this drop an array it did not
        // see. disc_targets/competencies are NOT NULL with a '{}' Prisma default (client-side), so the insert sets them.
        const string sql =
            "INSERT INTO job_profiles (id, organization_id, vacancy_id, disc_targets, competencies, fit_requirements, "
            + "created_at, updated_at) "
            + "VALUES (@id, @org, @vac, '{}'::jsonb, '{}'::jsonb, @fit, @now, @now) "
            + "ON CONFLICT (vacancy_id) DO UPDATE SET "
            + "fit_requirements = CASE WHEN @replace THEN EXCLUDED.fit_requirements "
            + "ELSE EXCLUDED.fit_requirements || CASE "
            + "WHEN jsonb_typeof(job_profiles.fit_requirements) = 'object' AND job_profiles.fit_requirements ? 'assessments' "
            + "THEN jsonb_build_object('assessments', job_profiles.fit_requirements -> 'assessments') "
            + "ELSE '{}'::jsonb END END, "
            + "updated_at = EXCLUDED.updated_at "
            + "WHERE job_profiles.organization_id = @org "
            + "RETURNING fit_requirements::text";

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        // This writer understands `assessments` (it removes the key only on an explicit null): mark it for the
        // job_profiles_keep_assessments trigger, which keeps the array against every other writer.
        await using (var mark = new NpgsqlCommand(FitV2AwareWriterSql, connection, transaction))
        {
            await mark.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.Add(new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = Guid.NewGuid() });
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("vac", NpgsqlDbType.Uuid) { Value = vacancyId });
        command.Parameters.Add(new NpgsqlParameter("fit", NpgsqlDbType.Jsonb) { Value = fitRequirementsJson });
        command.Parameters.Add(new NpgsqlParameter("replace", NpgsqlDbType.Boolean) { Value = replaceAssessments });
        command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });

        var stored = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) as string;
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return stored;
    }

    /// <summary>The FIT v2 per-(organization, candidate, vacancy) advisory-lock key text.</summary>
    public static string FitV2LockKey(Guid organizationId, Guid candidateId, Guid vacancyId) =>
        $"fit_v2:{organizationId}:{candidateId}:{vacancyId}";

    public async Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // status = 'active' is a LITERAL on a plain-String column — no enum binding hazard (TRAP 8 N/A).
        var ids = await _db.Applications.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && a.VacancyId == vacancyId && a.Status == "active")
            .Select(a => a.CandidateId)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ids;
    }

    public async Task<IReadOnlySet<Guid>> GetConsentWithdrawnCandidateIdsAsync(
        Guid organizationId, IReadOnlyCollection<Guid> candidateIds, CancellationToken cancellationToken)
    {
        var ids = candidateIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new HashSet<Guid>();
        }

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        var withdrawn = await QueryWithdrawnAsync(organizationId, ids, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return withdrawn;
    }

    // The withdrawn-consent query, run on the caller's open TenantScope transaction (the pre-loop check and the
    // per-candidate re-check inside the upsert share it).
    private Task<HashSet<Guid>> QueryWithdrawnAsync(
        Guid organizationId, List<Guid> ids, CancellationToken cancellationToken) =>
        QueryWithdrawnAsync(_db, organizationId, ids, cancellationToken);

    /// <summary>
    /// #312: which of <paramref name="ids"/> have a withdrawn recruitment consent (directly or through a same-org
    /// candidate with the same normalized email), on the caller's open TenantScope transaction. Shared by the FIT
    /// writes and essay grading (<see cref="EssayGradingRepository"/>).
    /// </summary>
    internal static async Task<HashSet<Guid>> QueryWithdrawnAsync(
        FitEngineWriteDbContext db, Guid organizationId, List<Guid> ids, CancellationToken cancellationToken)
    {
        var withdrawn = new HashSet<Guid>();

        // (1) Direct: the candidate itself is the withdrawn subject. Independent of the candidates table, so a
        //     pipeline id with no (or a soft-deleted) candidate row is still caught.
        var direct = await db.DataConsents.AsNoTracking()
            .Where(dc => dc.OrganizationId == organizationId
                && dc.ConsentType == RecruitmentConsentType
                && dc.WithdrawnAt != null
                && ids.Contains(dc.SubjectUserId))
            .Select(dc => dc.SubjectUserId)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        withdrawn.UnionWith(direct);

        // (2) Same person, other row: ANY same-org candidate whose lower(btrim(email)) EQUALS the target's carries a
        //     withdrawn consent (CandidateConsentRepository.WithdrawByEmailAsync withdraws per row, so a duplicate
        //     row may hold the only withdrawal). Exact equality — never LIKE, so `_`/`%` are literal. A blank
        //     normalized email never groups rows (it identifies nobody). Both sides explicitly org-filtered; RLS
        //     under TenantScope is the second layer.
        var viaEmail = await (
                from target in db.Candidates.AsNoTracking()
                where target.OrganizationId == organizationId
                    && ids.Contains(target.Id)
                    && target.Email.Trim() != string.Empty
                    && db.DataConsents.Any(dc => dc.OrganizationId == organizationId
                        && dc.ConsentType == RecruitmentConsentType
                        && dc.WithdrawnAt != null
                        && db.Candidates.Any(other => other.OrganizationId == organizationId
                            && other.Id == dc.SubjectUserId
                            && other.Email.Trim().ToLower() == target.Email.Trim().ToLower()))
                select target.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        withdrawn.UnionWith(viaEmail);
        return withdrawn;
    }

    // data_consents.consent_type for candidate recruitment processing (#312/#313) — mirrors
    // CandidateConsentConstants.ConsentType; duplicated so FitEngine does not depend on the consent slice.
    private const string RecruitmentConsentType = "recruitment_data_processing";

    /// <summary>The transaction-local marker the fit_scores_keep_v2 trigger accepts as a FIT v2-aware writer.</summary>
    public const string FitV2AwareWriterSql = "SELECT set_config('tims.fit_writer', 'fit_v2_aware', true)";

    private const string FitScoreExistsSql =
        "SELECT EXISTS (SELECT 1 FROM fit_scores WHERE organization_id = @org AND candidate_id = @cand "
        + "AND vacancy_id = @vac)";

    // restricted_overall_score (migration 20261109100000_fit_v2_integrity): the D6 overall of a v2 row, NULL otherwise.
    private const string FitScoreUpsertSql =
        "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, restricted_overall_score, "
        + "breakdown, weights, is_partial, calculated_at, created_at, updated_at) "
        + "VALUES (@id, @org, @cand, @vac, @score, @restricted, @breakdown, @weights, @partial, @now, @now, @now) "
        + "ON CONFLICT (candidate_id, vacancy_id) "
        + "DO UPDATE SET overall_score = EXCLUDED.overall_score, "
        + "restricted_overall_score = EXCLUDED.restricted_overall_score, breakdown = EXCLUDED.breakdown, "
        + "weights = EXCLUDED.weights, is_partial = EXCLUDED.is_partial, "
        + "calculated_at = EXCLUDED.calculated_at, updated_at = EXCLUDED.updated_at";

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it,
    // so bind the UTC wall-clock as Unspecified-kind, ms-truncated (what a JS `new Date()` persists) — matches
    // the engagement/succession staff writes.
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }
}
