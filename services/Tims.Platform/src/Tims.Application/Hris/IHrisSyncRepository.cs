namespace Tims.Application.Hris;

/// <summary>
/// The TENANT-SCOPED persistence seam for a sync run. EVERY method runs UNDER
/// <c>TenantScope.BeginAsync(hrisDb, organizationId)</c> in the Infrastructure implementation (SET LOCAL
/// ROLE app_tenant + org GUC) so the RLS <c>WITH CHECK</c> passes for the connector's org — the sync has
/// no ambient JWT, so the org is threaded explicitly on every call. Reads here are also org-scoped and
/// use EXPLICIT, PII-MINIMAL projections (never <c>SELECT *</c>).
/// </summary>
public interface IHrisSyncRepository
{
    /// <summary>
    /// The existing run for the unique key (organization_id, connector_id, idempotency_key), or
    /// <c>null</c>. A TERMINAL result short-circuits the whole invocation (idempotency).
    /// </summary>
    Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
        Guid organizationId,
        Guid connectorId,
        string idempotencyKey,
        CancellationToken cancellationToken);

    /// <summary>Inserts a fresh <c>pending</c> run and returns its snapshot.</summary>
    Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken);

    /// <summary>Advances a run to <c>running</c> and stamps <c>started_at</c> (the domain guard is applied by the caller).</summary>
    Task MarkRunningAsync(Guid organizationId, Guid runId, DateTime startedAt, CancellationToken cancellationToken);

    /// <summary>
    /// The existing (external_id → <see cref="HrisExistingRecordState"/>) map for this connector — the
    /// MINIMAL, PII-FREE projection the conflict policy needs to skip unchanged rows, resurrect
    /// reappeared soft-deleted rows, and detect ones absent from the source.
    /// </summary>
    Task<IReadOnlyDictionary<string, HrisExistingRecordState>> LoadExistingRecordStatesAsync(
        Guid organizationId,
        Guid connectorId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Persists the whole pull atomically under one org scope: idempotent upsert of
    /// <see cref="HrisSyncPersistencePlan.Upserts"/> on the unique key (source wins), SOFT-delete of
    /// <see cref="HrisSyncPersistencePlan.SoftDeletedExternalIds"/> (never hard-delete), and append of
    /// <see cref="HrisSyncPersistencePlan.RecordErrors"/>. Each upserted row is stamped with
    /// <paramref name="syncRunId"/> and <paramref name="syncedAt"/>.
    /// </summary>
    Task PersistRecordsAsync(
        Guid organizationId,
        Guid connectorId,
        Guid syncRunId,
        HrisSyncPersistencePlan plan,
        DateTime syncedAt,
        CancellationToken cancellationToken);

    /// <summary>Writes the terminal outcome + counts + advanced cursor + finish time (guard applied by the caller).</summary>
    Task FinalizeRunAsync(HrisSyncRunFinalization finalization, CancellationToken cancellationToken);

    /// <summary>Advances the connector watermark (<c>last_sync_run_id</c> / <c>last_synced_at</c> / <c>sync_cursor</c>).</summary>
    Task UpdateConnectorWatermarkAsync(
        Guid organizationId,
        Guid connectorId,
        Guid lastSyncRunId,
        DateTime lastSyncedAt,
        string? syncCursor,
        CancellationToken cancellationToken);
}
