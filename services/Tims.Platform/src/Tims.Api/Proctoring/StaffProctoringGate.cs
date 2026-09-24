using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Proctoring;

/// <summary>Resolves staff before checking the assessment grant; candidate JWTs never pass this gate.</summary>
public static class StaffProctoringGate
{
    public static async Task<StaffProctoringGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext http,
        PrincipalResolver resolver,
        PermissionService permissions,
        PlatformOptions options,
        string action,
        CancellationToken ct)
    {
        TenantContext? context = null;
        if (http.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal principal)
        {
            context = principal.Context;
        }
        else if (user.FindFirst("sub")?.Value is { Length: > 0 } sub)
        {
            var resolution = await resolver.ResolveStaffAsync(
                sub, http.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
                DateTime.UtcNow, ct);
            context = resolution is { Resolved: true } ? resolution.Context : null;
        }

        if (context is null || context.PrincipalType is not (PrincipalType.OrgUser or PrincipalType.PlatformOwner))
        {
            return StaffProctoringGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        // Proctoring observations are sensitive integrity-test results, not ordinary
        // assessment data. A recruiter/leader can hold assessment:read or :update,
        // but that grant must never expose the review queue or evidence. HRBP and
        // HR admin may read within their granted scope; super admins may review.
        // Restrict the roles supplied to the permission resolver as well: with a
        // recruiter+HRBP account, the recruiter's broader assessment grant must not
        // silently widen the HRBP's unit-scoped integrity access. Section 21
        // permits HR admins and HRBPs to read, but only super admins to write.
        if (!TrySensitivePrincipal(context, action, out var sensitivePrincipal))
        {
            return StaffProctoringGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        try
        {
            var decision = await permissions.CheckAsync(sensitivePrincipal, "assessment", action, ct);
            if (!decision.Allowed || decision.Scope is not { } scope)
            {
                return StaffProctoringGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
            }

            if (!Guid.TryParse(context.OrganizationId, out _) || !Guid.TryParse(context.UserId, out _))
            {
                return StaffProctoringGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
            }

            return StaffProctoringGateResult.Ok(context, scope);
        }
        catch (TenantOrgRequiredException)
        {
            return StaffProctoringGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }
    }

    private static bool TrySensitivePrincipal(
        TenantContext context, string action, out TenantContext sensitivePrincipal)
    {
        sensitivePrincipal = context;
        if (action is not ("read" or "update")) return false;
        if (context.PrincipalType == PrincipalType.PlatformOwner) return true;

        var allowedRoles = context.Roles.Where(role => role == "super_admin"
            || (action == "read" && role is ("hr_admin" or "hrbp"))).ToArray();
        if (allowedRoles.Length == 0) return false;
        sensitivePrincipal = context with { Roles = allowedRoles };
        return true;
    }
}

public readonly record struct StaffProctoringGateResult(
    TenantContext? Context, AccessScope? Scope, IResult? Failure)
{
    public static StaffProctoringGateResult Ok(TenantContext context, AccessScope scope) =>
        new(context, scope, null);

    public static StaffProctoringGateResult Fail(IResult failure) => new(null, null, failure);
}
