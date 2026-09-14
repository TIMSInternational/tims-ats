using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public sealed class TenantAuditReadUseCase(ITenantAuditRepository repository)
{
    public Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(
        Guid organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
        CancellationToken cancellationToken) =>
        repository.GetAccessReportAsync(organizationId, dateFrom, dateTo, cancellationToken);
}
