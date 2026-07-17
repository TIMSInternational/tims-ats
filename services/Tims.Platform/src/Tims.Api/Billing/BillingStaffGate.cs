using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Billing;

/// <summary>
/// The shared staff-JWT authorization gate for the billing product surfaces — the C# analog of tRPC's
/// <c>permissionProcedure(module, action)</c>. Resolves the TIMS staff principal from the JWT <c>sub</c>
/// (reusing the <c>/require-permission</c> resolution: the <see cref="PrincipalResolutionMiddleware"/> stash
/// first, then <see cref="PrincipalResolver.ResolveStaffAsync"/>), then enforces the grant via the SAME
/// <see cref="PermissionService"/> kernel:
///   unresolvable principal → 401 (<c>ctx.user === null</c>); denied grant → 403; a privileged, org-less
///   principal on a tenant module → 400 (<see cref="TenantOrgRequiredException"/>).
/// Extracted from <see cref="BillingReadEndpoints"/> so the invoice reads AND the usage/plan reads gate
/// identically (both <c>billing:read</c>); behavior-preserving.
/// </summary>
public static class BillingStaffGate
{
    public static async Task<StaffGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        string module,
        string action,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        try
        {
            var decision = await permissionService.CheckAsync(context, module, action, cancellationToken);
            return decision.Allowed
                ? StaffGateResult.Ok(context)
                : StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }
        catch (TenantOrgRequiredException)
        {
            return StaffGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }
    }

    // Reuse the principal already resolved by PrincipalResolutionMiddleware (stashed in HttpContext.Items) to
    // avoid a second DB round-trip; fall back to resolving here if absent. JWT `sub` → TenantContext (or null
    // when the caller is not resolvable active staff/owner). Honors the platform-owner impersonation cookie.
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

/// <summary>Outcome of <see cref="BillingStaffGate.AuthorizeAsync"/>: the resolved+authorized
/// <see cref="TenantContext"/>, or the <see cref="IResult"/> failure to return.</summary>
public readonly struct StaffGateResult
{
    private StaffGateResult(TenantContext? context, IResult? failure)
    {
        Context = context;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public IResult? Failure { get; }

    public static StaffGateResult Ok(TenantContext context) => new(context, null);

    public static StaffGateResult Fail(IResult failure) => new(null, failure);
}
