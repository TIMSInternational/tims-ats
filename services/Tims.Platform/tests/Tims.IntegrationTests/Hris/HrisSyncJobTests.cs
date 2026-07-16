using System.Diagnostics.Metrics;
using Microsoft.Extensions.DependencyInjection;
using Tims.Application.Audit;
using Tims.Application.Hris;
using Tims.Domain.Audit;
using Tims.Domain.Hris;
using Tims.Workers.Hris;
using Tims.Workers.Jobs;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// The background sweep <see cref="HrisSyncJob"/>, now scope-per-connector. Drives it through a real DI
/// container wiring the fakes as the SCOPED ports (+ the concrete scoped <see cref="RunHrisSyncUseCase"/>),
/// exactly as the host does, and asserts:
/// <list type="bullet">
///   <item>Codex High#1 (FIX 1): each connector is served from a DISTINCT DI scope ⇒ its own HrisDbContext /
///     change tracker, so a failed connector can never bleed tracked entities into another's SaveChanges.</item>
///   <item>Codex Low#2: one connector's failure is ISOLATED — the sweep still reaches the rest.</item>
///   <item>Codex Medium#1 (FIX 4): an isolated connector failure increments the per-connector failure counter.</item>
///   <item>Codex Medium#2 (FIX 3): two DISTINCT scheduled fire times within the same hour ⇒ DISTINCT
///     idempotency keys, so a sub-hourly cadence is not silently capped at hourly.</item>
/// </list>
/// Fake-based, no DB.
/// </summary>
public sealed class HrisSyncJobTests
{
    private static readonly Guid Org = Guid.Parse("00000000-0000-0000-0000-0000000000a0");

    [Fact]
    public async Task Each_connector_runs_in_a_distinct_scope_and_a_failure_is_isolated_and_counted()
    {
        // Fresh, unique connector ids per test so the process-wide connector-failure metric can be captured
        // deterministically by connector id even if other worker tests run concurrently.
        var failingConnector = Guid.NewGuid();
        var healthyConnector = Guid.NewGuid();
        var observations = new SweepObservations();

        await using var provider = BuildProvider(services =>
        {
            services.AddSingleton(observations);
            services.AddScoped<IHrisConnectorReadRepository>(sp => new ScopeTrackingReadRepository(
                sp.GetRequiredService<SweepObservations>(), failingConnector, healthyConnector));
            services.AddScoped<IHrisSyncRepository, UnusedSyncRepository>();
        });

        using var failures = new ConnectorFailureCapture(failingConnector);
        var job = provider.GetRequiredService<HrisSyncJob>();

        await job.RunAsync(DateTimeOffset.UtcNow, CancellationToken.None);

        // Isolation invariant (Codex Low#2): the first connector's throw did not abort the sweep.
        Assert.True(observations.FailingConnectorAttempted);
        Assert.True(observations.HealthyConnectorReached);

        // FIX 1 bite: each connector's LoadSyncConfig was served by a DISTINCT scoped read-repo instance ⇒
        // each connector ran in its own DI scope (own HrisDbContext / tracker). Reverting HrisSyncJob to a
        // single shared scope makes both loads hit the SAME instance ⇒ distinct-count 1 ⇒ this goes red.
        Assert.Equal(2, observations.LoadReadRepoInstanceIds.Count);
        Assert.Equal(2, observations.LoadReadRepoInstanceIds.Distinct().Count());

        // FIX 4 bite: the isolated connector failure incremented tims.jobs.connector_failures once.
        Assert.Equal(1, failures.Count);
    }

    [Fact]
    public async Task Distinct_scheduled_fire_times_within_the_same_hour_produce_distinct_idempotency_keys()
    {
        var connector = Guid.NewGuid();
        var syncRepo = new KeyRecordingSyncRepository();

        await using var provider = BuildProvider(services =>
        {
            services.AddSingleton(syncRepo);
            services.AddScoped<IHrisConnectorReadRepository>(_ => new SingleSyncableReadRepository(connector));
            services.AddScoped<IHrisSyncRepository>(sp => sp.GetRequiredService<KeyRecordingSyncRepository>());
        });

        var job = provider.GetRequiredService<HrisSyncJob>();

        // Two DISTINCT scheduled occurrences 15 minutes apart, SAME hour.
        var first = new DateTimeOffset(2026, 07, 16, 10, 00, 00, TimeSpan.Zero);
        var second = new DateTimeOffset(2026, 07, 16, 10, 15, 00, TimeSpan.Zero);

        await job.RunAsync(first, CancellationToken.None);
        await job.RunAsync(second, CancellationToken.None);

        // FIX 3 bite: the sub-hourly bucket (yyyyMMddHHmmss) keeps the two fires' keys distinct so BOTH do
        // work. An hourly bucket (yyyyMMddHH) would collapse them to ONE key ⇒ distinct-count 1 ⇒ red.
        Assert.Equal(2, syncRepo.SeenIdempotencyKeys.Count);
        Assert.Equal(2, syncRepo.SeenIdempotencyKeys.Distinct(StringComparer.Ordinal).Count());
    }

    /// <summary>
    /// Wires the fakes as the host does: <see cref="RunHrisSyncUseCase"/> + all HRIS ports SCOPED, so
    /// resolving the use case from a child scope is what isolates each connector's DbContext/tracker. The
    /// caller supplies the read + sync repositories (the two that differ per test).
    /// </summary>
    private static ServiceProvider BuildProvider(Action<IServiceCollection> configurePorts)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<IHrisConnectorFactory, UnusedConnectorFactory>();
        services.AddScoped<IDataAccessAuditor, NoOpAuditor>();
        configurePorts(services);
        services.AddScoped(sp => new RunHrisSyncUseCase(
            sp.GetRequiredService<IHrisConnectorReadRepository>(),
            sp.GetRequiredService<IHrisSyncRepository>(),
            sp.GetRequiredService<IHrisConnectorFactory>(),
            sp.GetRequiredService<IDataAccessAuditor>(),
            sp.GetRequiredService<TimeProvider>()));
        services.AddScoped<HrisSyncJob>();
        return services.BuildServiceProvider();
    }

    /// <summary>Shared observation sink (singleton) the scoped read-repo instances write into.</summary>
    private sealed class SweepObservations
    {
        public List<Guid> LoadReadRepoInstanceIds { get; } = [];
        public bool FailingConnectorAttempted { get; set; }
        public bool HealthyConnectorReached { get; set; }
    }

    /// <summary>
    /// Lists both connectors; each SCOPED instance stamps its own id on every LoadSyncConfig it serves, so
    /// the test can prove a distinct scope (⇒ distinct DbContext) per connector. Throws for the failing one.
    /// </summary>
    private sealed class ScopeTrackingReadRepository(SweepObservations observations, Guid failing, Guid healthy)
        : IHrisConnectorReadRepository
    {
        private readonly Guid _instanceId = Guid.NewGuid();

        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            IReadOnlyList<Guid> ids = [failing, healthy];
            return Task.FromResult(ids);
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken)
        {
            observations.LoadReadRepoInstanceIds.Add(_instanceId);
            if (connectorId == failing)
            {
                observations.FailingConnectorAttempted = true;
                throw new InvalidOperationException("simulated per-connector load failure");
            }

            observations.HealthyConnectorReached = true;
            // Null config ⇒ the use case returns Skipped without touching the sync repo/connector.
            return Task.FromResult<HrisConnectorSyncConfig?>(null);
        }
    }

    /// <summary>Lists one connector and loads a syncable config for it (drives the use case to the idempotency find).</summary>
    private sealed class SingleSyncableReadRepository(Guid connectorId) : IHrisConnectorReadRepository
    {
        public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
        {
            IReadOnlyList<Guid> ids = [connectorId];
            return Task.FromResult(ids);
        }

        public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid id, CancellationToken cancellationToken) =>
            Task.FromResult<HrisConnectorSyncConfig?>(new HrisConnectorSyncConfig(
                id, Org, HrisProvider.BambooHr, "secret-ref", "org-a-sub", "{}", SyncCursor: null, ConnectorStatus.Connected));
    }

    /// <summary>
    /// Records the idempotency key the use case looks up, then answers with an existing TERMINAL run so the
    /// use case short-circuits (never reaching create/persist/connector). All the write methods are unused.
    /// </summary>
    private sealed class KeyRecordingSyncRepository : IHrisSyncRepository
    {
        public List<string> SeenIdempotencyKeys { get; } = [];

        public Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
            Guid organizationId, Guid connectorId, string idempotencyKey, CancellationToken cancellationToken)
        {
            SeenIdempotencyKeys.Add(idempotencyKey);
            return Task.FromResult<HrisSyncRunSnapshot?>(new HrisSyncRunSnapshot(
                Guid.NewGuid(), organizationId, connectorId, idempotencyKey, SyncRunStatus.Succeeded));
        }

        public Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken) =>
            throw new NotSupportedException("short-circuited on the existing terminal run.");

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

    private sealed class UnusedConnectorFactory : IHrisConnectorFactory
    {
        public IHrisConnector Create(HrisProvider provider) =>
            throw new NotSupportedException("These tests never reach connector creation.");
    }

    private sealed class NoOpAuditor : IDataAccessAuditor
    {
        public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    /// <summary>Every method throws — the isolation test drives only the config-load path, never persistence.</summary>
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
    /// Captures the process-wide <c>tims.jobs.connector_failures</c> counter for a SPECIFIC connector id
    /// (unique per test), so the assertion is deterministic despite the static, cross-test instrument.
    /// </summary>
    private sealed class ConnectorFailureCapture : IDisposable
    {
        private readonly MeterListener _listener = new();
        private readonly Guid _connectorId;
        private readonly Lock _gate = new();
        private long _count;

        public ConnectorFailureCapture(Guid connectorId)
        {
            _connectorId = connectorId;
            _listener.InstrumentPublished = (instrument, listener) =>
            {
                if (instrument.Meter.Name == JobMetrics.MeterName
                    && instrument.Name == JobMetrics.ConnectorFailuresCounterName)
                {
                    listener.EnableMeasurementEvents(instrument);
                }
            };
            _listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
            {
                foreach (var tag in tags)
                {
                    if (tag is { Key: "connector.id", Value: Guid id } && id == _connectorId)
                    {
                        lock (_gate)
                        {
                            _count += measurement;
                        }
                    }
                }
            });
            _listener.Start();
        }

        public long Count
        {
            get
            {
                lock (_gate)
                {
                    return _count;
                }
            }
        }

        public void Dispose() => _listener.Dispose();
    }
}
