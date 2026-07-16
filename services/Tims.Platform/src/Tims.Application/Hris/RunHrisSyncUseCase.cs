using System.Text.Json;
using Tims.Application.Audit;
using Tims.Domain.Audit;
using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// Orchestrates ONE connector's idempotent HRIS sync (WP3.3): find/open the run by its idempotency key,
/// drive it pending → running, pull the source directory, apply the READ-ONLY, LAST-WRITE-FROM-SOURCE
/// conflict policy, persist under the org's tenant scope, reach a terminal state, advance the connector
/// watermark, and audit (fail-soft).
///
/// CONFLICT POLICY (source is the system of record):
/// <list type="bullet">
///   <item>unchanged (<c>source_hash</c> matches) → SKIP (idempotent no-op; counts as seen, not upserted);</item>
///   <item>changed / new → INSERT-or-UPDATE, source wins;</item>
///   <item>present in the store but ABSENT from the source snapshot → SOFT-mark <c>is_deleted_in_source</c>,
///     NEVER hard-delete.</item>
/// </list>
///
/// IDEMPOTENCY: a re-invocation with the same (org, connector, idempotency_key) whose run already exists
/// short-circuits — a completed run is authoritative and is never re-pulled or re-written.
///
/// FAILURE MODEL: a per-record map failure appends an <c>hris_sync_record_errors</c> row and drives the
/// run to <c>partial</c> (the rest still land); a whole-pull throw drives it to <c>failed</c>.
///
/// The use case is INFRASTRUCTURE-FREE: it drives ports only (<see cref="IHrisConnectorReadRepository"/>,
/// <see cref="IHrisSyncRepository"/>, <see cref="IHrisConnectorFactory"/>, <see cref="IDataAccessAuditor"/>),
/// so the TenantScope/RLS wrapping lives in the Infrastructure repositories and this class is unit-testable
/// with fakes.
/// </summary>
public sealed class RunHrisSyncUseCase(
    IHrisConnectorReadRepository connectorReadRepository,
    IHrisSyncRepository syncRepository,
    IHrisConnectorFactory connectorFactory,
    IDataAccessAuditor auditor,
    TimeProvider timeProvider,
    int maxSyncPages = 1000)
{
    /// <summary>The entity name (its C#-only <see cref="DataClassification"/> = Confidential → fail-soft audit).</summary>
    private const string AuditEntity = "external_employee";

    private readonly IHrisConnectorReadRepository _connectorReadRepository = connectorReadRepository;
    private readonly IHrisSyncRepository _syncRepository = syncRepository;
    private readonly IHrisConnectorFactory _connectorFactory = connectorFactory;
    private readonly IDataAccessAuditor _auditor = auditor;
    private readonly TimeProvider _timeProvider = timeProvider;
    private readonly int _maxSyncPages = maxSyncPages > 0
        ? maxSyncPages
        : throw new ArgumentOutOfRangeException(nameof(maxSyncPages), maxSyncPages, "The sync page cap must be positive.");

    public async Task<HrisSyncRunResult> RunAsync(
        Guid connectorId,
        string trigger,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(trigger);
        ArgumentException.ThrowIfNullOrWhiteSpace(idempotencyKey);

        // 1. Load the connector on the privileged owner read. Missing or inactive (Error) → no side effects.
        var config = await _connectorReadRepository.LoadSyncConfigAsync(connectorId, cancellationToken);
        if (config is null || !config.Status.IsSyncable())
        {
            return HrisSyncRunResult.Skipped();
        }

        // 2. Idempotency: an existing run for the key ends the invocation.
        var existing = await _syncRepository.FindRunByIdempotencyKeyAsync(
            config.OrganizationId, config.ConnectorId, idempotencyKey, cancellationToken);
        if (existing is not null)
        {
            // A TERMINAL run is authoritative — never re-pull or re-write (idempotency). A non-terminal
            // (pending/running) run means a prior invocation crashed mid-flight; resuming/timing-out that
            // run is Phase 4, so the scaffold likewise short-circuits rather than starting a competing run.
            return HrisSyncRunResult.ShortCircuit(existing);
        }

        // 3. Create the pending run, then guard pending → running. A unique-violation on
        // (org, connector, idempotency_key) means a CONCURRENT invocation won the insert first: re-find
        // that run and short-circuit (get-or-create semantics) rather than racing a competing run.
        var now = _timeProvider.GetUtcNow().UtcDateTime;
        HrisSyncRunSnapshot run;
        try
        {
            run = await _syncRepository.CreatePendingRunAsync(
                new NewHrisSyncRun(config.OrganizationId, config.ConnectorId, trigger, idempotencyKey, config.SyncCursor, now),
                cancellationToken);
        }
        catch (HrisSyncRunConflictException)
        {
            var raced = await _syncRepository.FindRunByIdempotencyKeyAsync(
                config.OrganizationId, config.ConnectorId, idempotencyKey, cancellationToken);
            return raced is not null ? HrisSyncRunResult.ShortCircuit(raced) : HrisSyncRunResult.Skipped();
        }

        SyncRunTransitions.EnsureCanTransition(SyncRunStatus.Pending, SyncRunStatus.Running);
        await _syncRepository.MarkRunningAsync(config.OrganizationId, run.Id, now, cancellationToken);

        try
        {
            // 4. Paginate the source directory (connector is already circuit-breaker-guarded).
            var (sourceEmployees, cursorAfter) = await FetchAllAsync(config, cancellationToken);

            // 5-6. Apply the conflict policy → a persistence plan (upserts / soft-deletes / record errors).
            var plan = await BuildPlanAsync(config, sourceEmployees, cancellationToken);

            // 7 (persist). One atomic tenant-scoped write of the whole pull.
            var persistedAt = _timeProvider.GetUtcNow().UtcDateTime;
            await _syncRepository.PersistRecordsAsync(
                config.OrganizationId, config.ConnectorId, run.Id, plan, persistedAt, cancellationToken);

            // 8. Terminal state: any record error ⇒ partial, else succeeded.
            var status = plan.RecordErrors.Count > 0 ? SyncRunStatus.Partial : SyncRunStatus.Succeeded;
            var recordsSeen = sourceEmployees.Count;
            var recordsUpserted = plan.Upserts.Count;
            var recordsFailed = plan.RecordErrors.Count;

            // TERMINAL finalize (running → succeeded|partial), CONDITIONAL on the run still being running.
            SyncRunTransitions.EnsureCanTransition(SyncRunStatus.Running, status);
            await _syncRepository.FinalizeRunAsync(
                new HrisSyncRunFinalization(
                    config.OrganizationId, run.Id, SyncRunStatus.Running, status, recordsSeen, recordsUpserted,
                    recordsFailed, cursorAfter, SummariseErrors(plan.RecordErrors), persistedAt),
                cancellationToken);

            // The run is NOW terminal. Everything below is POST-TERMINAL, best-effort follow-up: a failure
            // in the watermark advance or the audit MUST NEVER downgrade an already-terminal run to failed,
            // so each is isolated (its exception swallowed) and can never reach the failure-finalizer.
            var result = new HrisSyncRunResult(
                run.Id, status, recordsSeen, recordsUpserted, recordsFailed,
                ShortCircuited: false, ConnectorSkipped: false);

            await AdvanceWatermarkSafelyAsync(config, run.Id, persistedAt, cursorAfter, cancellationToken);
            await AuditAsync(config.OrganizationId, run.Id, cancellationToken);
            return result;
        }
        catch (Exception ex)
        {
            // Reached ONLY when NO terminal state was committed (a fetch / plan / persist / finalize
            // failure): the run is still running, so running → failed is the sole legal transition. A
            // POST-terminal failure (watermark / audit) can never land here — those are swallowed above —
            // so a succeeded/partial run can never be downgraded to failed.
            var finishedAt = _timeProvider.GetUtcNow().UtcDateTime;
            SyncRunTransitions.EnsureCanTransition(SyncRunStatus.Running, SyncRunStatus.Failed);
            await _syncRepository.FinalizeRunAsync(
                new HrisSyncRunFinalization(
                    config.OrganizationId, run.Id, SyncRunStatus.Running, SyncRunStatus.Failed, 0, 0, 0,
                    CursorAfter: null, ErrorSummary: ex.Message, finishedAt),
                cancellationToken);

            await AuditAsync(config.OrganizationId, run.Id, cancellationToken);

            return new HrisSyncRunResult(
                run.Id, SyncRunStatus.Failed, 0, 0, 0, ShortCircuited: false, ConnectorSkipped: false);
        }
    }

    /// <summary>
    /// Advances the connector watermark AFTER the run reached a terminal state. Its failure is swallowed
    /// (like the fail-soft audit): the cursor simply is not advanced and the next sweep re-pulls
    /// idempotently (skip-on-hash). It must NEVER re-finalize an already-terminal run to failed.
    /// </summary>
    private async Task AdvanceWatermarkSafelyAsync(
        HrisConnectorSyncConfig config,
        Guid runId,
        DateTime persistedAt,
        string? cursorAfter,
        CancellationToken cancellationToken)
    {
        try
        {
            await _syncRepository.UpdateConnectorWatermarkAsync(
                config.OrganizationId, config.ConnectorId, runId, persistedAt, cursorAfter, cancellationToken);
        }
        catch
        {
            // POST-TERMINAL best-effort: never downgrade a committed terminal run because the watermark
            // advance failed. The next sweep re-pulls idempotently.
        }
    }

    /// <summary>Pulls every page until the cursor is exhausted, returning the full snapshot + the last cursor seen.</summary>
    private async Task<(IReadOnlyList<HrisSourceEmployee> Employees, string? CursorAfter)> FetchAllAsync(
        HrisConnectorSyncConfig config,
        CancellationToken cancellationToken)
    {
        // Build the PER-CONNECTOR auth context (fails closed if the active connector is missing its
        // secret_ref / subdomain) BEFORE any transport, so a mis-provisioned connector never silently
        // falls back to a global tenant — the sync run ends failed with a clear error instead.
        var auth = BuildAuthContext(config);
        var connector = _connectorFactory.Create(config.Provider);

        var employees = new List<HrisSourceEmployee>();
        HrisFetchCursor? cursor = config.SyncCursor is { Length: > 0 } value ? new HrisFetchCursor(value) : null;
        string? cursorAfter = null;
        var pagesFetched = 0;

        while (true)
        {
            // Page-cap guard: a paging provider that never nulls its cursor would otherwise loop forever.
            if (pagesFetched >= _maxSyncPages)
            {
                throw new InvalidOperationException(
                    $"HRIS directory pull exceeded the maximum page cap ({_maxSyncPages}); aborting to avoid an unbounded loop.");
            }

            var page = await connector.FetchDirectoryAsync(auth, cursor, cancellationToken);
            pagesFetched++;
            employees.AddRange(page.Employees);

            if (page.Next is null)
            {
                // Exhausted. For a full-snapshot provider (BambooHR) there is no resumable cursor, so
                // cursorAfter stays null; a paging provider leaves it at the last non-null cursor consumed.
                break;
            }

            cursor = page.Next;
            cursorAfter = page.Next.Value;
        }

        return (employees, cursorAfter);
    }

    /// <summary>
    /// Builds the connector's <see cref="HrisConnectorAuthContext"/> from its loaded config, FAILING CLOSED
    /// when an active connector is missing its <c>secret_ref</c> or <c>subdomain</c>. A connector MUST
    /// authenticate against its OWN provider tenant — never a global fallback that would let two orgs pull
    /// (and cross-persist) the same source tenant's PII.
    /// </summary>
    private static HrisConnectorAuthContext BuildAuthContext(HrisConnectorSyncConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.SecretRef) || string.IsNullOrWhiteSpace(config.Subdomain))
        {
            throw new InvalidOperationException(
                $"Active HRIS connector '{config.ConnectorId}' is missing its secret_ref and/or subdomain; " +
                "refusing to sync (a connector must authenticate against its own provider tenant, never a global fallback).");
        }

        return new HrisConnectorAuthContext(config.SecretRef, config.Subdomain);
    }

    /// <summary>
    /// Applies the conflict policy over the source snapshot against the persisted (external_id → hash)
    /// map: skip unchanged, upsert changed/new (source wins), soft-delete the ones absent from the source,
    /// and record per-record failures. Pure aside from the one PII-free existing-hash read.
    /// </summary>
    private async Task<HrisSyncPersistencePlan> BuildPlanAsync(
        HrisConnectorSyncConfig config,
        IReadOnlyList<HrisSourceEmployee> sourceEmployees,
        CancellationToken cancellationToken)
    {
        var existingStates = await _syncRepository.LoadExistingRecordStatesAsync(
            config.OrganizationId, config.ConnectorId, cancellationToken);

        var fieldMap = ResolveFieldMap(config);
        var upserts = new List<HrisEmployeeUpsert>();
        var recordErrors = new List<HrisSyncRecordError>();
        var seenExternalIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var source in sourceEmployees)
        {
            // external_id IS the upsert key — a blank one is a record with no identity, a per-record failure.
            if (string.IsNullOrWhiteSpace(source.ExternalId))
            {
                recordErrors.Add(new HrisSyncRecordError(
                    ExternalId: null, ErrorType: "invalid_external_id", Message: "Source record has no external id."));
                continue;
            }

            // Seen (even if it later skips or fails) so it is NEVER soft-deleted as "absent from source".
            seenExternalIds.Add(source.ExternalId);

            try
            {
                var sourceHash = BambooHrEmployeeMapper.ComputeSourceHash(source);
                if (existingStates.TryGetValue(source.ExternalId, out var state)
                    && string.Equals(state.SourceHash, sourceHash, StringComparison.Ordinal)
                    && !state.IsDeletedInSource)
                {
                    // Unchanged AND still live — idempotent no-op. (A soft-deleted row that reappears is
                    // re-upserted below even when unchanged, so "source wins" also resurrects it.)
                    continue;
                }

                var mapped = BambooHrEmployeeMapper.Map(source, fieldMap);
                // DEFERRED (see phase-3-scaffold-followups.md #2): raw_payload stores the FULL directory
                // field-bag. Acceptable today — the pull is the bounded, low-sensitivity directory endpoint
                // and the row is RLS-protected + Confidential-classified. If the pull ever widens past the
                // directory (e.g. fields=all), allowlist/redact + re-classify raw_payload before serialize.
                var rawPayloadJson = JsonSerializer.Serialize(source);
                upserts.Add(new HrisEmployeeUpsert(mapped, rawPayloadJson, sourceHash));
            }
            catch (Exception ex)
            {
                recordErrors.Add(new HrisSyncRecordError(source.ExternalId, "map_error", ex.Message));
            }
        }

        // Full-snapshot semantics: anything persisted for this connector but absent from the pull is
        // soft-marked deleted-in-source (never removed). ACCEPTED CHURN (see followups #5): an
        // already-soft-deleted row is re-touched (re-stamped) each sweep it stays absent — minor, bounded.
        var softDeleted = existingStates.Keys
            .Where(externalId => !seenExternalIds.Contains(externalId))
            .ToList();

        return new HrisSyncPersistencePlan(upserts, softDeleted, recordErrors);
    }

    /// <summary>
    /// Builds the connector's <see cref="FieldMap"/>: a non-empty <c>hris_connectors.field_map</c> override
    /// (Sprint-1.8) wins, otherwise the wired <see cref="BambooHrFieldMap.Default"/>. A malformed override
    /// degrades to the default rather than failing the whole sync.
    /// </summary>
    private static FieldMap ResolveFieldMap(HrisConnectorSyncConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.FieldMapJson))
        {
            return BambooHrFieldMap.Default;
        }

        try
        {
            var overrideMap = JsonSerializer.Deserialize<Dictionary<string, string>>(config.FieldMapJson);
            return overrideMap is { Count: > 0 } ? new FieldMap(overrideMap) : BambooHrFieldMap.Default;
        }
        catch (JsonException)
        {
            return BambooHrFieldMap.Default;
        }
    }

    private static string? SummariseErrors(IReadOnlyList<HrisSyncRecordError> errors) =>
        errors.Count == 0 ? null : $"{errors.Count} record(s) failed to sync.";

    /// <summary>
    /// Appends the sensitive-write audit row attributed to the HRIS service principal. FAIL-SOFT: the
    /// entity is Confidential (not Restricted) so the writer already swallows a lost row, and the extra
    /// guard here means no auditor implementation can ever roll back a completed sync.
    /// </summary>
    private async Task AuditAsync(Guid organizationId, Guid syncRunId, CancellationToken cancellationToken)
    {
        try
        {
            await _auditor.LogAsync(
                new DataAccessEvent(
                    OrganizationId: organizationId.ToString(),
                    ActorId: HrisSystemActor.Id.ToString(),
                    Entity: AuditEntity,
                    RecordId: syncRunId.ToString(),
                    Action: AuditAction.Update),
                failClosed: false,
                cancellationToken);
        }
        catch
        {
            // fail-soft: a lost audit row must never roll back the completed sync.
        }
    }
}
