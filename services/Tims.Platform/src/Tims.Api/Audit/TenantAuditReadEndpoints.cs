using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Audit;

namespace Tims.Api.Audit;

public static class TenantAuditReadEndpoints
{
    public static void MapTenantAuditReadEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant-audit/access-report", async (
            DateTimeOffset? dateFrom, DateTimeOffset? dateTo,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, TenantAuditReadUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            var context = httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var value)
                && value is ResolvedPrincipal resolved ? resolved.Context : null;
            if (context is null)
            {
                var sub = user.FindFirst("sub")?.Value;
                if (string.IsNullOrEmpty(sub)) return Results.Unauthorized();
                var resolution = await principalResolver.ResolveStaffAsync(sub,
                    httpContext.Request.Headers.Cookie.ToString(), options.Value.ImpersonationSecret,
                    DateTime.UtcNow, cancellationToken);
                context = resolution is { Resolved: true } ? resolution.Context : null;
            }
            if (context is null) return Results.Unauthorized();
            try
            {
                var decision = await permissionService.CheckAsync(context, "audit", "read", cancellationToken);
                if (!decision.Allowed || decision.Scope is null || decision.Roles is null)
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
            }
            catch (TenantOrgRequiredException)
            {
                return Results.BadRequest(new { error = "organization_required" });
            }
            if (!Guid.TryParse(context.OrganizationId, out var organizationId))
                return Results.BadRequest(new { error = "organization_required" });
            return Results.Ok(await useCase.GetAccessReportAsync(
                organizationId, dateFrom, dateTo, cancellationToken));
        })
        .RequireAuthorization()
        .Produces<IReadOnlyList<TenantAccessReportRow>>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .WithName("TenantAuditGetAccessReport");
    }
}
