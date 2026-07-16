using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// The MINIMAL, PII-FREE sync configuration of one connector, loaded on a privileged owner read
/// (<see cref="IHrisConnectorReadRepository"/>) so a background sync can run without a JWT. It carries
/// only what the sync needs to authenticate + map + resume — id, org, provider, the opaque
/// <see cref="SecretRef"/> (a pointer, never the secret), the provider <see cref="Subdomain"/> (which
/// tenant the connector calls), the raw <see cref="FieldMapJson"/> override, the paging
/// <see cref="SyncCursor"/>, and the <see cref="Status"/> — and NEVER any external-employee personal data
/// (that lives behind the tenant-scoped <see cref="IHrisSyncRepository"/>).
///
/// <see cref="SecretRef"/> and <see cref="Subdomain"/> are nullable at the DB level but BOTH REQUIRED for
/// an active connector: the sync fails closed if either is missing rather than falling back to a global
/// tenant (multi-tenant isolation).
/// </summary>
public sealed record HrisConnectorSyncConfig(
    Guid ConnectorId,
    Guid OrganizationId,
    HrisProvider Provider,
    string? SecretRef,
    string? Subdomain,
    string FieldMapJson,
    string? SyncCursor,
    ConnectorStatus Status);
