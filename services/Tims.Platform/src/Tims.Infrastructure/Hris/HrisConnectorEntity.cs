using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// EF-OWNED row for <c>hris_connectors</c> (docs/architecture/table-ownership.md <c>efcore</c>): one
/// configured HRIS integration per (organization, provider). Org-scoped → RLS-protected. The connector
/// stores only a <see cref="SecretRef"/> (a pointer into the secret store) — NEVER the secret itself.
/// </summary>
public sealed class HrisConnectorEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public HrisProvider Provider { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    public ConnectorStatus Status { get; set; }

    /// <summary>Opaque reference to the credential in the secret store — never the secret value.</summary>
    public string? SecretRef { get; set; }

    /// <summary>
    /// The provider tenant subdomain the connector calls (e.g. BambooHR's company subdomain). Nullable at
    /// the DB level, but REQUIRED for an active connector — the sync fails closed if it is missing rather
    /// than falling back to a shared/global tenant.
    /// </summary>
    public string? Subdomain { get; set; }

    /// <summary>Raw jsonb field-map override (default '{}'); refined without touching mapper logic.</summary>
    public string FieldMap { get; set; } = "{}";

    public string? SyncCursor { get; set; }

    public string? SyncCadence { get; set; }

    public Guid? LastSyncRunId { get; set; }

    public DateTime? LastSyncedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
