using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Audit;

namespace Tims.Api.Audit;

public static partial class TenantAuditReadEndpoints
{
    private static void MapTenantAuditListEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant-audit/logs", async (
            Guid? userId, string? entity, string? action, DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
            int? take, Guid? cursor, ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, TenantAuditReadUseCase useCase, CancellationToken cancellationToken) =>
        {
            var (context, failure) = await AuthorizeAsync(user, httpContext, principalResolver,
                permissionService, options.Value, cancellationToken);
            if (failure is not null) return failure;
            if (entity is { Length: > 200 } || action is { Length: > 200 } || take is < 1 or > 100)
                return Results.BadRequest(new { error = "invalid_input" });
            return Results.Ok(await useCase.ListAsync(Guid.Parse(context!.OrganizationId),
                new(userId, entity, action, dateFrom, dateTo), take ?? 25, cursor, cancellationToken));
        })
        .RequireAuthorization()
        .Produces<TenantAuditPage<TenantAuditListActor>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden).WithName("TenantAuditListLogs");

        app.MapGet("/tenant-audit/history", async (
            string entity, string entityId, int? take, Guid? cursor,
            ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
            PermissionService permissionService, IOptions<PlatformOptions> options,
            TenantAuditReadUseCase useCase, CancellationToken cancellationToken) =>
        {
            var (context, failure) = await AuthorizeAsync(user, httpContext, principalResolver,
                permissionService, options.Value, cancellationToken);
            if (failure is not null) return failure;
            if (entity.Length > 200 || entityId.Length > 200 || take is < 1 or > 100)
                return Results.BadRequest(new { error = "invalid_input" });
            return Results.Ok(await useCase.HistoryAsync(Guid.Parse(context!.OrganizationId),
                entity, entityId, take ?? 25, cursor, cancellationToken));
        })
        .RequireAuthorization()
        .Produces<TenantAuditPage<TenantAuditHistoryActor>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden).WithName("TenantAuditGetChangesByEntity");
    }
}
