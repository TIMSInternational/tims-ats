using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.PlatformInvitations;

/// <summary>Resolved and authorized caller for the tenant invitation routes.</summary>
public readonly record struct TenantInvitationGateResult(TenantContext? Context, Guid OrganizationId, Guid ActorId, IResult? Failure);

/// <summary>
/// Gate for <c>/tenant-invitations</c>: resolved ORG-USER staff principal (platform owners use the platform
/// console, which has its own gate) holding <c>user:create</c> at ORGANIZATION scope — the permission that
/// lets someone add users to the organization. Narrow (own/team/unit) grants fail closed. Mutations are
/// refused under platform-owner impersonation so an invitation is never attributed to an impersonated user.
///   unresolvable → 401; not org user / no grant / narrow scope / impersonated write → 403; org-less → 400.
/// </summary>
public static class TenantInvitationGate
{
    public static async Task<TenantInvitationGateResult> AuthorizeAsync(ClaimsPrincipal user, HttpContext http,
        PrincipalResolver resolver, PermissionService permissions, PlatformOptions options, bool mutation, CancellationToken ct)
    {
        var context = http.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolved ? resolved.Context : null;
        if (context is null)
        {
            var sub = user.FindFirst("sub")?.Value;
            if (string.IsNullOrEmpty(sub)) return Fail(Results.Unauthorized());
            var resolution = await resolver.ResolveStaffAsync(sub, http.Request.Headers.Cookie.ToString(),
                options.ImpersonationSecret, DateTime.UtcNow, ct);
            context = resolution is { Resolved: true } ? resolution.Context : null;
        }
        if (context is null) return Fail(Results.Unauthorized());
        if (context.PrincipalType != PrincipalType.OrgUser) return Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        if (mutation && context.ImpersonatedBy is not null) return Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        if (!Guid.TryParse(context.OrganizationId, out var organizationId) || organizationId == Guid.Empty)
            return Fail(Results.BadRequest(new { error = "organization_required" }));
        if (!Guid.TryParse(context.UserId, out var actorId)) return Fail(Results.Unauthorized());
        AccessDecision decision;
        try { decision = await permissions.CheckAsync(context, "user", "create", ct); }
        catch (TenantOrgRequiredException) { return Fail(Results.BadRequest(new { error = "organization_required" })); }
        if (!decision.Allowed || decision.Scope is not { } scope || !OrgGate.RequireOrgScopeSatisfied(scope))
            return Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        return new(context, organizationId, actorId, null);
    }

    private static TenantInvitationGateResult Fail(IResult failure) => new(null, Guid.Empty, Guid.Empty, failure);
}
