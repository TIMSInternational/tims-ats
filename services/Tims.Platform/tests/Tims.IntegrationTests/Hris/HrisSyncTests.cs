using Microsoft.EntityFrameworkCore;
using Tims.Application.Hris;
using Tims.Domain.Hris;
using Tims.Infrastructure;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.Hris;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.6 — the FINAL scaffold proof: drives the WHOLE pull → map → upsert → audit chain
/// (<see cref="RunHrisSyncUseCase"/>) end-to-end against a REAL Postgres container under tenant RLS,
/// never mocking the isolation. A FAKE <see cref="IHrisConnector"/> feeds deterministic fixture payloads
/// (no live BambooHR); everything below it — the tenant-scoped <see cref="HrisSyncRepository"/>, the
/// privileged <see cref="HrisConnectorReadRepository"/>, and the real <see cref="DataAccessAuditWriter"/>
/// landing a row in <c>data_access_logs</c> — is the shipping code.
///
/// Proves the five invariants the design pins:
/// <list type="bullet">
///   <item>(a) idempotent re-run writes nothing new (same key short-circuits; a new key with an
///     unchanged snapshot skips on <c>source_hash</c>);</item>
///   <item>(b) an org-A sync NEVER touches org-B rows (RLS: org-B's row is untouched and org-A's rows
///     are invisible under org-B's scope);</item>
///   <item>(c) exactly one <c>hris_sync_runs</c> row + one <c>data_access_logs</c> row land under org-A,
///     the audit attributed to <see cref="HrisSystemActor"/> with dataType <c>external_employee</c>;</item>
///   <item>(d) a forced per-record failure ⇒ run <c>partial</c> + one <c>hris_sync_record_errors</c> row,
///     the good record still upserts;</item>
///   <item>(e) a record absent from a new snapshot ⇒ <c>is_deleted_in_source = true</c>, never
///     hard-deleted.</item>
/// </list>
/// </summary>
[Collection("HrisSync")]
public sealed class HrisSyncTests(HrisSyncFixture fixture)
{
    private readonly HrisSyncFixture _fixture = fixture;

    // A deterministic single-page directory: same input ⇒ same source_hash (drives the skip path).
    private static HrisSourceEmployee Emp(string externalId, string firstName, string lastName) =>
        new(externalId, new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["firstName"] = firstName,
            ["lastName"] = lastName,
            ["workEmail"] = $"{externalId}@example.com",
        });

    /// <summary>
    /// Wires the REAL use case (real repositories + real audit writer + a fake connector feeding
    /// <paramref name="employees"/>) with fresh contexts each call, and runs one sync. Fresh contexts
    /// avoid EF change-tracking bleed between successive runs in the same test.
    /// </summary>
    private async Task<HrisSyncRunResult> RunSyncAsync(
        Guid connectorId,
        string idempotencyKey,
        IReadOnlyList<HrisSourceEmployee> employees)
    {
        await using var hrisDb = _fixture.NewHrisContext();
        await using var auditDb = _fixture.NewAuditContext();

        var useCase = new RunHrisSyncUseCase(
            new HrisConnectorReadRepository(hrisDb),
            new HrisSyncRepository(hrisDb),
            new SingleConnectorFactory(new FakeDirectoryConnector(employees)),
            new DataAccessAuditWriter(auditDb),
            TimeProvider.System);

        return await useCase.RunAsync(connectorId, "manual", idempotencyKey, CancellationToken.None);
    }

    // ---- (a) Idempotent re-run writes nothing new -------------------------------------------------
    [Fact]
    public async Task A_IdempotentReRun_SameKeyShortCircuits_NewKeyUnchanged_SkipsOnHash()
    {
        await _fixture.ResetAsync();
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorA, HrisSyncFixture.OrgA, "Org A BambooHR");
        var snapshot = new[] { Emp("e1", "Ada", "Lovelace"), Emp("e2", "Grace", "Hopper") };

        // First real run: two rows land.
        var first = await RunSyncAsync(HrisSyncFixture.ConnectorA, "key-1", snapshot);
        Assert.Equal(SyncRunStatus.Succeeded, first.Status);
        Assert.Equal(2, first.RecordsUpserted);
        Assert.Equal(2, (await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorA)).Count);

        // Same idempotency key ⇒ short-circuit: no new run, no new/changed rows, no extra audit row.
        var second = await RunSyncAsync(HrisSyncFixture.ConnectorA, "key-1", snapshot);
        Assert.True(second.ShortCircuited);
        Assert.Equal(first.RunId, second.RunId);
        Assert.Single(await _fixture.ReadSyncRunsAsync(HrisSyncFixture.OrgA));
        Assert.Single(await _fixture.ReadAuditRowsAsync(HrisSyncFixture.OrgA));

        // DIFFERENT key, unchanged source ⇒ a new run is created, but every row is skipped on its
        // source_hash: records_seen=2, records_upserted=0, and no new employee rows.
        var third = await RunSyncAsync(HrisSyncFixture.ConnectorA, "key-2", snapshot);
        Assert.Equal(SyncRunStatus.Succeeded, third.Status);
        Assert.Equal(2, third.RecordsSeen);
        Assert.Equal(0, third.RecordsUpserted);

        var runs = await _fixture.ReadSyncRunsAsync(HrisSyncFixture.OrgA);
        Assert.Equal(2, runs.Count); // key-1 + key-2 (the short-circuit made none)
        var employees = await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorA);
        Assert.Equal(2, employees.Count);
        Assert.All(employees, e => Assert.False(e.IsDeletedInSource));
    }

    // ---- (b) Tenant isolation: an org-A sync never touches org-B rows -----------------------------
    [Fact]
    public async Task B_OrgASync_NeverTouchesOrgBRows_RlsIsolation()
    {
        await _fixture.ResetAsync();
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorA, HrisSyncFixture.OrgA, "Org A BambooHR");
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorB, HrisSyncFixture.OrgB, "Org B BambooHR");
        // A pre-existing org-B employee that the FULL-SNAPSHOT org-A sync must never see or soft-delete.
        await _fixture.SeedEmployeeAsync(
            HrisSyncFixture.OrgB, HrisSyncFixture.ConnectorB, "b-1", "Ben", "Bravo", "hash-b");

        var result = await RunSyncAsync(
            HrisSyncFixture.ConnectorA, "key-a", new[] { Emp("a1", "Ada", "Alpha"), Emp("a2", "Ann", "Apex") });
        Assert.Equal(SyncRunStatus.Succeeded, result.Status);

        // Org-B's row is untouched: still present, still live (org-A's absent-from-source soft-delete
        // could NOT reach it because RLS hid it from org-A's existing-state read).
        var orgBRow = Assert.Single(await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorB));
        Assert.Equal("b-1", orgBRow.ExternalId);
        Assert.False(orgBRow.IsDeletedInSource);
        Assert.Equal("Ben", orgBRow.FirstName);
        Assert.Null(orgBRow.LastSyncRunId); // never stamped by the org-A run

        // RLS reads, not WHERE filters: org-A's new rows are INVISIBLE under org-B's scope, and org-B's
        // scope sees only its own row.
        await using var db = _fixture.NewHrisContext();
        await using (var scopeB = await TenantScope.BeginAsync(db, HrisSyncFixture.OrgB))
        {
            var visibleToB = await db.ExternalEmployees.AsNoTracking().ToListAsync();
            await scopeB.CommitAsync();
            Assert.Equal("b-1", Assert.Single(visibleToB).ExternalId);
        }

        await using (var scopeA = await TenantScope.BeginAsync(db, HrisSyncFixture.OrgA))
        {
            var visibleToA = await db.ExternalEmployees.AsNoTracking().OrderBy(e => e.ExternalId).ToListAsync();
            await scopeA.CommitAsync();
            Assert.Equal(new[] { "a1", "a2" }, visibleToA.Select(e => e.ExternalId).ToArray());
            Assert.All(visibleToA, e => Assert.Equal(HrisSyncFixture.OrgA, e.OrganizationId));
        }

        // And org-B saw zero sync-run / audit activity from the org-A sync.
        Assert.Empty(await _fixture.ReadSyncRunsAsync(HrisSyncFixture.OrgB));
        Assert.Empty(await _fixture.ReadAuditRowsAsync(HrisSyncFixture.OrgB));
    }

    // ---- (c) Exactly one run row + one audit row land under org-A ---------------------------------
    [Fact]
    public async Task C_Run_AndAuditRow_LandUnderOrgA_WithSystemActor_AndExternalEmployeeType()
    {
        await _fixture.ResetAsync();
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorA, HrisSyncFixture.OrgA, "Org A BambooHR");

        var result = await RunSyncAsync(
            HrisSyncFixture.ConnectorA, "key-c", new[] { Emp("e1", "Ada", "Lovelace"), Emp("e2", "Grace", "Hopper") });

        // Exactly one hris_sync_runs row: terminal status + correct counts, under org-A.
        var run = Assert.Single(await _fixture.ReadSyncRunsAsync(HrisSyncFixture.OrgA));
        Assert.Equal(result.RunId, run.Id);
        Assert.Equal(HrisSyncFixture.OrgA, run.OrganizationId);
        Assert.Equal("succeeded", run.Status);
        Assert.Equal(2, run.RecordsSeen);
        Assert.Equal(2, run.RecordsUpserted);
        Assert.Equal(0, run.RecordsFailed);

        // Exactly one data_access_logs row: under org-A, actor = the HRIS service principal, dataType
        // external_employee, action update, record = the run id. Real RLS WITH CHECK passed for org-A.
        var audit = Assert.Single(await _fixture.ReadAuditRowsAsync(HrisSyncFixture.OrgA));
        Assert.Equal(HrisSyncFixture.OrgA, audit.OrganizationId);
        Assert.Equal(HrisSystemActor.Id, audit.ActorId);
        Assert.Equal("external_employee", audit.DataType);
        Assert.Equal("update", audit.Action);
        Assert.Equal(result.RunId, audit.RecordId);
    }

    // ---- (d) Partial failure: forced per-record failure ⇒ partial + one error row -----------------
    [Fact]
    public async Task D_PerRecordFailure_MakesRunPartial_WithErrorRow_OthersStillUpsert()
    {
        await _fixture.ResetAsync();
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorA, HrisSyncFixture.OrgA, "Org A BambooHR");

        // FORCED DETERMINISTICALLY: a record whose external_id is blank has no upsert identity, so the
        // conflict policy records an "invalid_external_id" per-record error while the valid record lands.
        var good = Emp("e1", "Ada", "Lovelace");
        var bad = Emp("   ", "Nobody", "Nowhere");
        var result = await RunSyncAsync(HrisSyncFixture.ConnectorA, "key-d", new[] { good, bad });

        Assert.Equal(SyncRunStatus.Partial, result.Status);
        Assert.Equal(2, result.RecordsSeen);
        Assert.Equal(1, result.RecordsUpserted);
        Assert.Equal(1, result.RecordsFailed);

        var run = Assert.Single(await _fixture.ReadSyncRunsAsync(HrisSyncFixture.OrgA));
        Assert.Equal("partial", run.Status);

        var error = Assert.Single(await _fixture.ReadRecordErrorsAsync(HrisSyncFixture.OrgA));
        Assert.Equal("invalid_external_id", error.ErrorType);
        Assert.Equal(HrisSyncFixture.OrgA, error.OrganizationId);

        // The good record still upserted.
        var employee = Assert.Single(await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorA));
        Assert.Equal("e1", employee.ExternalId);
    }

    // ---- (e) Soft delete: a record absent from a new snapshot is soft-marked, not removed ----------
    [Fact]
    public async Task E_RecordAbsentFromNewSnapshot_IsSoftDeleted_NeverHardDeleted()
    {
        await _fixture.ResetAsync();
        await _fixture.SeedConnectorAsync(HrisSyncFixture.ConnectorA, HrisSyncFixture.OrgA, "Org A BambooHR");

        // Run 1: two employees land.
        await RunSyncAsync(
            HrisSyncFixture.ConnectorA, "key-e1", new[] { Emp("e1", "Ada", "Lovelace"), Emp("e2", "Grace", "Hopper") });
        Assert.Equal(2, (await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorA)).Count);

        // Run 2 (new key): e2 is ABSENT from the snapshot ⇒ soft-mark it, keep the row.
        var second = await RunSyncAsync(
            HrisSyncFixture.ConnectorA, "key-e2", new[] { Emp("e1", "Ada", "Lovelace") });
        Assert.Equal(SyncRunStatus.Succeeded, second.Status);
        Assert.Equal(1, second.RecordsSeen);
        Assert.Equal(0, second.RecordsUpserted); // e1 unchanged ⇒ skipped on hash

        var employees = await _fixture.ReadEmployeesAsync(HrisSyncFixture.ConnectorA);
        Assert.Equal(2, employees.Count); // NOT hard-deleted — both rows survive
        var e1 = Assert.Single(employees, e => e.ExternalId == "e1");
        var e2 = Assert.Single(employees, e => e.ExternalId == "e2");
        Assert.False(e1.IsDeletedInSource);
        Assert.True(e2.IsDeletedInSource); // absent from source ⇒ soft-deleted
        Assert.Equal(second.RunId, e2.LastSyncRunId); // stamped by the run that soft-deleted it
    }

    // ---- Fakes: a deterministic single-page connector + a one-provider factory --------------------

    /// <summary>Yields one page of a fixed employee list (BambooHR full-snapshot semantics: no next cursor).</summary>
    private sealed class FakeDirectoryConnector(IReadOnlyList<HrisSourceEmployee> employees) : IHrisConnector
    {
        public Task<HrisDirectoryPage> FetchDirectoryAsync(
            HrisConnectorAuthContext auth, HrisFetchCursor? cursor, CancellationToken cancellationToken) =>
            Task.FromResult(new HrisDirectoryPage(employees, Next: null));

        public Task<HrisSourceEmployee> FetchEmployeeAsync(
            HrisConnectorAuthContext auth, string externalId, CancellationToken cancellationToken) =>
            throw new NotSupportedException("Not used by the sync use case.");
    }

    private sealed class SingleConnectorFactory(IHrisConnector connector) : IHrisConnectorFactory
    {
        public IHrisConnector Create(HrisProvider provider) => connector;
    }
}
