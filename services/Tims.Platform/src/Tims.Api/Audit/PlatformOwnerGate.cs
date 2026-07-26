using System.Security.Claims;
using Tims.Api.Authentication; // ResolvedPrincipal — the middleware-stashed principal
using Tims.Api.Configuration;
using Tims.Api.Reporting; // StaffGateResult — reused, not duplicated
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Api.Audit;

/// <summary>
/// The platform-owner-only gate for the cross-org audit-log endpoints — the C# analog of the TS
/// <c>platformProcedure</c> (routers/platform/_common.ts): <c>if (!ctx.user.isPlatformOwner) throw
/// FORBIDDEN</c>. UNLIKE <see cref="Tims.Api.Reporting.ReportingStaffGate"/> there is no permission
/// grant to check and no org-scope requirement — the ONLY question is the resolved principal's
/// <see cref="PrincipalType"/>.
///
/// An impersonated platform-owner session resolves to <see cref="PrincipalType.OrgUser"/> by
/// construction (<c>StaffContextResolver.ResolveStaffContext</c> — impersonation always yields the
/// TARGET's identity), so this gate correctly denies it with NO special-case code: a platform owner
/// must drop impersonation to reach this endpoint, matching TS's <c>ctx.user.isPlatformOwner</c>
/// check against the real (non-impersonated) user row.
///   unresolvable principal → 401; resolved but not PlatformOwner → 403.
/// </summary>
public static class PlatformOwnerGate
{
    public static async Task<StaffGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        if (context.PrincipalType != PrincipalType.PlatformOwner)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return StaffGateResult.Ok(context);
    }

    // Identical resolution path to ReportingStaffGate — reuse the middleware-stashed principal first.
    private static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}
