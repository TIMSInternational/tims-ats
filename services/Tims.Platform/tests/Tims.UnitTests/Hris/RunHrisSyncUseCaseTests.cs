using Tims.Application.Hris;
using Tims.Domain.Audit;
using Tims.Domain.Hris;

namespace Tims.UnitTests.Hris;

/// <summary>
/// WP3.3 — the idempotent sync use case orchestration, proved over a fake connector + in-memory ports:
/// idempotency short-circuit, the read-only/last-write-from-source conflict policy (skip / source-wins /
/// soft-delete / resurrect), per-record partial failure, whole-pull failure, and the fail-soft
/// service-principal audit. The DB-backed RLS/upsert/audit-landing proof is Slice 4.
/// </summary>
public sealed class RunHrisSyncUseCaseTests
{
    private static readonly Guid OrgA = Guid.Parse("00000000-0000-0000-0000-0000000000a0");
    private static readonly Guid ConnectorA = Guid.Parse("00000000-0000-0000-0000-0000000000c0");

    private static HrisConnectorSyncConfig Config(
        ConnectorStatus status = ConnectorStatus.Connected,
        string fieldMap = "{}",
        string? cursor = null,
        string? secretRef = "secret-ref",
        string? subdomain = "org-a-sub") =>
        new(ConnectorA, OrgA, HrisProvider.BambooHr, secretRef, subdomain, fieldMap, cursor, status);

    private static HrisSourceEmployee Emp(string externalId, params (string Key, string? Value)[] fields) =>
        new(externalId, fields.ToDictionary(f => f.Key, f => f.Value, StringComparer.Ordinal));

    private static string HashOf(HrisSourceEmployee source) => BambooHrEmployeeMapper.ComputeSourceHash(source);

    private static (RunHrisSyncUseCase UseCase, FakeHrisSyncRepository Sync, FakeHrisConnector Connector, RecordingAuditor Auditor) Build(
        HrisConnectorSyncConfig? config,
        FakeHrisConnector connector)
    {
        var readRepo = new FakeHrisConnectorReadRepository();
        if (config is not null)
        {
            readRepo.Add(config);
        }

        var sync = new FakeHrisSyncRepository();
        var auditor = new RecordingAuditor();
        var useCase = new RunHrisSyncUseCase(
            readRepo, sync, new FakeHrisConnectorFactory(connector), auditor, TimeProvider.System);
        return (useCase, sync, connector, auditor);
    }

    // ---- Per-connector auth isolation (Codex High#1) -------------------------------------------

    [Fact]
    public async Task Per_connector_auth_context_is_threaded_from_the_config_to_the_connector()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        // A connector configured with ITS OWN secret_ref + subdomain — never a global fallback.
        var config = Config(secretRef: "org-a/bamboo-key", subdomain: "org-a-company");
        var (useCase, _, conn, _) = Build(config, connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Succeeded, result.Status);
        Assert.NotNull(conn.LastAuth);
        Assert.Equal("org-a/bamboo-key", conn.LastAuth!.SecretRef);
        Assert.Equal("org-a-company", conn.LastAuth.Subdomain);
    }

    [Fact]
    public async Task Active_connector_missing_secret_ref_fails_closed_no_global_fallback()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, conn, _) = Build(Config(secretRef: null), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        // Fails CLOSED: the run is opened then finalized failed (never silently pulls a global tenant).
        Assert.Equal(SyncRunStatus.Failed, result.Status);
        Assert.Equal(0, conn.FetchDirectoryCallCount);
        Assert.Empty(sync.PersistedPlans);
        Assert.Empty(sync.Watermarks);
        var finalization = Assert.Single(sync.Finalizations);
        Assert.Equal(SyncRunStatus.Failed, finalization.Status);
        Assert.NotNull(finalization.ErrorSummary);
    }

    [Fact]
    public async Task Active_connector_missing_subdomain_fails_closed_no_global_fallback()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, conn, _) = Build(Config(subdomain: "  "), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Failed, result.Status);
        Assert.Equal(0, conn.FetchDirectoryCallCount);
        Assert.Empty(sync.PersistedPlans);
        Assert.Equal(SyncRunStatus.Failed, Assert.Single(sync.Finalizations).Status);
    }

    // ---- Terminal status cannot be downgraded (Codex High#2) -----------------------------------

    [Fact]
    public async Task Succeeded_run_is_not_downgraded_when_the_post_terminal_watermark_update_throws()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, _, _) = Build(Config(), connector);
        sync.ThrowOnWatermark = true; // a POST-terminal failure must never rewrite the run to failed.

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        // The run STAYS succeeded — exactly ONE finalization (succeeded), and NO failed finalization.
        Assert.Equal(SyncRunStatus.Succeeded, result.Status);
        var finalization = Assert.Single(sync.Finalizations);
        Assert.Equal(SyncRunStatus.Succeeded, finalization.Status);
        Assert.DoesNotContain(sync.Finalizations, f => f.Status == SyncRunStatus.Failed);
    }

    // ---- Idempotency run race (Codex Med#1-run) ------------------------------------------------

    [Fact]
    public async Task Create_run_unique_violation_is_treated_as_an_idempotent_short_circuit()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, conn, _) = Build(Config(), connector);
        sync.SimulateCreateRace = true; // a concurrent invocation wins the unique insert first.

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        // Get-or-create: re-find the winning run and short-circuit rather than racing a competing run.
        Assert.True(result.ShortCircuited);
        Assert.Equal(0, sync.CreatedRunCount); // our own create never completed
        Assert.Equal(0, conn.FetchDirectoryCallCount);
        Assert.Empty(sync.PersistedPlans);
    }

    // ---- Page-cap guard (opus L2) --------------------------------------------------------------

    [Fact]
    public async Task Fetch_aborts_when_the_page_cap_is_exceeded()
    {
        var connector = new FakeNeverEndingPagingConnector();
        var readRepo = new FakeHrisConnectorReadRepository();
        readRepo.Add(Config());
        var sync = new FakeHrisSyncRepository();
        var useCase = new RunHrisSyncUseCase(
            readRepo, sync, new FakeHrisConnectorFactory(connector), new RecordingAuditor(),
            TimeProvider.System, maxSyncPages: 3);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        // The cap stops the unbounded pull: exactly 3 fetches, then the run finalizes failed.
        Assert.Equal(SyncRunStatus.Failed, result.Status);
        Assert.Equal(3, connector.FetchDirectoryCallCount);
        Assert.Empty(sync.PersistedPlans);
        var finalization = Assert.Single(sync.Finalizations);
        Assert.Equal(SyncRunStatus.Failed, finalization.Status);
        Assert.Contains("page cap", finalization.ErrorSummary, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Idempotency ---------------------------------------------------------------------------

    [Fact]
    public async Task Second_invocation_with_same_key_short_circuits_and_writes_nothing_new()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, _, _) = Build(Config(), connector);

        var first = await useCase.RunAsync(ConnectorA, "manual", "key-1", CancellationToken.None);
        var second = await useCase.RunAsync(ConnectorA, "manual", "key-1", CancellationToken.None);

        Assert.False(first.ShortCircuited);
        Assert.Equal(SyncRunStatus.Succeeded, first.Status);

        Assert.True(second.ShortCircuited);
        Assert.Equal(SyncRunStatus.Succeeded, second.Status);
        Assert.Equal(first.RunId, second.RunId);

        // Exactly one run, one pull, one persist — the second invocation re-drives nothing.
        Assert.Equal(1, sync.CreatedRunCount);
        Assert.Equal(1, connector.FetchDirectoryCallCount);
        Assert.Single(sync.PersistedPlans);
    }

    // ---- Conflict policy -----------------------------------------------------------------------

    [Fact]
    public async Task Unchanged_source_hash_is_skipped_seen_not_upserted()
    {
        var e1 = Emp("e1", ("firstName", "Ada"), ("lastName", "Lovelace"));
        var connector = new FakeHrisConnector([e1]);
        var (useCase, sync, _, _) = Build(Config(), connector);
        sync.SeedExistingStates(ConnectorA, new Dictionary<string, HrisExistingRecordState>(StringComparer.Ordinal)
        {
            ["e1"] = new HrisExistingRecordState(HashOf(e1), IsDeletedInSource: false),
        });

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Succeeded, result.Status);
        Assert.Equal(1, result.RecordsSeen);
        Assert.Equal(0, result.RecordsUpserted);
        var plan = Assert.Single(sync.PersistedPlans);
        Assert.Empty(plan.Upserts);
        Assert.Empty(plan.SoftDeletedExternalIds);
    }

    [Fact]
    public async Task Changed_source_is_upserted_source_wins()
    {
        var e1 = Emp("e1", ("firstName", "Ada"), ("lastName", "Byron"));
        var connector = new FakeHrisConnector([e1]);
        var (useCase, sync, _, _) = Build(Config(), connector);
        sync.SeedExistingStates(ConnectorA, new Dictionary<string, HrisExistingRecordState>(StringComparer.Ordinal)
        {
            ["e1"] = new HrisExistingRecordState("stale-hash", IsDeletedInSource: false),
        });

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Succeeded, result.Status);
        Assert.Equal(1, result.RecordsUpserted);
        var plan = Assert.Single(sync.PersistedPlans);
        var upsert = Assert.Single(plan.Upserts);
        Assert.Equal("e1", upsert.Employee.ExternalId);
        Assert.Equal("Byron", upsert.Employee.LastName);
        Assert.Equal(HashOf(e1), upsert.SourceHash);
    }

    [Fact]
    public async Task New_source_record_is_inserted()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Grace"))]);
        var (useCase, sync, _, _) = Build(Config(), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Succeeded, result.Status);
        Assert.Equal(1, result.RecordsUpserted);
        var plan = Assert.Single(sync.PersistedPlans);
        Assert.Equal("e1", Assert.Single(plan.Upserts).Employee.ExternalId);
    }

    [Fact]
    public async Task Record_absent_from_source_is_soft_deleted_never_removed()
    {
        var e1 = Emp("e1", ("firstName", "Ada"));
        var connector = new FakeHrisConnector([e1]);
        var (useCase, sync, _, _) = Build(Config(), connector);
        sync.SeedExistingStates(ConnectorA, new Dictionary<string, HrisExistingRecordState>(StringComparer.Ordinal)
        {
            ["e1"] = new HrisExistingRecordState(HashOf(e1), IsDeletedInSource: false),
            ["e2"] = new HrisExistingRecordState("whatever", IsDeletedInSource: false),
        });

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        var plan = Assert.Single(sync.PersistedPlans);
        Assert.Equal(new[] { "e2" }, plan.SoftDeletedExternalIds);
        Assert.DoesNotContain("e1", plan.SoftDeletedExternalIds);
        // The present, unchanged e1 is neither upserted nor deleted.
        Assert.Empty(plan.Upserts);
        Assert.Equal(1, result.RecordsSeen);
    }

    [Fact]
    public async Task Reappeared_soft_deleted_record_is_re_upserted_even_when_unchanged()
    {
        var e1 = Emp("e1", ("firstName", "Ada"));
        var connector = new FakeHrisConnector([e1]);
        var (useCase, sync, _, _) = Build(Config(), connector);
        sync.SeedExistingStates(ConnectorA, new Dictionary<string, HrisExistingRecordState>(StringComparer.Ordinal)
        {
            // Same hash, but currently soft-deleted → "source wins" must resurrect it.
            ["e1"] = new HrisExistingRecordState(HashOf(e1), IsDeletedInSource: true),
        });

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(1, result.RecordsUpserted);
        var plan = Assert.Single(sync.PersistedPlans);
        Assert.Equal("e1", Assert.Single(plan.Upserts).Employee.ExternalId);
        Assert.Empty(plan.SoftDeletedExternalIds);
    }

    // ---- Partial + whole-pull failure ----------------------------------------------------------

    [Fact]
    public async Task Per_record_failure_makes_the_run_partial_with_an_error_row()
    {
        // A record with a blank external id has no identity → a per-record failure.
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada")), Emp("  ", ("firstName", "Nobody"))]);
        var (useCase, sync, _, _) = Build(Config(), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Partial, result.Status);
        Assert.Equal(2, result.RecordsSeen);
        Assert.Equal(1, result.RecordsUpserted);
        Assert.Equal(1, result.RecordsFailed);

        var plan = Assert.Single(sync.PersistedPlans);
        var error = Assert.Single(plan.RecordErrors);
        Assert.Equal("invalid_external_id", error.ErrorType);

        var finalization = Assert.Single(sync.Finalizations);
        Assert.Equal(SyncRunStatus.Partial, finalization.Status);
        Assert.Equal(1, finalization.RecordsFailed);
    }

    [Fact]
    public async Task Whole_pull_throw_makes_the_run_failed_and_persists_nothing()
    {
        var connector = new FakeHrisConnector([], throwOnFetch: new InvalidOperationException("bamboo down"));
        var (useCase, sync, _, _) = Build(Config(), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.Equal(SyncRunStatus.Failed, result.Status);
        Assert.Equal(1, sync.CreatedRunCount);   // the run was opened...
        Assert.Equal(1, sync.MarkRunningCount);  // ...and driven to running before the pull threw.
        Assert.Empty(sync.PersistedPlans);       // nothing persisted.
        Assert.Empty(sync.Watermarks);           // watermark not advanced on failure.

        var finalization = Assert.Single(sync.Finalizations);
        Assert.Equal(SyncRunStatus.Failed, finalization.Status);
        Assert.NotNull(finalization.ErrorSummary);
    }

    // ---- Connector gating ----------------------------------------------------------------------

    [Fact]
    public async Task Missing_connector_returns_without_side_effects()
    {
        var connector = new FakeHrisConnector([Emp("e1")]);
        var (useCase, sync, conn, _) = Build(config: null, connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.True(result.ConnectorSkipped);
        Assert.Equal(0, sync.CreatedRunCount);
        Assert.Equal(0, conn.FetchDirectoryCallCount);
    }

    [Fact]
    public async Task Error_status_connector_is_inactive_and_skipped()
    {
        var connector = new FakeHrisConnector([Emp("e1")]);
        var (useCase, sync, conn, _) = Build(Config(status: ConnectorStatus.Error), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        Assert.True(result.ConnectorSkipped);
        Assert.Equal(0, sync.CreatedRunCount);
        Assert.Equal(0, conn.FetchDirectoryCallCount);
    }

    // ---- Terminal transition + audit -----------------------------------------------------------

    [Fact]
    public async Task Successful_run_advances_watermark_and_audits_fail_soft_as_the_service_principal()
    {
        var connector = new FakeHrisConnector([Emp("e1", ("firstName", "Ada"))]);
        var (useCase, sync, _, auditor) = Build(Config(), connector);

        var result = await useCase.RunAsync(ConnectorA, "manual", "k", CancellationToken.None);

        // pending → running → succeeded, all via the guarded transitions (no throw).
        Assert.Equal(1, sync.MarkRunningCount);
        Assert.Equal(SyncRunStatus.Succeeded, Assert.Single(sync.Finalizations).Status);

        var watermark = Assert.Single(sync.Watermarks);
        Assert.Equal(ConnectorA, watermark.ConnectorId);
        Assert.Equal(result.RunId, watermark.LastSyncRunId);

        var (auditEvent, failClosed) = Assert.Single(auditor.Events);
        Assert.Equal("external_employee", auditEvent.Entity);
        Assert.Equal(HrisSystemActor.Id.ToString(), auditEvent.ActorId);
        Assert.Equal(OrgA.ToString(), auditEvent.OrganizationId);
        Assert.Equal(result.RunId.ToString(), auditEvent.RecordId);
        Assert.Equal(AuditAction.Update, auditEvent.Action);
        Assert.False(failClosed);   // fail-soft: a lost audit row must not roll back the sync.
    }
}
