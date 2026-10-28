using System.Diagnostics;
using Npgsql;
using Tims.Application.PlatformHealth;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// Reads Tims.Workers' heartbeat: Quartz's clustered ADO store has every scheduler node write
/// <c>last_checkin_time</c> (epoch ms) to <c>qrtz_scheduler_state</c> every <c>checkin_interval</c> ms. That is
/// the ONLY heartbeat Tims.Workers records — the in-memory (non-clustered) mode records none — so when the table
/// is absent or empty this reports <c>not_monitored / not_deployed</c> rather than inventing a state.
///
/// <para>Raw read-only SQL (no EF map, so no ownership-ledger entry): <c>to_regclass</c> first, so a database
/// without the Quartz DDL is a clean "not deployed" instead of an error. The connection string is the
/// platform's own; it is never logged.</para>
/// </summary>
public sealed class WorkerHeartbeatProbe(string connectionString, TimeProvider clock) : IDependencyProbe
{
    /// <summary>
    /// Tims.Workers' Quartz scheduler name (<c>QuartzScheduleBuilder.ClusteredSchedulerName</c>; pinned equal by
    /// WorkerHeartbeatProbeTests). Only TIMS nodes count: a fresh row from any other scheduler sharing the
    /// database must not make dead TIMS workers look operational (tier-1 review).
    /// </summary>
    public const string SchedulerName = "TimsWorkersScheduler";

    public string Id => DependencyIds.Jobs;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotConfigured, DependencyReason.MissingConfig);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await using var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);

            await using (var exists = connection.CreateCommand())
            {
                exists.CommandText = "SELECT to_regclass('qrtz_scheduler_state') IS NOT NULL";
                exists.CommandTimeout = 2;
                if (await exists.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not true)
                {
                    return DependencyHealthClassifier.ClassifyWorkerHeartbeat(false, 0, null, null, clock.GetUtcNow(), stopwatch.ElapsedMilliseconds);
                }
            }

            await using var command = connection.CreateCommand();
            // Freshness is judged PER NODE: the node whose own staleness deadline
            // (last check-in + max(3 x its interval, the minimum)) is latest is the one that decides. Taking
            // max(last_checkin_time) and max(checkin_interval) from DIFFERENT rows let two stale nodes add up
            // to an operational result (tier-1 review).
            command.CommandText = """
                SELECT count(*) OVER ()::int, last_checkin_time, checkin_interval
                FROM qrtz_scheduler_state
                WHERE sched_name = @sched
                ORDER BY last_checkin_time + greatest(3 * checkin_interval, @min_ms) DESC
                LIMIT 1
                """;
            command.Parameters.AddWithValue("sched", SchedulerName);
            command.Parameters.AddWithValue("min_ms", (long)DependencyHealthClassifier.MinimumHeartbeatStaleness.TotalMilliseconds);
            command.CommandTimeout = 2;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var nodes = 0;
            long? last = null;
            long? interval = null;
            if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                nodes = reader.GetInt32(0);
                last = reader.IsDBNull(1) ? null : reader.GetInt64(1);
                interval = reader.IsDBNull(2) ? null : reader.GetInt64(2);
            }
            return DependencyHealthClassifier.ClassifyWorkerHeartbeat(true, nodes, last, interval, clock.GetUtcNow(), stopwatch.ElapsedMilliseconds);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.AccessDenied, stopwatch.ElapsedMilliseconds);
        }
        catch (NpgsqlException)
        {
            // The heartbeat store (the platform database) is unreachable: the heartbeat cannot be read, which is
            // not the same as the workers being down — the database row on the page reports the outage itself.
            return DependencyProbeResult.Of(Id, DependencyStatus.NotMonitored, DependencyReason.ProbeFailed, stopwatch.ElapsedMilliseconds);
        }
    }
}
