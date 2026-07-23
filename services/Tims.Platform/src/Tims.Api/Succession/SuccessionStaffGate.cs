using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Succession;

/// <summary>
/// The staff-JWT authorization gate for the succession reads — the C# analog of the TS
/// <c>permissionProcedure('succession','read')</c>. It resolves the TIMS staff principal from the JWT
/// <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>succession:read</c> grant via the
/// SAME <see cref="PermissionService"/> kernel. Like the team-intel gate it does NOT itself force the
/// org-gate: the nine reads differ (scopeWhereFor on 1, by-id IDOR probe + scopeWhereFor on 2/7/8,
/// requireOrgScope on 3/4/5/6/9), so it RETURNS the resolved scope and each endpoint applies its own mechanic.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class SuccessionStaffGate
{
    private const string SuccessionModule = "succession";
    private const string ReadAction = "read";

    /// <summary>Read gate (original signature) — forwards <c>action = "read"</c> so the read call sites are unchanged.</summary>
    public static Task<SuccessionGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken) =>
        AuthorizeAsync(user, httpContext, principalResolver, permissionService, options, ReadAction, cancellationToken);

    /// <summary>Action-parameterized gate: enforces <c>succession:&lt;action&gt;</c> (create/update/delete for the writes).</summary>
    public static async Task<SuccessionGateResult> AuthorizeAsync(
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
            return SuccessionGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, SuccessionModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return SuccessionGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return SuccessionGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return SuccessionGateResult.Ok(context, scope);
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

/// <summary>Outcome of the succession gate: the resolved principal + its scope, or the failure to return.</summary>
public readonly struct SuccessionGateResult
{
    private SuccessionGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static SuccessionGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static SuccessionGateResult Fail(IResult failure) => new(null, null, failure);
}
