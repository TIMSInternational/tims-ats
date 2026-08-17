using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// EF implementation of <see cref="IFitEngineWriteRepository"/> — the data steps of <c>computeForVacancy</c> /
/// <c>upsertRoleFamilyWeightProfile</c> (fit-engine.repository.ts). Reads AsNoTracking; the two upserts are raw
/// <c>INSERT … ON CONFLICT DO UPDATE</c> (EF has no native upsert; mirrors the nine-box vote / fx-rate raw
/// upserts — and Prisma emits the same statement for these eligible upserts, so the write is atomic in BOTH
/// stacks). Every op runs UNDER <see cref="TenantScope"/> with explicit organizationId filters/values.
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

    public async Task UpsertFitScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
        string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken)
    {
        const string sql =
            "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, "
            + "weights, is_partial, calculated_at, created_at, updated_at) "
            + "VALUES (@id, @org, @cand, @vac, @score, @breakdown, @weights, @partial, @now, @now, @now) "
            + "ON CONFLICT (candidate_id, vacancy_id) "
            + "DO UPDATE SET overall_score = EXCLUDED.overall_score, breakdown = EXCLUDED.breakdown, "
            + "weights = EXCLUDED.weights, is_partial = EXCLUDED.is_partial, "
            + "calculated_at = EXCLUDED.calculated_at, updated_at = EXCLUDED.updated_at";

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.Add(new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = Guid.NewGuid() });
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("cand", NpgsqlDbType.Uuid) { Value = candidateId });
        command.Parameters.Add(new NpgsqlParameter("vac", NpgsqlDbType.Uuid) { Value = vacancyId });
        command.Parameters.Add(new NpgsqlParameter("score", NpgsqlDbType.Double) { Value = overallScore });
        command.Parameters.Add(new NpgsqlParameter("breakdown", NpgsqlDbType.Jsonb) { Value = breakdownJson });
        command.Parameters.Add(new NpgsqlParameter("weights", NpgsqlDbType.Jsonb) { Value = weightsJson });
        command.Parameters.Add(new NpgsqlParameter("partial", NpgsqlDbType.Boolean) { Value = isPartial });
        command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });

        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

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

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it,
    // so bind the UTC wall-clock as Unspecified-kind, ms-truncated (what a JS `new Date()` persists) — matches
    // the engagement/succession staff writes.
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }
}
