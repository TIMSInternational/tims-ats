using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// EF-OWNED row for <c>hris_sync_runs</c> (docs/architecture/table-ownership.md <c>efcore</c>): one
/// execution of a connector's sync, keyed idempotently on (organization_id, connector_id,
/// idempotency_key) so a re-invocation with the same key resolves to the same run. Org-scoped →
/// RLS-protected. <see cref="Status"/> is driven through <see cref="SyncRunTransitions"/>.
/// </summary>
public sealed class HrisSyncRunEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid ConnectorId { get; set; }

    public SyncRunStatus Status { get; set; }

    /// <summary>What triggered the run (e.g. 'manual', 'scheduled') — bound by the Phase-4 scheduler.</summary>
    public string Trigger { get; set; } = string.Empty;

    public string IdempotencyKey { get; set; } = string.Empty;

    public string? CursorBefore { get; set; }

    public string? CursorAfter { get; set; }

    public int RecordsSeen { get; set; }

    public int RecordsUpserted { get; set; }

    public int RecordsFailed { get; set; }

    public string? ErrorSummary { get; set; }

    public DateTime? StartedAt { get; set; }

    public DateTime? FinishedAt { get; set; }

    public DateTime CreatedAt { get; set; }
}
