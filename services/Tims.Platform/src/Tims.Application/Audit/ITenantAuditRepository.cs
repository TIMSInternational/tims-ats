using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public interface ITenantAuditRepository
{
    Task<IReadOnlyList<TenantAuditItem<TenantAuditListActor>>> ListAsync(Guid organizationId,
        TenantAuditFilter filter, int take, Guid? cursor, CancellationToken cancellationToken);

    Task<IReadOnlyList<TenantAuditExportRow>> ExportAsync(Guid organizationId, TenantAuditFilter filter,
        CancellationToken cancellationToken);

    Task<TenantAuditDetail?> GetDetailAsync(Guid organizationId, Guid id, CancellationToken cancellationToken);

    Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(
        Guid organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
        CancellationToken cancellationToken);
}
