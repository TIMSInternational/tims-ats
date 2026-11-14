using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// The vacancy assessments editor's persistence: raw SQL on the <see cref="FitEngineWriteDbContext"/> connection, under
/// <see cref="TenantScope"/> (app_tenant + the org GUC, so <c>job_profiles</c> RLS applies) AND an explicit
/// <c>organization_id</c> filter. Only <c>fit_requirements -&gt; 'assessments'</c> is read or replaced; every other key is
/// carried over inside the UPDATE itself. The version token is computed by the database (<c>md5</c> of the jsonb text,
/// which Postgres prints canonically), so the read and the conditional write compare like with like.
/// </summary>
public sealed class FitAssessmentRequirementsRepository(FitEngineWriteDbContext db) : IFitAssessmentRequirementsRepository
{
    private const string VersionOf = "md5(coalesce(fit_requirements -> 'assessments', 'null'::jsonb)::text)";

    private const string ReadSql =
        "SELECT (fit_requirements -> 'assessments')::text, " + VersionOf + " FROM job_profiles "
        + "WHERE vacancy_id = @vac AND organization_id = @org";

    private const string LockSql =
        "SELECT id, " + VersionOf + " FROM job_profiles WHERE vacancy_id = @vac AND organization_id = @org FOR UPDATE";

    // A non-object fit_requirements (never written by either writer, but jsonb allows it) restarts from {}.
    private const string UpdateSql =
        "UPDATE job_profiles SET fit_requirements = "
        + "(CASE WHEN jsonb_typeof(fit_requirements) = 'object' THEN fit_requirements ELSE '{}'::jsonb END) "
        + "|| jsonb_build_object('assessments', @assessments), updated_at = @now "
        + "WHERE id = @id AND organization_id = @org "
        + "RETURNING (fit_requirements -> 'assessments')::text, " + VersionOf;

    // disc_targets/competencies are NOT NULL with a client-side Prisma default, so the insert sets them (as the
    // requirements writer does).
    private const string InsertSql =
        "INSERT INTO job_profiles (id, organization_id, vacancy_id, disc_targets, competencies, fit_requirements, "
        + "created_at, updated_at) "
        + "VALUES (@id, @org, @vac, '{}'::jsonb, '{}'::jsonb, jsonb_build_object('assessments', @assessments), @now, @now) "
        + "ON CONFLICT (vacancy_id) DO NOTHING "
        + "RETURNING (fit_requirements -> 'assessments')::text, " + VersionOf;

    /// <summary>The version of an absent array (no profile row, or no <c>assessments</c> key).</summary>
    private const string AbsentVersionSql = "SELECT md5('null'::jsonb::text)";

    private readonly FitEngineWriteDbContext _db = db;

    public async Task<StoredAssessmentRequirements> ReadAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = Connection();
        var stored = await ReadRowAsync(connection, transaction, organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return stored;
    }

    public async Task<AssessmentRequirementsWriteResult> ReplaceAsync(
        Guid organizationId, Guid vacancyId, string assessmentsJson, string expectedVersion, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var (connection, transaction) = Connection();

        // Every write here SETS the `assessments` key (an empty array included), so the job_profiles_keep_assessments
        // trigger, which acts only on an update that drops the key, never interferes: no writer marker is needed.

        Guid? rowId = null;
        string? currentVersion = null;
        await using (var lockCommand = new NpgsqlCommand(LockSql, connection, transaction))
        {
            AddKeys(lockCommand, organizationId, vacancyId);
            await using var reader = await lockCommand.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                rowId = reader.GetGuid(0);
                currentVersion = reader.GetString(1);
            }
        }

        currentVersion ??= await AbsentVersionAsync(connection, transaction, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(currentVersion, expectedVersion, StringComparison.Ordinal))
        {
            var current = await ReadRowAsync(connection, transaction, organizationId, vacancyId, cancellationToken)
                .ConfigureAwait(false);
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AssessmentRequirementsWriteResult(false, current.AssessmentsJson, current.Version);
        }

        await using var write = rowId is null
            ? new NpgsqlCommand(InsertSql, connection, transaction)
            : new NpgsqlCommand(UpdateSql, connection, transaction);
        AddKeys(write, organizationId, vacancyId);
        write.Parameters.Add(new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = rowId ?? Guid.NewGuid() });
        write.Parameters.Add(new NpgsqlParameter("assessments", NpgsqlDbType.Jsonb) { Value = assessmentsJson });
        write.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });
        string? storedJson = null;
        string? storedVersion = null;
        await using (var reader = await write.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                storedJson = reader.IsDBNull(0) ? null : reader.GetString(0);
                storedVersion = reader.GetString(1);
            }
        }

        if (storedVersion is null)
        {
            // The insert lost to a concurrent one (ON CONFLICT DO NOTHING): the array is no longer "absent".
            var current = await ReadRowAsync(connection, transaction, organizationId, vacancyId, cancellationToken)
                .ConfigureAwait(false);
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AssessmentRequirementsWriteResult(false, current.AssessmentsJson, current.Version);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new AssessmentRequirementsWriteResult(true, storedJson, storedVersion);
    }

    private (NpgsqlConnection Connection, NpgsqlTransaction Transaction) Connection() =>
        ((NpgsqlConnection)_db.Database.GetDbConnection(),
            (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction());

    private static async Task<StoredAssessmentRequirements> ReadRowAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, Guid organizationId, Guid vacancyId,
        CancellationToken cancellationToken)
    {
        await using (var command = new NpgsqlCommand(ReadSql, connection, transaction))
        {
            AddKeys(command, organizationId, vacancyId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                return new StoredAssessmentRequirements(reader.IsDBNull(0) ? null : reader.GetString(0), reader.GetString(1));
            }
        }

        return new StoredAssessmentRequirements(
            null, await AbsentVersionAsync(connection, transaction, cancellationToken).ConfigureAwait(false));
    }

    private static async Task<string> AbsentVersionAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(AbsentVersionSql, connection, transaction);
        return (string)(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false))!;
    }

    private static void AddKeys(NpgsqlCommand command, Guid organizationId, Guid vacancyId)
    {
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("vac", NpgsqlDbType.Uuid) { Value = vacancyId });
    }

    // Prisma `timestamp(3) without time zone`: the UTC wall clock as Unspecified kind, ms-truncated (TRAP 10/11).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }
}
