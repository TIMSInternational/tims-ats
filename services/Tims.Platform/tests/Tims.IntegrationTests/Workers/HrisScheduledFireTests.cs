using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Quartz;
using Tims.Application.Audit;
using Tims.Application.Hris;
using Tims.Domain.Audit;
using Tims.Domain.Hris;
using Tims.Workers;
using Tims.Workers.Hris;
using Tims.Workers.Scheduling;

namespace Tims.IntegrationTests.Workers;

/// <summary>
/// WP4.1 regression gate — the HRIS background sweep, now wrapped by the Quartz job + <c>ResilientJobRunner</c>,
/// still behaves under the scheduler. Boots the real Tims.Workers host, replaces the HRIS ports with FAKES,
/// resolves <see cref="HrisSyncQuartzJob"/> from a fresh per-fire DI scope, and drives <c>Execute</c> directly.
///
/// REGRESSION (Codex Low#2, per-connector ISOLATION): one connector's config-load throwing while another is
/// reachable must still process the rest and must NOT throw out of <c>Execute</c>. RUNNER CONTRACT: a
/// whole-sweep fault is retried then swallowed on give-up — <c>Execute</c> returns normally, never
/// destabilising the scheduler. (Bite proof: making the runner rethrow on give-up turns the second fact red.)
/// </summary>
[Collection(WorkerHostCollection.Name)]
public sealed class HrisScheduledFireTests
{
    private static readonly Guid FailingConnector = Guid.Parse("11111111-0000-0000-0000-0000000000f1");
    private static readonly Guid HealthyConnector = Guid.Parse("22222222-0000-0000-0000-0000000000f2");

    private static WebApplicationFactory<WorkerHostMarker> Factory(Action<IServiceCollection> overrideServices) =>
        new WebApplicationFactory<WorkerHostMarker>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x;Password=x");
            // No live trigger (we call Execute directly) + instant, bounded retries.
            builder.UseSetting("Workers:HrisSyncEnabled", "false");
            builder.UseSetting("Workers:JobMaxAttempts", "3");
            builder.UseSetting("Workers:JobBaseRetryDelayMilliseconds", "0");
            builder.ConfigureServices(overrideServices);
        });

    [Fact]
    public async Task Scheduled_fire_isolates_one_connector_failure_and_processes_the_rest()
    {
        var readRepo = new ThrowingThenReachableReadRepository(FailingConnector, HealthyConnector);
        await using var factory = Factory(services =>
        {
            services.RemoveAll<IHrisConnectorReadRepository>();
            services.AddSingleton<IHrisConnectorReadRepository>(readRepo);
            services.RemoveAll<IHrisSyncRepository>();
            services.AddSingleton<IHrisSyncRepository>(new UnusedSyncRepository());
            services.RemoveAll<IHrisConnectorFactory>();
            services.AddSingleton<IHrisConnectorFactory>(new UnusedConnectorFactory());
            services.RemoveAll<IDataAccessAuditor>();
            services.AddSingleton<IDataAccessAuditor>(new NoOpAuditor());
        });

        using var scope = factory.Services.CreateScope();
        var job = scope.ServiceProvider.GetRequiredService<HrisSyncQuartzJob>();

        // Must NOT throw out of Execute — the per-connector failure is isolated inside the sweep.
        await job.Execute(new FakeJobExecutionContext(CancellationToken.None));

        Assert.Equal(1, readRepo.ListCallCount); // sweep ran once (no give-up path)
        Assert.True(readRepo.FailingConnectorAttempted);
        Assert.True(readRepo.HealthyConnectorReached); // continued past the first connector's throw
    }

    [Fact]
    public async Task Scheduled_fire_swallows_a_whole_sweep_fault_and_never_crashes_the_scheduler()
    {
        var readRepo = new AlwaysThrowingListReadRepository();
        await using var factory = Factory(services =>
        {
            services.RemoveAll<IHrisConnectorReadRepository>();
            services.AddSingleton<IHrisConnectorReadRepository>(readRepo);
            services.RemoveAll<IHrisSyncRepository>();
            services.AddSingleton<IHrisSyncRepository>(new UnusedSyncRepository());
            services.RemoveAll<IHrisConnectorFactory>();
            services.AddSingleton<IHrisConnectorFactory>(new UnusedConnectorFactory());
            services.RemoveAll<IDataAccessAuditor>();
            services.AddSingleton<IDataAccessAuditor>(new NoOpAuditor());
        });

        using var scope = factory.Services.CreateScope();
        var job = scope.ServiceProvider.GetRequiredService<HrisSyncQuartzJob>();

        // The whole sweep faults on every attempt; the runner retries to the budget then gives up and
        // RETURNS — Execute must NOT throw (this is the bite: a rethrow-on-give-up runner turns this red).
        await job.Execute(new FakeJobExecutionContext(CancellationToken.None));

        Assert.Equal(3, readRepo.ListCallCount); // retried to JobMaxAttempts
    }

    [Fact]
    public async Task Quartz_trigger_runs_the_sweep_through_the_real_per_fire_factory_scope()
    {
        // Unlike the two facts above (which call Execute from a MANUAL scope), this drives Quartz's real
        // MicrosoftDependencyInjectionJobFactory: TriggerJob makes the scheduler create the per-fire DI scope,
        // resolve the job from it, and run the sweep. The SCOPED fake read-repo signals when it is reached.
        var signal = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var factory = Factory(services =>
        {
            services.AddSingleton(signal);
            services.RemoveAll<IHrisConnectorReadRepository>();
            services.AddScoped<IHrisConnectorReadRepository>(sp =>
                new SignalingReadRepository(sp.GetRequiredService<TaskCompletionSource>()));
            services.RemoveAll<IHrisSyncRepository>();
            services.AddScoped<IHrisSyncRepository, UnusedSyncRepository>();
            services.RemoveAll<IHrisConnectorFactory>();
            services.AddScoped<IHrisConnectorFactory, UnusedConnectorFactory>();
            services.RemoveAll<IDataAccessAuditor>();
            services.AddScoped<IDataAccessAuditor, NoOpAuditor>();
        });

        using var client = factory.CreateClient(); // boots host + starts the Quartz hosted service
        var health = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        var schedulerFactory = factory.Services.GetRequiredService<ISchedulerFactory>();
        var scheduler = await schedulerFactory.GetScheduler();

        // HrisSyncEnabled=false ⇒ no auto-fire; the durably-stored job is still triggerable on demand.
        await scheduler.TriggerJob(QuartzScheduleBuilder.HrisSyncJobKey);

        // BOUNDED await — assert the sweep actually ran (signal completed), never an unbounded hang.
        var completed = await Task.WhenAny(signal.Task, Task.Delay(TimeSpan.FromSeconds(10)));
        Assert.Same(signal.Task, completed);
    }

    /// <summary>Signals it was reached (proving the sweep ran through Quartz's per-fire scope), lists no connectors.</summary>
    private sealed class SignalingReadRepository(TaskCompletionSource signal) : IHrisConnectorReadRepository
    {
        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            signal.TrySetResult();
            IReadOnlyList<Guid> ids = [];
            return Task.FromResult(ids);
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("no connectors listed — never reached.");
    }

    /// <summary>Lists both connectors; throws for the failing one, returns null (→ skipped) for the healthy one.</summary>
    private sealed class ThrowingThenReachableReadRepository(Guid failing, Guid healthy) : IHrisConnectorReadRepository
    {
        public int ListCallCount { get; private set; }
        public bool FailingConnectorAttempted { get; private set; }
        public bool HealthyConnectorReached { get; private set; }

        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            ListCallCount++;
            IReadOnlyList<Guid> ids = [failing, healthy];
            return Task.FromResult(ids);
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken)
        {
            if (connectorId == failing)
            {
                FailingConnectorAttempted = true;
                throw new InvalidOperationException("simulated per-connector load failure");
            }

            HealthyConnectorReached = true;
            return Task.FromResult<HrisConnectorSyncConfig?>(null);
        }
    }

    /// <summary>The enumeration itself faults — a WHOLE-sweep failure that reaches the resilient runner.</summary>
    private sealed class AlwaysThrowingListReadRepository : IHrisConnectorReadRepository
    {
        public int ListCallCount { get; private set; }

        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            ListCallCount++;
            throw new InvalidOperationException("simulated whole-sweep enumeration failure");
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("never reached — the enumeration fails first.");
    }

    private sealed class UnusedConnectorFactory : IHrisConnectorFactory
    {
        public IHrisConnector Create(HrisProvider provider) =>
            throw new NotSupportedException("The isolation test never reaches connector creation.");
    }

    private sealed class NoOpAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    /// <summary>Every method throws — the fire drives only the config-load path, never persistence.</summary>
    private sealed class UnusedSyncRepository : IHrisSyncRepository
    {
        public Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
            Guid organizationId, Guid connectorId, string idempotencyKey, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task MarkRunningAsync(Guid organizationId, Guid runId, DateTime startedAt, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyDictionary<string, HrisExistingRecordState>> LoadExistingRecordStatesAsync(
            Guid organizationId, Guid connectorId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task PersistRecordsAsync(
            Guid organizationId, Guid connectorId, Guid syncRunId, HrisSyncPersistencePlan plan, DateTime syncedAt, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task FinalizeRunAsync(HrisSyncRunFinalization finalization, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task UpdateConnectorWatermarkAsync(
            Guid organizationId, Guid connectorId, Guid lastSyncRunId, DateTime lastSyncedAt, string? syncCursor, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// Minimal <see cref="IJobExecutionContext"/> — <see cref="HrisSyncQuartzJob.Execute"/> reads only
    /// <see cref="CancellationToken"/>; every other member is unused and throws/returns default.
    /// </summary>
    private sealed class FakeJobExecutionContext(CancellationToken cancellationToken) : IJobExecutionContext
    {
        public CancellationToken CancellationToken { get; } = cancellationToken;

        public IScheduler Scheduler => throw new NotSupportedException();
        public ITrigger Trigger => throw new NotSupportedException();
        public ICalendar? Calendar => null;
        public bool Recovering => false;
        public TriggerKey RecoveringTriggerKey => throw new NotSupportedException();
        public int RefireCount => 0;
        public JobDataMap MergedJobDataMap => new();
        public IJobDetail JobDetail => throw new NotSupportedException();
        public IJob JobInstance => throw new NotSupportedException();
        public DateTimeOffset FireTimeUtc => DateTimeOffset.UtcNow;
        public DateTimeOffset? ScheduledFireTimeUtc => null;
        public DateTimeOffset? PreviousFireTimeUtc => null;
        public DateTimeOffset? NextFireTimeUtc => null;
        public string FireInstanceId => string.Empty;
        public object? Result { get; set; }
        public TimeSpan JobRunTime => TimeSpan.Zero;

        public object? Get(object key) => null;
        public void Put(object key, object objectValue)
        {
        }
    }
}
