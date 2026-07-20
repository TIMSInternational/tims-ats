using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Quartz;
using Quartz.Impl.Matchers;
using Tims.Workers;
using Tims.Workers.Scheduling;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// Phase-4 Slice-2: boots the REAL Tims.Workers host (its actual Program.cs wiring) with
/// <c>Workers:ClusteredSchedulerEnabled=true</c> against a real Postgres carrying the shipped <c>qrtz_*</c>
/// schema. Proves three things the RAMJobStore path never could: (1) the production path stands up on the
/// clustered ADO store and registers a cluster node in Postgres; (2) a scheduled job actually fires THROUGH the
/// persistent store; (3) rebooting against a POPULATED store does NOT throw <c>ObjectAlreadyExistsException</c>
/// nor duplicate the durable job. <c>HrisSyncEnabled=false</c> so the HRIS trigger never fires (the qrtz-only
/// DB has no <c>hris_*</c> tables; the sweep must never run here).
///
/// All tests boot via <see cref="WebApplicationFactory{T}"/> (never a raw disposed <c>ServiceProvider</c>):
/// Quartz's global <c>LogProvider</c> is a process static, and disposing a bare Quartz-registered container
/// mid-run poisons it for later boots — the WebApplicationFactory pattern (as the existing worker-host tests
/// use) does not. A single node here because <c>SchedulerRepository</c> is a process static (see
/// <see cref="QuartzClusterCollection"/>); concurrent multi-node fire-exactly-once is Quartz's upstream-tested
/// shared-store cluster lock — what this slice OWNS (store wiring, schema consistency, real firing, reboot
/// safety) is what these tests pin.
/// </summary>
[Collection(QuartzClusterCollection.Name)]
public sealed class QuartzClusteredHostTests
{
    private readonly QuartzClusterFixture _fixture;

    public QuartzClusteredHostTests(QuartzClusterFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Clustered_host_boots_on_the_persistent_store_and_registers_a_cluster_node()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // Liveness up ⇒ the host (and thus the Quartz hosted service, which validates the qrtz_* schema at
        // start under PerformSchemaValidation=true) booted successfully against the persistent store.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        var scheduler = await factory.Services.GetRequiredService<ISchedulerFactory>().GetScheduler();
        Assert.True(scheduler.IsStarted);
        Assert.Equal(QuartzScheduleBuilder.ClusteredSchedulerName, scheduler.SchedulerName);

        // The durable HRIS job is stored (no trigger — HrisSyncEnabled=false).
        var jobKeys = await scheduler.GetJobKeys(GroupMatcher<JobKey>.AnyGroup());
        Assert.Contains(QuartzScheduleBuilder.HrisSyncJobKey, jobKeys);

        // A cluster node checked in to qrtz_scheduler_state — the ADO cluster store at work, which a
        // RAMJobStore would NEVER write. Bite: flip ClusteredSchedulerEnabled off → RAM → this stays 0.
        await WaitUntilAsync(async () => await _fixture.SchedulerStateRowCountAsync() >= 1, TimeSpan.FromSeconds(15));
        Assert.True(await _fixture.SchedulerStateRowCountAsync() >= 1);
    }

    [Fact]
    public async Task A_scheduled_job_fires_through_the_clustered_postgres_store()
    {
        await using var factory = FactoryWithCounter();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        var counter = factory.Services.GetRequiredService<JobRunCounter>();
        var scheduler = await factory.Services.GetRequiredService<ISchedulerFactory>().GetScheduler();

        // Schedule a one-shot job on the RUNNING clustered scheduler; it must fire through the Postgres store.
        var job = JobBuilder.Create<CounterJob>().WithIdentity("counter-job", "test").Build();
        var trigger = TriggerBuilder.Create().WithIdentity("counter-trigger", "test").StartNow().Build();
        await scheduler.ScheduleJob(job, trigger);

        await WaitUntilAsync(() => Task.FromResult(counter.Count >= 1), TimeSpan.FromSeconds(30));

        // Fired exactly once (a one-shot trigger, not re-fired) — end-to-end through the persistent store.
        Assert.Equal(1, counter.Count);
    }

    [Fact]
    public async Task Rebooting_against_the_populated_store_does_not_throw_or_duplicate_the_job()
    {
        // First boot: schedules the durable HRIS job into the persistent store, then fully shuts down.
        await using (var first = Factory())
        {
            using var client = first.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        }

        Assert.Equal(1, await _fixture.JobDetailRowCountAsync(QuartzScheduleBuilder.HrisSyncJobKey.Name));

        // Second boot against the SAME populated store: AddJob(StoreDurably) must REPLACE, not throw
        // ObjectAlreadyExistsException. A 200 here proves the reboot path is safe on a persistent store.
        await using (var second = Factory())
        {
            using var client = second.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);
        }

        // Still exactly one — the reboot replaced the row, it did not accumulate a duplicate.
        Assert.Equal(1, await _fixture.JobDetailRowCountAsync(QuartzScheduleBuilder.HrisSyncJobKey.Name));
    }

    [Fact]
    public async Task The_hris_cron_trigger_persists_into_the_store_under_clustering()
    {
        // HrisSyncEnabled=true exercises Configure's AddTrigger(WithCronSchedule) path against the PERSISTENT
        // store (the reboot/boot tests use HrisSyncEnabled=false = durable job only). A 5am cron won't fire
        // during the test window, so the sweep never runs (the qrtz-only DB has no hris_* tables).
        await using var factory = Factory().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Workers:HrisSyncEnabled", "true");
            builder.UseSetting("Workers:HrisSyncCron", "0 0 5 * * ?");
        });
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health")).StatusCode);

        var scheduler = await factory.Services.GetRequiredService<ISchedulerFactory>().GetScheduler();
        var triggers = await scheduler.GetTriggersOfJob(QuartzScheduleBuilder.HrisSyncJobKey);
        Assert.Single(triggers.OfType<ICronTrigger>());

        // The cron trigger was written THROUGH the persistent store, not just held in RAM.
        Assert.True(await _fixture.CronTriggerRowCountAsync() >= 1);
    }

    [Fact]
    public async Task The_shipped_grant_lets_app_tenant_use_the_qrtz_tables()
    {
        // The fixture's scheduler connects as the container superuser (bypasses grants), so the DDL's
        // GRANT ... TO app_tenant would otherwise be untested. Prove it is effective: as app_tenant, a
        // qrtz_locks write must succeed (a typo'd/absent grant raises 42501 permission-denied here).
        await _fixture.WriteQrtzAsAppTenantAsync();
    }

    private WebApplicationFactory<WorkerHostMarker> Factory() =>
        new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Workers:ClusteredSchedulerEnabled", "true");
            builder.UseSetting("Workers:HrisSyncEnabled", "false");
            builder.UseSetting("Workers:SchedulerCheckinIntervalSeconds", "1");
        });

    private WebApplicationFactory<WorkerHostMarker> FactoryWithCounter() =>
        Factory().WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<JobRunCounter>();
            services.AddTransient<CounterJob>();
        }));

    private static async Task WaitUntilAsync(Func<Task<bool>> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(200);
        }
    }
}

/// <summary>DI singleton counting job executions — no process-wide statics, so each host is isolated.</summary>
internal sealed class JobRunCounter
{
    private int _count;

    public int Count => Volatile.Read(ref _count);

    public void Increment() => Interlocked.Increment(ref _count);
}

/// <summary>A trivial <see cref="IJob"/> that bumps the injected <see cref="JobRunCounter"/> — used only to
/// observe that the clustered persistent store actually fires a scheduled job.</summary>
internal sealed class CounterJob : IJob
{
    private readonly JobRunCounter _counter;

    public CounterJob(JobRunCounter counter) => _counter = counter;

    public Task Execute(IJobExecutionContext context)
    {
        _counter.Increment();
        return Task.CompletedTask;
    }
}
