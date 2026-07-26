using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public sealed record AuditLogFilter(
    Guid? UserId,
    Guid? OrganizationId,
    string? Action,
    string? Entity,
    DateTime? DateFrom,
    DateTime? DateTo);

public interface IAuditReadRepository
{
    Task<(IReadOnlyList<AuditLogListItem> Logs, Guid? NextCursor, int Total)> ListAsync(
        AuditLogFilter filter, int take, Guid? cursor, CancellationToken cancellationToken);

    Task<IReadOnlyList<AuditLogExportRow>> ExportAsync(AuditLogFilter filter, CancellationToken cancellationToken);
}
