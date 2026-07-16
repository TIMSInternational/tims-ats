using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// A minimal read model of an <c>hris_sync_runs</c> row — enough for the idempotency short-circuit
/// (its <see cref="Status"/>) and to identify the run. No counts/cursors: those are write-only inputs.
/// </summary>
public sealed record HrisSyncRunSnapshot(
    Guid Id,
    Guid OrganizationId,
    Guid ConnectorId,
    string IdempotencyKey,
    SyncRunStatus Status);

/// <summary>The inputs to create a fresh <c>pending</c> sync run (idempotent on org+connector+key).</summary>
public sealed record NewHrisSyncRun(
    Guid OrganizationId,
    Guid ConnectorId,
    string Trigger,
    string IdempotencyKey,
    string? CursorBefore,
    DateTime CreatedAt);

/// <summary>
/// The PII-FREE persisted state of one external employee the conflict policy reasons over: its
/// <see cref="SourceHash"/> (skip-unchanged) and whether it is currently
/// <see cref="IsDeletedInSource"/> — a soft-deleted row that REAPPEARS in the source must be re-upserted
/// (to clear the flag) even when its hash is unchanged, so "source wins" also resurrects.
/// </summary>
public sealed record HrisExistingRecordState(string SourceHash, bool IsDeletedInSource);

/// <summary>One record to insert-or-update into <c>hris_external_employees</c> on the unique key.</summary>
public sealed record HrisEmployeeUpsert(
    ExternalEmployee Employee,
    string RawPayloadJson,
    string SourceHash);

/// <summary>One per-record failure to append to <c>hris_sync_record_errors</c>.</summary>
public sealed record HrisSyncRecordError(
    string? ExternalId,
    string ErrorType,
    string Message);

/// <summary>
/// The computed result of a pull, ready to persist atomically under the org's <c>TenantScope</c>:
/// the records to upsert (source wins), the external ids absent from the source to SOFT-delete (never
/// hard-delete), and the per-record errors. Skipped-unchanged records appear in NONE of these lists.
/// </summary>
public sealed record HrisSyncPersistencePlan(
    IReadOnlyList<HrisEmployeeUpsert> Upserts,
    IReadOnlyList<string> SoftDeletedExternalIds,
    IReadOnlyList<HrisSyncRecordError> RecordErrors);

/// <summary>
/// The terminal finalization of a run: outcome + counts + advanced cursor + finish time.
/// <see cref="ExpectedCurrentStatus"/> is the status the row MUST currently hold for the write to apply —
/// the repository makes the status update CONDITIONAL on it (a no-op if the row already moved on), so a
/// stale/late finalizer can never rewrite a run that already reached a terminal state (state integrity).
/// </summary>
public sealed record HrisSyncRunFinalization(
    Guid OrganizationId,
    Guid RunId,
    SyncRunStatus ExpectedCurrentStatus,
    SyncRunStatus Status,
    int RecordsSeen,
    int RecordsUpserted,
    int RecordsFailed,
    string? CursorAfter,
    string? ErrorSummary,
    DateTime FinishedAt);

/// <summary>
/// The outcome of <see cref="RunHrisSyncUseCase.RunAsync"/>. <see cref="ConnectorSkipped"/> is set when
/// the connector was missing/inactive (no run created); <see cref="ShortCircuited"/> is set when an
/// existing run for the idempotency key resolved the invocation without re-pulling.
/// </summary>
public sealed record HrisSyncRunResult(
    Guid RunId,
    SyncRunStatus Status,
    int RecordsSeen,
    int RecordsUpserted,
    int RecordsFailed,
    bool ShortCircuited,
    bool ConnectorSkipped)
{
    public static HrisSyncRunResult Skipped() =>
        new(Guid.Empty, SyncRunStatus.Pending, 0, 0, 0, ShortCircuited: false, ConnectorSkipped: true);

    public static HrisSyncRunResult ShortCircuit(HrisSyncRunSnapshot run) =>
        new(run.Id, run.Status, 0, 0, 0, ShortCircuited: true, ConnectorSkipped: false);
}
