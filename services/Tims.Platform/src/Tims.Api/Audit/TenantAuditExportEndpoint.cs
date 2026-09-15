using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Audit;

namespace Tims.Api.Audit;

public sealed record TenantAuditExportRequest(string Format, Guid? ActorId = null, string? Entity = null,
    string? Action = null, DateTimeOffset? DateFrom = null, DateTimeOffset? DateTo = null);

public static partial class TenantAuditReadEndpoints
{
    private static void MapTenantAuditExportEndpoint(this WebApplication app)
    {
        app.MapPost("/tenant-audit/export", async (
            TenantAuditExportRequest body, ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, TenantAuditReadUseCase useCase,
            ISecurityEventWriter audit, CancellationToken cancellationToken) =>
        {
            var (context, failure) = await AuthorizeAsync(user, httpContext, principalResolver,
                permissionService, options.Value, cancellationToken, "export");
            if (failure is not null) return failure;
            if (body.Format is not ("csv" or "json") || body.Entity is { Length: > 200 } || body.Action is { Length: > 200 })
                return Results.BadRequest(new { error = "invalid_input" });
            var organizationId = Guid.Parse(context!.OrganizationId);
            var result = await useCase.ExportAsync(organizationId,
                new(body.ActorId, body.Entity, body.Action, body.DateFrom, body.DateTo), body.Format, cancellationToken);
            var metadata = new JsonObject { ["resource"] = "audit_log", ["count"] = result.Count, ["format"] = result.Format };
            if (result.Truncated) metadata["truncated"] = true;
            // Shared writer is explicitly best effort, matching logPlatformExport. Attribute impersonated
            // operations to the owner while retaining the target tenant.
            await audit.WriteAsync(new SecurityEvent(organizationId,
                Guid.Parse(context.ImpersonatedBy ?? context.UserId), "platform_export", "export:audit_log", null,
                metadata, httpContext.ClientIpFor(), httpContext.Request.Headers.UserAgent.ToString()),
                CancellationToken.None);
            return Results.Ok(result);
        })
        .RequireAuthorization()
        .Produces<TenantAuditExport>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden).WithName("TenantAuditExportLogs");
    }
}
