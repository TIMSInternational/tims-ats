namespace Tims.Application.Hris;

/// <summary>
/// The PRIVILEGED (owner) read seam over <c>hris_connectors</c>. A background sync has no JWT/tenant
/// context, so it enumerates active connectors and loads one connector's sync config on the OWNER
/// connection (bypassing RLS) — but on a MINIMAL, PII-FREE projection: connector ids and the
/// <see cref="HrisConnectorSyncConfig"/> only, NEVER any external-employee personal data (that stays
/// behind the tenant-scoped <see cref="IHrisSyncRepository"/>). The worker then processes each connector
/// UNDER its org's <c>TenantScope</c>.
/// </summary>
public interface IHrisConnectorReadRepository
{
    /// <summary>
    /// Enumerates the ids of every connector eligible for a background sync (status
    /// <see cref="Tims.Domain.Hris.ConnectorStatuses.IsSyncable"/>), across all orgs, on the owner read.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Loads one connector's minimal sync config, or <c>null</c> when the id is unknown. Callers still
    /// gate on <see cref="HrisConnectorSyncConfig.Status"/> — an <c>Error</c> connector is inactive.
    /// </summary>
    Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken);
}
