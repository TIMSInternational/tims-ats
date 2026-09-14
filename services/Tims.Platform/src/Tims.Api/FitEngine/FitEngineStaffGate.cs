using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.FitEngine;

/// <summary>
/// The staff-JWT authorization gate for the FIT-engine endpoints — the C# analog of the TS
/// <c>permissionProcedure('fit_engine', &lt;action&gt;)</c> (read on the queries, create on computeForVacancy,
/// update on upsertRoleFamilyWeightProfile). Resolves the TIMS staff principal from the JWT <c>sub</c> (the
/// <see cref="PrincipalResolutionMiddleware"/> stash, else <see cref="PrincipalResolver.ResolveStaffAsync"/>)
/// and enforces the <c>fit_engine:&lt;action&gt;</c> grant via the SAME <see cref="PermissionService"/> kernel.
/// Like the succession/engagement/nine-box gates it does NOT itself force an org-gate: it RETURNS the resolved
/// scope and each endpoint applies its own mechanic (the vacancy-scoped ones run the assertScoped('vacancy')
/// by-id IDOR probe; the profile endpoints are grant-only, exactly like the TS procedures).
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class FitEngineStaffGate
{
    private const string FitEngineModule = "fit_engine";

    public static async Task<FitEngineGateResult> AuthorizeAsync(
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
            return FitEngineGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, FitEngineModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return FitEngineGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return FitEngineGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return FitEngineGateResult.Ok(context, scope);
    }

    // Reuse the principal PrincipalResolutionMiddleware already resolved (stashed in HttpContext.Items) to
    // avoid a second DB round-trip; fall back to resolving here if absent. Honors the platform-owner
    // impersonation cookie.
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

/// <summary>Outcome of the FIT-engine gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct FitEngineGateResult
{
    private FitEngineGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static FitEngineGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static FitEngineGateResult Fail(IResult failure) => new(null, null, failure);
}
