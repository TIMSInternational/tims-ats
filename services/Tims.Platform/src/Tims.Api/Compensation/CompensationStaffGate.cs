using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Compensation;

/// <summary>
/// The staff-JWT authorization gate for the FX-free compensation reads — the C# analog of the TS
/// <c>permissionProcedure('compensation','read')</c>. It resolves the TIMS staff principal from the JWT
/// <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>compensation:read</c> grant via the
/// SAME <see cref="PermissionService"/> kernel. Like the succession/team-intel gates it does NOT itself force
/// the org-gate: the seven reads differ (no gate on getSalaryBands/getMarketComparison; requireOrgScope on
/// getBenefitsUtilization/getCompaRatioDistribution; scopeWhereFor on listPendingAdjustments;
/// assertSubjectInScope on getEmployeeComp; own-pinned on myCompensation), so it RETURNS the resolved scope AND
/// roles and each endpoint applies its own mechanic (the roles feed <c>selectFor</c> on the field-authed reads).
///   unresolvable principal → 401; denied grant OR null scope/roles → 403; privileged org-less → 400.
/// </summary>
public static class CompensationStaffGate
{
    private const string CompensationModule = "compensation";
    private const string ReadAction = "read";

    /// <summary>Read gate (original signature) — forwards <c>action = "read"</c> so read call sites are unchanged.</summary>
    public static Task<CompensationGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken) =>
        AuthorizeAsync(user, httpContext, principalResolver, permissionService, options, ReadAction, cancellationToken);

    /// <summary>Action-parameterized gate: enforces <c>compensation:&lt;action&gt;</c> (create/approve for the writes).</summary>
    public static async Task<CompensationGateResult> AuthorizeAsync(
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
            return CompensationGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, CompensationModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return CompensationGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope + roles; a null of either is a contract violation → closed.
        if (!decision.Allowed || decision.Scope is not { } scope || decision.Roles is not { } roles)
        {
            return CompensationGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return CompensationGateResult.Ok(context, scope, roles);
    }

    // Reuse the principal PrincipalResolutionMiddleware already resolved (stashed in HttpContext.Items) to avoid
    // a second DB round-trip; fall back to resolving here if absent. JWT `sub` → TenantContext (or null when the
    // caller is not resolvable active staff/owner). Honors the platform-owner impersonation cookie.
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

/// <summary>Outcome of the compensation gate: the resolved principal + its scope + roles, or the failure to
/// return. The roles feed <c>selectFor</c> on the field-authed reads (listPendingAdjustments / getEmployeeComp /
/// myCompensation).</summary>
public readonly struct CompensationGateResult
{
    private CompensationGateResult(TenantContext? context, AccessScope? scope, IReadOnlyList<string>? roles, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Roles = roles;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IReadOnlyList<string>? Roles { get; }

    public IResult? Failure { get; }

    public static CompensationGateResult Ok(TenantContext context, AccessScope scope, IReadOnlyList<string> roles) =>
        new(context, scope, roles, null);

    public static CompensationGateResult Fail(IResult failure) => new(null, null, null, failure);
}
