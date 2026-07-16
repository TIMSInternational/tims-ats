namespace Tims.Infrastructure.Hris;

/// <summary>
/// EF-OWNED row for <c>hris_sync_record_errors</c> (docs/architecture/table-ownership.md <c>efcore</c>):
/// one per-record failure captured during a sync run (which drives its parent run to <c>Partial</c>).
/// Org-scoped → RLS-protected. <see cref="Details"/> is a jsonb diagnostic blob.
/// </summary>
public sealed class HrisSyncRecordErrorEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid SyncRunId { get; set; }

    public Guid ConnectorId { get; set; }

    public string? ExternalId { get; set; }

    public string ErrorType { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    /// <summary>Optional jsonb diagnostic payload (raw JSON text).</summary>
    public string? Details { get; set; }

    public DateTime CreatedAt { get; set; }
}
