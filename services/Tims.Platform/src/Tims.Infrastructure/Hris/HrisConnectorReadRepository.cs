using Microsoft.EntityFrameworkCore;
using Tims.Application.Hris;
using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// The PRIVILEGED (owner) read over <c>hris_connectors</c> — deliberately NOT under
/// <see cref="TenantScope"/>: a background sync has no JWT, so it enumerates connectors across every org
/// on the owner connection (which bypasses RLS). Discipline is enforced by the PROJECTION instead: every
/// query selects connector-config columns ONLY (id / org / provider / secret_ref / subdomain / field_map /
/// sync_cursor / status) and NEVER touches <c>hris_external_employees</c>, so no external-employee PII is
/// ever read here. Tenant-scoped employee data lives behind <see cref="HrisSyncRepository"/>.
/// </summary>
public sealed class HrisConnectorReadRepository(HrisDbContext db) : IHrisConnectorReadRepository
{
    public async Task<IReadOnlyList<Guid>> ListActiveConnectorIdsAsync(CancellationToken cancellationToken)
    {
        // Status != Error mirrors ConnectorStatuses.IsSyncable (an extension isn't SQL-translatable);
        // minimal projection = the id only.
        return await db.Connectors
            .Where(c => c.Status != ConnectorStatus.Error)
            .Select(c => c.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<HrisConnectorSyncConfig?> LoadSyncConfigAsync(Guid connectorId, CancellationToken cancellationToken)
    {
        // WORKER-INTERNAL owner read (see phase-3-scaffold-followups.md #3): by connector id, NO org
        // filter, on the RLS-bypassing owner connection — correct for the JWT-less background sweep, safe
        // because the projection is config-columns-only (no employee PII). Any future API/manual-trigger
        // path MUST use an org-filtered variant under TenantScope, never this privileged read.
        return await db.Connectors
            .Where(c => c.Id == connectorId)
            .Select(c => new HrisConnectorSyncConfig(
                c.Id,
                c.OrganizationId,
                c.Provider,
                c.SecretRef,
                c.Subdomain,
                c.FieldMap,
                c.SyncCursor,
                c.Status))
            .SingleOrDefaultAsync(cancellationToken);
    }
}
