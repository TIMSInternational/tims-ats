using Tims.Domain.Audit;

namespace Tims.Application.Audit;

public sealed partial class TenantAuditReadUseCase(ITenantAuditRepository repository)
{
    public async Task<TenantAuditPage<TenantAuditListActor>> ListAsync(Guid organizationId,
        TenantAuditFilter filter, int take, Guid? cursor, CancellationToken cancellationToken)
    {
        var rows = await repository.ListAsync(organizationId, filter, take, cursor, cancellationToken);
        return new(rows.Take(take).ToList(), rows.Count > take ? rows[take - 1].Id : null);
    }

    public async Task<TenantAuditPage<TenantAuditHistoryActor>> HistoryAsync(Guid organizationId,
        string entity, string entityId, int take, Guid? cursor, CancellationToken cancellationToken)
    {
        var page = await ListAsync(organizationId, new(Entity: entity, EntityId: entityId), take, cursor, cancellationToken);
        return new(page.Items.Select(row => new TenantAuditItem<TenantAuditHistoryActor>(
            row.Id, row.OrganizationId, row.UserId, row.ActorId, row.Action, row.Entity, row.EntityId,
            row.Changes, row.Metadata, row.IpAddress, row.UserAgent, row.CreatedAt,
            row.Actor is null ? null : new(row.Actor.Id, row.Actor.FirstName, row.Actor.LastName))).ToList(), page.NextCursor);
    }

    public Task<TenantAuditDetail?> GetDetailAsync(Guid organizationId, Guid id, CancellationToken cancellationToken) =>
        repository.GetDetailAsync(organizationId, id, cancellationToken);

    public Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(
        Guid organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
        CancellationToken cancellationToken) =>
        repository.GetAccessReportAsync(organizationId, dateFrom, dateTo, cancellationToken);
}
