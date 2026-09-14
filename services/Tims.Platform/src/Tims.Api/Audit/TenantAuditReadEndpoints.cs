using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.Identity;

namespace Tims.Api.Audit;

public static partial class TenantAuditReadEndpoints
{
    public static void MapTenantAuditReadEndpoints(this WebApplication app)
    {
        app.MapTenantAuditListEndpoints();
        app.MapTenantAuditExportEndpoint();
        app.MapGet("/tenant-audit/access-report", async (
            DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, TenantAuditReadUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var (context, failure) = await AuthorizeAsync(user, httpContext, principalResolver,
                permissionService, options.Value, cancellationToken);
            if (failure is not null) return failure;
            return Results.Ok(await useCase.GetAccessReportAsync(
                Guid.Parse(context!.OrganizationId), dateFrom, dateTo, cancellationToken));
        })
        .RequireAuthorization()
        .Produces<IReadOnlyList<TenantAccessReportRow>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .WithName("TenantAuditGetAccessReport");

        app.MapGet("/tenant-audit/logs/{id:guid}", async (
            Guid id, ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, TenantAuditReadUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var (context, failure) = await AuthorizeAsync(user, httpContext, principalResolver,
                permissionService, options.Value, cancellationToken);
            if (failure is not null) return failure;
            var log = await useCase.GetDetailAsync(Guid.Parse(context!.OrganizationId), id, cancellationToken);
            return log is null ? Results.NotFound() : Results.Ok(log);
        })
        .RequireAuthorization()
        .Produces<TenantAuditDetail>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .WithName("TenantAuditGetLogDetail");
    }

    private static async Task<(TenantContext? Context, IResult? Failure)> AuthorizeAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PermissionService permissionService, PlatformOptions options, CancellationToken cancellationToken, string action = "read")
    {
        var context = httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var value)
            && value is ResolvedPrincipal resolved ? resolved.Context : null;
        if (context is null)
        {
            var sub = user.FindFirst("sub")?.Value;
            if (string.IsNullOrEmpty(sub)) return (null, Results.Unauthorized());
            var resolution = await principalResolver.ResolveStaffAsync(sub,
                httpContext.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
                DateTime.UtcNow, cancellationToken);
            context = resolution is { Resolved: true } ? resolution.Context : null;
        }
        if (context is null) return (null, Results.Unauthorized());
        try
        {
            var decision = await permissionService.CheckAsync(context, "audit", action, cancellationToken);
            if (!decision.Allowed || decision.Scope is null || decision.Roles is null)
                return (null, Results.StatusCode(StatusCodes.Status403Forbidden));
        }
        catch (TenantOrgRequiredException)
        {
            return (null, Results.BadRequest(new { error = "organization_required" }));
        }
        if (!Guid.TryParse(context.OrganizationId, out var organizationId))
            return (null, Results.BadRequest(new { error = "organization_required" }));
        return (context, null);
    }
}
