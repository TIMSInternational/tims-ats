using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Raw-SQL <see cref="IFitRecomputeQueue"/> over <c>fit_recompute_requests</c> (Prisma-owned DDL, migration
/// 20261109100000_fit_v2_integrity; the triggers there are its only inserters). Times are the database clock
/// (<c>clock_timestamp()</c>, <c>timestamptz</c>), never the app's, so the triggers' <c>available_at</c> and the
/// worker's lease compare on one clock. The organization listing runs pre-tenant on the privileged connection (only
/// organization ids leave it, like the provider withdrawal sweep); every claim, completion and failure runs under the
/// organization's <see cref="TenantScope"/> with an explicit organization filter.
/// </summary>
public sealed class FitRecomputeQueueRepository(FitEngineWriteDbContext db) : IFitRecomputeQueue
{
    /// <summary>The first lease: a failed or crashed recompute is retried after this, doubling per claim (≤ 64 min).</summary>
    public static readonly TimeSpan BaseLease = TimeSpan.FromMinutes(1);

    private readonly FitEngineWriteDbContext _db = db;

    public async Task<IReadOnlyList<Guid>> ListOrganizationsWithDueRequestsAsync(
        int max, CancellationToken cancellationToken)
    {
        const string sql =
            "SELECT organization_id FROM fit_recompute_requests "
            + "WHERE available_at <= clock_timestamp() AND attempts < @maxAttempts "
            + "GROUP BY organization_id ORDER BY min(available_at), organization_id LIMIT @max";
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;
        if (opened)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }

        try
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.Add(new NpgsqlParameter("maxAttempts", NpgsqlDbType.Integer)
            {
                Value = FitRecomputeUseCase.MaxAttempts,
            });
            command.Parameters.Add(new NpgsqlParameter("max", NpgsqlDbType.Integer) { Value = max });
            var ids = new List<Guid>();
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                ids.Add(reader.GetGuid(0));
            }

            return ids;
        }
        finally
        {
            if (opened)
            {
                await connection.CloseAsync().ConfigureAwait(false);
            }
        }
    }

    public async Task<IReadOnlyList<FitRecomputeRequest>> ClaimAsync(
        Guid organizationId, int max, CancellationToken cancellationToken)
    {
        const string sql =
            "UPDATE fit_recompute_requests r SET attempts = r.attempts + 1, "
            + "available_at = clock_timestamp() + make_interval(secs => @leaseSeconds * power(2, least(r.attempts, 6))) "
            + "FROM (SELECT candidate_id, vacancy_id FROM fit_recompute_requests "
            + "WHERE organization_id = @org AND available_at <= clock_timestamp() AND attempts < @maxAttempts "
            + "ORDER BY available_at, candidate_id, vacancy_id LIMIT @max FOR UPDATE SKIP LOCKED) due "
            + "WHERE r.candidate_id = due.candidate_id AND r.vacancy_id = due.vacancy_id AND r.organization_id = @org "
            + "RETURNING r.candidate_id, r.vacancy_id, r.request_seq, r.attempts";

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        var claimed = new List<FitRecomputeRequest>();
        await using (var command = Command(sql))
        {
            command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
            command.Parameters.Add(new NpgsqlParameter("max", NpgsqlDbType.Integer) { Value = max });
            command.Parameters.Add(new NpgsqlParameter("maxAttempts", NpgsqlDbType.Integer)
            {
                Value = FitRecomputeUseCase.MaxAttempts,
            });
            command.Parameters.Add(new NpgsqlParameter("leaseSeconds", NpgsqlDbType.Double)
            {
                Value = BaseLease.TotalSeconds,
            });
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                claimed.Add(new FitRecomputeRequest(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetInt64(2), reader.GetInt32(3)));
            }
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return claimed;
    }

    public async Task<bool> CompleteAsync(
        Guid organizationId, FitRecomputeRequest request, CancellationToken cancellationToken)
    {
        const string sql =
            "DELETE FROM fit_recompute_requests WHERE organization_id = @org AND candidate_id = @c "
            + "AND vacancy_id = @v AND request_seq = @seq";
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        int deleted;
        await using (var command = Command(sql))
        {
            AddKey(command, organizationId, request);
            deleted = await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return deleted > 0;
    }

    public async Task RecordFailureAsync(
        Guid organizationId, FitRecomputeRequest request, string error, CancellationToken cancellationToken)
    {
        const string sql =
            "UPDATE fit_recompute_requests SET last_error = left(@error, 200) WHERE organization_id = @org "
            + "AND candidate_id = @c AND vacancy_id = @v AND request_seq = @seq";
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        await using (var command = Command(sql))
        {
            AddKey(command, organizationId, request);
            command.Parameters.Add(new NpgsqlParameter("error", NpgsqlDbType.Text) { Value = error });
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    private NpgsqlCommand Command(string sql) =>
        new(sql, (NpgsqlConnection)_db.Database.GetDbConnection(),
            (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction());

    private static void AddKey(NpgsqlCommand command, Guid organizationId, FitRecomputeRequest request)
    {
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("c", NpgsqlDbType.Uuid) { Value = request.CandidateId });
        command.Parameters.Add(new NpgsqlParameter("v", NpgsqlDbType.Uuid) { Value = request.VacancyId });
        command.Parameters.Add(new NpgsqlParameter("seq", NpgsqlDbType.Bigint) { Value = request.RequestSeq });
    }
}
