using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.NineBox;

/// <summary>
/// The staff-JWT authorization gate for the nine-box reads — the C# analog of the TS
/// <c>permissionProcedure('ninebox','read')</c>. It resolves the TIMS staff principal from the JWT
/// <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>ninebox:read</c> grant via the SAME
/// <see cref="PermissionService"/> kernel. Like the succession/compensation gates it does NOT itself force the
/// org-gate: the 11 reads differ (scopeWhereFor on getGrid/getMovementHistory, assertSubjectInScope on
/// getEmployeeDetail/getAxisBreakdown, requireOrgScope on listCalibrations/getBenchStrength/getDashboardKpis,
/// hand-rolled membership on getCalibration, created-by-OR-member on myCalibrations, grant-only on
/// simulate/getQuadrantPlan), so it RETURNS the resolved scope and each endpoint applies its own mechanic.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class NineBoxStaffGate
{
    private const string NineBoxModule = "ninebox";
    private const string ReadAction = "read";

    /// <summary>Read gate (original signature) — forwards <c>action = "read"</c> so the read call sites are unchanged.</summary>
    public static Task<NineBoxGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken) =>
        AuthorizeAsync(user, httpContext, principalResolver, permissionService, options, ReadAction, cancellationToken);

    /// <summary>Action-parameterized gate: enforces <c>ninebox:&lt;action&gt;</c> (create/update for the writes).</summary>
    public static async Task<NineBoxGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        string action,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return NineBoxGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, NineBoxModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return NineBoxGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return NineBoxGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return NineBoxGateResult.Ok(context, scope);
    }

    // Reuse the principal PrincipalResolutionMiddleware already resolved (stashed in HttpContext.Items) to
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

/// <summary>Outcome of the nine-box gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct NineBoxGateResult
{
    private NineBoxGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static NineBoxGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static NineBoxGateResult Fail(IResult failure) => new(null, null, failure);
}
