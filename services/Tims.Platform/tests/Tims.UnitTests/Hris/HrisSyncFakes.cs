using Tims.Application.Audit;
using Tims.Application.Hris;
using Tims.Domain.Audit;
using Tims.Domain.Hris;

namespace Tims.UnitTests.Hris;

/// <summary>
/// In-memory fakes for the WP3.3 orchestration tests: they exercise <see cref="RunHrisSyncUseCase"/>
/// against the Application ports + a fake <see cref="IHrisConnector"/>, with NO database. The real
/// TenantScope/RLS + upsert + audit-row landing is proved DB-backed in Slice 4.
/// </summary>
internal sealed class FakeHrisConnectorReadRepository : IHrisConnectorReadRepository
{
    private readonly Dictionary<Guid, HrisConnectorSyncConfig> _configs = new();

    public void Add(HrisConnectorSyncConfig config) => _configs[config.ConnectorId] = config;

    public Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<Guid> ids = _configs.Values
            .Where(c => c.Status.IsSyncable())
            .Select(c => c.ConnectorId)
            .ToList();
        return Task.FromResult(ids);
    }

    public Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken) =>
        Task.FromResult(_configs.TryGetValue(connectorId, out var config) ? config : null);
}

/// <summary>The fake connector: yields one page of a fixed employee list, or throws to simulate a whole-pull failure.</summary>
internal sealed class FakeHrisConnector : IHrisConnector
{
    private readonly IReadOnlyList<HrisSourceEmployee> _employees;
    private readonly Exception? _throw;

    public FakeHrisConnector(IReadOnlyList<HrisSourceEmployee> employees, Exception? throwOnFetch = null)
    {
        _employees = employees;
        _throw = throwOnFetch;
    }

    public int FetchDirectoryCallCount { get; private set; }

    /// <summary>The per-connector auth context the use case threaded in on the last call (isolation proof).</summary>
    public HrisConnectorAuthContext? LastAuth { get; private set; }

    public Task<HrisDirectoryPage> FetchDirectoryAsync(
        HrisConnectorAuthContext auth, HrisFetchCursor? cursor, CancellationToken cancellationToken)
    {
        FetchDirectoryCallCount++;
        LastAuth = auth;
        if (_throw is not null)
        {
            throw _throw;
        }

        // Single page (BambooHR semantics): exhausted immediately.
        return Task.FromResult(new HrisDirectoryPage(_employees, Next: null));
    }

    public Task<HrisSourceEmployee> FetchEmployeeAsync(
        HrisConnectorAuthContext auth, string externalId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not used by the sync use case.");
}

/// <summary>A connector that NEVER exhausts — every page returns a fresh non-null cursor, so the use case's
/// page cap is the only thing that can stop the pull.</summary>
internal sealed class FakeNeverEndingPagingConnector : IHrisConnector
{
    public int FetchDirectoryCallCount { get; private set; }

    public Task<HrisDirectoryPage> FetchDirectoryAsync(
        HrisConnectorAuthContext auth, HrisFetchCursor? cursor, CancellationToken cancellationToken)
    {
        FetchDirectoryCallCount++;
        return Task.FromResult(new HrisDirectoryPage([], new HrisFetchCursor($"page-{FetchDirectoryCallCount}")));
    }

    public Task<HrisSourceEmployee> FetchEmployeeAsync(
        HrisConnectorAuthContext auth, string externalId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not used by the sync use case.");
}

internal sealed class FakeHrisConnectorFactory(IHrisConnector connector) : IHrisConnectorFactory
{
    public IHrisConnector Create(HrisProvider provider) => connector;
}

/// <summary>Records every write and answers idempotency finds from an authoritative in-memory run store.</summary>
internal sealed class FakeHrisSyncRepository : IHrisSyncRepository
{
    private sealed class RunRecord
    {
        public required Guid Id { get; init; }
        public required Guid OrganizationId { get; init; }
        public required Guid ConnectorId { get; init; }
        public required string IdempotencyKey { get; init; }
        public SyncRunStatus Status { get; set; }
    }

    private readonly Dictionary<Guid, RunRecord> _runs = new();
    private readonly Dictionary<Guid, IReadOnlyDictionary<string, HrisExistingRecordState>> _existing = new();

    public int CreatedRunCount { get; private set; }
    public int MarkRunningCount { get; private set; }
    public List<HrisSyncPersistencePlan> PersistedPlans { get; } = new();
    public List<HrisSyncRunFinalization> Finalizations { get; } = new();
    public List<(Guid ConnectorId, Guid LastSyncRunId, string? SyncCursor)> Watermarks { get; } = new();

    /// <summary>When set, the NEXT CreatePendingRun simulates a lost unique-insert race: a competing run is
    /// recorded (so a re-find succeeds) and a <see cref="HrisSyncRunConflictException"/> is thrown.</summary>
    public bool SimulateCreateRace { get; set; }

    /// <summary>When set, <see cref="UpdateConnectorWatermarkAsync"/> throws — to prove a POST-terminal
    /// watermark failure never downgrades an already-succeeded run.</summary>
    public bool ThrowOnWatermark { get; set; }

    /// <summary>Seed the persisted (external_id → state) map a connector's next sync reads.</summary>
    public void SeedExistingStates(Guid connectorId, IReadOnlyDictionary<string, HrisExistingRecordState> states) =>
        _existing[connectorId] = states;

    public Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
        Guid organizationId,
        Guid connectorId,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        var match = _runs.Values.SingleOrDefault(r =>
            r.OrganizationId == organizationId && r.ConnectorId == connectorId && r.IdempotencyKey == idempotencyKey);
        return Task.FromResult<HrisSyncRunSnapshot?>(
            match is null ? null : new HrisSyncRunSnapshot(match.Id, match.OrganizationId, match.ConnectorId, match.IdempotencyKey, match.Status));
    }

    public Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken)
    {
        if (SimulateCreateRace)
        {
            // A concurrent writer won the unique insert first: record ITS run (so a re-find resolves it),
            // then surface the neutral conflict the real repository raises on a 23505.
            SimulateCreateRace = false;
            var competitor = new RunRecord
            {
                Id = Guid.NewGuid(),
                OrganizationId = run.OrganizationId,
                ConnectorId = run.ConnectorId,
                IdempotencyKey = run.IdempotencyKey,
                Status = SyncRunStatus.Running,
            };
            _runs[competitor.Id] = competitor;
            throw new HrisSyncRunConflictException("simulated unique-violation race", new InvalidOperationException());
        }

        CreatedRunCount++;
        var record = new RunRecord
        {
            Id = Guid.NewGuid(),
            OrganizationId = run.OrganizationId,
            ConnectorId = run.ConnectorId,
            IdempotencyKey = run.IdempotencyKey,
            Status = SyncRunStatus.Pending,
        };
        _runs[record.Id] = record;
        return Task.FromResult(new HrisSyncRunSnapshot(
            record.Id, record.OrganizationId, record.ConnectorId, record.IdempotencyKey, record.Status));
    }

    public Task MarkRunningAsync(Guid organizationId, Guid runId, DateTime startedAt, CancellationToken cancellationToken)
    {
        MarkRunningCount++;
        _runs[runId].Status = SyncRunStatus.Running;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyDictionary<string, HrisExistingRecordState>> LoadExistingRecordStatesAsync(
        Guid organizationId,
        Guid connectorId,
        CancellationToken cancellationToken)
    {
        var states = _existing.TryGetValue(connectorId, out var seeded)
            ? seeded
            : new Dictionary<string, HrisExistingRecordState>(StringComparer.Ordinal);
        return Task.FromResult(states);
    }

    public Task PersistRecordsAsync(
        Guid organizationId,
        Guid connectorId,
        Guid syncRunId,
        HrisSyncPersistencePlan plan,
        DateTime syncedAt,
        CancellationToken cancellationToken)
    {
        PersistedPlans.Add(plan);
        return Task.CompletedTask;
    }

    public Task FinalizeRunAsync(HrisSyncRunFinalization finalization, CancellationToken cancellationToken)
    {
        var run = _runs[finalization.RunId];

        // Mirror the repo's CONDITIONAL update (WHERE status = expected): a finalize whose expected
        // current status no longer matches is a no-op — it can never rewrite a run that already moved on.
        if (run.Status != finalization.ExpectedCurrentStatus)
        {
            return Task.CompletedTask;
        }

        Finalizations.Add(finalization);
        run.Status = finalization.Status;
        return Task.CompletedTask;
    }

    public Task UpdateConnectorWatermarkAsync(
        Guid organizationId,
        Guid connectorId,
        Guid lastSyncRunId,
        DateTime lastSyncedAt,
        string? syncCursor,
        CancellationToken cancellationToken)
    {
        if (ThrowOnWatermark)
        {
            throw new InvalidOperationException("simulated post-terminal watermark-write failure");
        }

        Watermarks.Add((connectorId, lastSyncRunId, syncCursor));
        return Task.CompletedTask;
    }
}

/// <summary>Records the audit events the use case emits (and the fail-soft flag) for assertion.</summary>
internal sealed class RecordingAuditor : IDataAccessAuditor
{
    public List<(DataAccessEvent Event, bool? FailClosed)> Events { get; } = new();

    public Task LogAsync(DataAccessEvent auditEvent, bool? failClosed = null, CancellationToken cancellationToken = default)
    {
        Events.Add((auditEvent, failClosed));
        return Task.CompletedTask;
    }
}
