using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Monitoring;

/// <summary>
/// The staff-JWT authorization gate for the monitoring reads — the C# analog of the TS
/// <c>permissionProcedure('monitoring','read')</c>. It resolves the TIMS staff principal from the JWT
/// <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>monitoring:read</c> grant via
/// the SAME <see cref="PermissionService"/> kernel.
///
/// Like the team-intel gate it does NOT force the org-gate, and that is a deliberate PARITY decision,
/// not an oversight: the TS reader applies NO <c>requireOrgScope</c> to any of these six procedures, and
/// <c>seed-access-matrix.ts</c> grants <c>monitoring:read</c> to <c>hrbp</c> at UNIT scope. Forcing the
/// org-gate here would 403 a role that reads these dashboards today. The only scope mechanic the TS
/// reader actually applies is the <c>scopeWhereFor('actionPlan')</c> ROW filter on
/// <c>getActionPlanAlerts</c>, so the gate RETURNS the resolved scope and that endpoint applies it.
///
/// (That the other five reads return ORG-WIDE aggregates to a unit-scoped holder is a pre-existing
/// property of the live TS surface. It is carried across unchanged and flagged, not silently changed —
/// narrowing it is a product decision for the cutover, not a port decision.)
///
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class MonitoringStaffGate
{
    private const string MonitoringModule = "monitoring";
    private const string ReadAction = "read";

    public static async Task<MonitoringGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken)
            .ConfigureAwait(false);
        if (context is null)
        {
            return MonitoringGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, MonitoringModule, ReadAction, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (TenantOrgRequiredException)
        {
            return MonitoringGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return MonitoringGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return MonitoringGateResult.Ok(context, scope);
    }

    // Reuse the principal PrincipalResolutionMiddleware already resolved (stashed in HttpContext.Items) to
    // avoid a second DB round-trip; fall back to resolving here if absent. JWT `sub` → TenantContext (or
    // null when the caller is not resolvable active staff/owner). Honors the platform-owner impersonation
    // cookie.
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
            cancellationToken).ConfigureAwait(false);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}

/// <summary>Outcome of the monitoring gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct MonitoringGateResult
{
    private MonitoringGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static MonitoringGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static MonitoringGateResult Fail(IResult failure) => new(null, null, failure);
}
