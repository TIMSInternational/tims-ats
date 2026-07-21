using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.TeamIntel;

/// <summary>
/// The staff-JWT authorization gate for the team-intel reads — the C# analog of the TS
/// <c>permissionProcedure('team_intel','read')</c>. It resolves the TIMS staff principal from the JWT
/// <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>team_intel:read</c> grant via the
/// SAME <see cref="PermissionService"/> kernel. Unlike the reporting gate it does NOT itself force the
/// org-gate: the seven procedures differ (by-id IDOR probe on 1–5, scopeWhereFor on 6, requireOrgScope only
/// on 7), so it RETURNS the resolved scope and each endpoint applies its own mechanic.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class TeamIntelStaffGate
{
    private const string TeamIntelModule = "team_intel";
    private const string ReadAction = "read";

    public static async Task<TeamIntelGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return TeamIntelGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, TeamIntelModule, ReadAction, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return TeamIntelGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return TeamIntelGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return TeamIntelGateResult.Ok(context, scope);
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

/// <summary>Outcome of the team-intel gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct TeamIntelGateResult
{
    private TeamIntelGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static TeamIntelGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static TeamIntelGateResult Fail(IResult failure) => new(null, null, failure);
}
