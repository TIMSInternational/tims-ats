using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Testcontainers.PostgreSql;
using Tims.Application.PlatformHealth;
using Tims.Infrastructure.PlatformHealth;
using Tims.IntegrationTests.Workers;
using Tims.Workers;

namespace Tims.IntegrationTests.PlatformHealth;

/// <summary>
/// <see cref="WorkerHeartbeatProbe"/> against a real Postgres carrying the SHIPPED Quartz DDL
/// (<c>db/quartz/quartz-tables_postgres.sql</c>): no table → not_deployed; empty table → not_deployed; fresh
/// check-in → operational; stale check-in → down; a role without SELECT → access_denied (not "down").
/// </summary>
public sealed class WorkerHeartbeatProbeTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .WithDatabase("tims_health_noqrtz")
        .Build();

    private static readonly DateTimeOffset Now = new(2026, 10, 12, 12, 0, 0, TimeSpan.Zero);

    private string _noQuartz = string.Empty;
    private string _quartz = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _noQuartz = _container.GetConnectionString();
        await using (var connection = new NpgsqlConnection(_noQuartz))
        {
            await connection.OpenAsync();
            await using var create = connection.CreateCommand();
            create.CommandText = "CREATE DATABASE tims_health_qrtz;";
            await create.ExecuteNonQueryAsync();
        }

        _quartz = new NpgsqlConnectionStringBuilder(_noQuartz) { Database = "tims_health_qrtz" }.ConnectionString;
        await using (var connection = new NpgsqlConnection(_quartz))
        {
            await connection.OpenAsync();
            await using var ddl = connection.CreateCommand();
            ddl.CommandText = "CREATE ROLE app_tenant NOLOGIN NOBYPASSRLS; "
                + await File.ReadAllTextAsync(System.IO.Path.Combine(AppContext.BaseDirectory, "db", "quartz", "quartz-tables_postgres.sql"))
                + "; CREATE ROLE health_nogrant LOGIN PASSWORD 'nogrant';";
            await ddl.ExecuteNonQueryAsync();
        }
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    private static WorkerHeartbeatProbe Probe(string connectionString) => new(connectionString, new FixedClock(Now));

    [Fact]
    public async Task NoQuartzTables_IsNotDeployed()
    {
        var result = await Probe(_noQuartz).ProbeAsync(CancellationToken.None);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.NotDeployed, result.Reason);
    }

    [Fact]
    public async Task HeartbeatRows_DriveOperationalThenStale()
    {
        // Empty store (the DDL applied, no node ever checked in) — still not deployed.
        await Exec("DELETE FROM qrtz_scheduler_state;");
        var empty = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyReason.NotDeployed, empty.Reason);

        // Two nodes; the freshest checked in 5s ago with a 10s interval → operational.
        await Exec(
            $"INSERT INTO qrtz_scheduler_state VALUES ('{T}','node-a',{Now.AddSeconds(-5).ToUnixTimeMilliseconds()},10000)," +
            $"('{T}','node-b',{Now.AddMinutes(-30).ToUnixTimeMilliseconds()},10000);");
        var fresh = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyStatus.Operational, fresh.Status);
        Assert.Contains(fresh.Metrics, m => m is { Id: "worker_nodes", Value: "2" });
        Assert.Contains(fresh.Metrics, m => m is { Id: "heartbeat_age_s", Value: "5" });

        // Every node silent for 2 minutes → down / heartbeat_stale.
        await Exec($"UPDATE qrtz_scheduler_state SET last_checkin_time = {Now.AddMinutes(-2).ToUnixTimeMilliseconds()};");
        var stale = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyStatus.Down, stale.Status);
        Assert.Equal(DependencyReason.HeartbeatStale, stale.Reason);
    }

    private const string T = WorkerHeartbeatProbe.SchedulerName;

    [Fact]
    public void TheProbeReadsTheSchedulerNameTimsWorkersActuallyUses()
    {
        Assert.Equal(Tims.Workers.Scheduling.QuartzScheduleBuilder.ClusteredSchedulerName, WorkerHeartbeatProbe.SchedulerName);
    }

    [Fact]
    public async Task TwoStaleNodesWithDifferentIntervals_AreDown_NotAddedUpToOperational()
    {
        // Tier-1 review: max(last) from one node and max(interval) from another read as fresh.
        // node-a: seen 120 s ago, 10 s interval (stale after 60 s); node-b: seen 1800 s ago, 300 s interval
        // (stale after 900 s). Both are stale on their own terms.
        await Exec("DELETE FROM qrtz_scheduler_state;");
        await Exec(
            $"INSERT INTO qrtz_scheduler_state VALUES ('{T}','node-a',{Now.AddSeconds(-120).ToUnixTimeMilliseconds()},10000)," +
            $"('{T}','node-b',{Now.AddSeconds(-1800).ToUnixTimeMilliseconds()},300000);");
        var result = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyStatus.Down, result.Status);
        Assert.Equal(DependencyReason.HeartbeatStale, result.Reason);
    }

    [Fact]
    public async Task AFreshUnrelatedScheduler_CannotMaskStaleTimsWorkers()
    {
        await Exec("DELETE FROM qrtz_scheduler_state;");
        await Exec(
            $"INSERT INTO qrtz_scheduler_state VALUES ('{T}','tims-node',{Now.AddMinutes(-30).ToUnixTimeMilliseconds()},10000)," +
            $"('OtherScheduler','other-node',{Now.AddSeconds(-1).ToUnixTimeMilliseconds()},10000);");
        var result = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyStatus.Down, result.Status);
        Assert.Contains(result.Metrics, m => m is { Id: "worker_nodes", Value: "1" });

        await Exec($"DELETE FROM qrtz_scheduler_state WHERE sched_name = '{T}';");
        var none = await Probe(_quartz).ProbeAsync(CancellationToken.None);
        Assert.Equal(DependencyReason.NotDeployed, none.Reason);
    }

    [Fact]
    public async Task ARoleWithoutSelect_IsAccessDenied_NotDown()
    {
        var noGrant = new NpgsqlConnectionStringBuilder(_quartz) { Username = "health_nogrant", Password = "nogrant" }.ConnectionString;

        var result = await Probe(noGrant).ProbeAsync(CancellationToken.None);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.AccessDenied, result.Reason);
    }

    [Fact]
    public async Task AnUnreachableDatabase_IsNotMonitored_NotAClaimAboutTheWorkers()
    {
        var result = await Probe("Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=2")
            .ProbeAsync(CancellationToken.None);

        Assert.Equal(DependencyStatus.NotMonitored, result.Status);
        Assert.Equal(DependencyReason.ProbeFailed, result.Reason);
    }

    private async Task Exec(string sql)
    {
        await using var connection = new NpgsqlConnection(_quartz);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}

/// <summary>
/// The end-to-end proof that the heartbeat the probe reads is the one Tims.Workers really writes: boots the REAL
/// clustered worker host, waits for its Quartz node to check in, then probes the same database.
/// </summary>
[Collection(QuartzClusterCollection.Name)]
public sealed class WorkerHeartbeatProbeRealWorkerTests(QuartzClusterFixture fixture)
{
    [Fact]
    public async Task ARealClusteredWorkerNode_IsReportedOperational()
    {
        await using var factory = new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Workers:ClusteredSchedulerEnabled", "true");
            builder.UseSetting("Workers:HrisSyncEnabled", "false");
            builder.UseSetting("Workers:SchedulerCheckinIntervalSeconds", "1");
        });
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while (DateTime.UtcNow < deadline && await fixture.SchedulerStateRowCountAsync() < 1)
        {
            await Task.Delay(200);
        }

        var result = await new WorkerHeartbeatProbe(fixture.ConnectionString, TimeProvider.System).ProbeAsync(CancellationToken.None);

        Assert.Equal(DependencyStatus.Operational, result.Status);
        Assert.Null(result.Reason);
    }
}
