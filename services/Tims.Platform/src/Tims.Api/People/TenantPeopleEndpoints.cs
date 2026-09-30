using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.People;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.People;

namespace Tims.Api.People;

/// <summary>
/// Tenant "assignable people" directory for pickers (interview evaluators, vacancy approvers, offer
/// approvers). Replaces the pickers' dependency on tRPC <c>user.list</c>, which requires <c>user:read</c>
/// — a grant recruiters deliberately do not hold. Authorization follows the action the picker serves, and
/// the response is the minimal projection a picker renders. Dark unless TenantPeopleDirectoryEnabled.
/// </summary>
public static class TenantPeopleEndpoints
{
    public static void MapTenantPeopleEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant/people/assignable", async (
            string? purpose, string? search, int? limit,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, AssignablePeopleUseCase useCase,
            CancellationToken cancellationToken) =>
        {
            // Bind as raw values and validate here: bounds are enforced before any identity or DB work.
            if (!AssignablePurposes.TryParse(purpose, out var parsedPurpose)
                || search is { Length: > AssignablePurposes.MaxSearchLength }
                || limit is < 1 or > AssignablePurposes.MaxLimit)
            {
                return Results.BadRequest(new { error = "invalid_input" });
            }

            var rule = AssignablePurposes.RuleFor(parsedPurpose);
            var context = await ResolveAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
            if (context is null) return Results.Unauthorized();
            try
            {
                var decision = await permissionService.CheckAsync(
                    context, rule.CallerModule, rule.CallerAction, cancellationToken);
                if (!decision.Allowed || decision.Scope is not { } callerScope || decision.Roles is null)
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                // The unfiltered directory needs org-wide scope (AssignablePurposes.CallerScopeAllows).
                if (!AssignablePurposes.CallerScopeAllows(rule, callerScope))
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
            }
            catch (TenantOrgRequiredException)
            {
                return Results.BadRequest(new { error = "organization_required" });
            }
            if (!Guid.TryParse(context.OrganizationId, out var organizationId))
                return Results.BadRequest(new { error = "organization_required" });

            return Results.Ok(await useCase.ListAsync(organizationId, parsedPurpose, search,
                limit ?? AssignablePurposes.DefaultLimit, cancellationToken));
        })
        .RequireAuthorization()
        .Produces<AssignablePeopleResult>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .WithName("TenantPeopleListAssignable");
    }

    private static async Task<TenantContext?> ResolveAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PlatformOptions options, CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var value)
            && value is ResolvedPrincipal resolved)
        {
            return resolved.Context;
        }
        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub)) return null;
        var resolution = await principalResolver.ResolveStaffAsync(sub,
            httpContext.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
            DateTime.UtcNow, cancellationToken);
        return resolution is { Resolved: true } ? resolution.Context : null;
    }
}
