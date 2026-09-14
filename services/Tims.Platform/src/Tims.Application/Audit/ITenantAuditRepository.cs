using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public interface ITenantAuditRepository
{
    Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(
        Guid organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
        CancellationToken cancellationToken);
}
