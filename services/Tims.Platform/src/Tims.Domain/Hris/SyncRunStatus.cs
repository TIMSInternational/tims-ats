namespace Tims.Domain.Hris;

/// <summary>
/// State of a single HRIS sync run. The lifecycle is <c>Pending</c> → <c>Running</c> →
/// one terminal outcome (<c>Succeeded</c> | <c>Failed</c> | <c>Partial</c>). <c>Partial</c> means the
/// run finished but some records failed to map/upsert (recorded in <c>hris_sync_record_errors</c>).
/// Guarded transitions live in <see cref="SyncRunTransitions"/>. Stored as a wire string in
/// <c>hris_sync_runs.status</c>.
/// </summary>
public enum SyncRunStatus
{
    Pending,
    Running,
    Succeeded,
    Failed,
    Partial,
}

public static class SyncRunStatuses
{
    public static string ToWire(this SyncRunStatus status) => status switch
    {
        SyncRunStatus.Pending => "pending",
        SyncRunStatus.Running => "running",
        SyncRunStatus.Succeeded => "succeeded",
        SyncRunStatus.Failed => "failed",
        SyncRunStatus.Partial => "partial",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown SyncRunStatus"),
    };

    public static bool TryParse(string? value, out SyncRunStatus status)
    {
        switch (value)
        {
            case "pending":
                status = SyncRunStatus.Pending;
                return true;
            case "running":
                status = SyncRunStatus.Running;
                return true;
            case "succeeded":
                status = SyncRunStatus.Succeeded;
                return true;
            case "failed":
                status = SyncRunStatus.Failed;
                return true;
            case "partial":
                status = SyncRunStatus.Partial;
                return true;
            default:
                status = default;
                return false;
        }
    }

    /// <summary>Strict parse for an EF-OWNED column value (unknown string → corruption → throw).</summary>
    public static SyncRunStatus FromWire(string value) =>
        TryParse(value, out var status)
            ? status
            : throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown SyncRunStatus wire value");
}
