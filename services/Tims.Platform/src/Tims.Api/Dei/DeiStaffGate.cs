using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Dei;

/// <summary>
/// The staff-JWT authorization gate for the DEI reads — the C# analog of the TS
/// <c>permissionProcedure('dei','read')</c>. It resolves the TIMS staff principal from the JWT <c>sub</c> (the
/// <see cref="PrincipalResolutionMiddleware"/> stash, else <see cref="PrincipalResolver.ResolveStaffAsync"/>) and
/// enforces the <c>dei:read</c> grant via the SAME <see cref="PermissionService"/> kernel. It is a GRANT-ONLY gate
/// (VERIFIED: the live dei reads carry NO <c>requireOrgScope</c> — they are org-wide demographic rollups gated
/// only by the grant, with k-anonymity as the disclosure control), so a caller holding <c>dei:read</c> at ANY
/// scope passes; there is no org-gate / scopeWhereFor / subject probe.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.
/// </summary>
public static class DeiStaffGate
{
    private const string DeiModule = "dei";
    private const string ReadAction = "read";

    public static async Task<DeiGateResult> AuthorizeAsync(
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
            return DeiGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, DeiModule, ReadAction, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return DeiGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is null)
        {
            return DeiGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return DeiGateResult.Ok(context);
    }

    // Reuse the principal PrincipalResolutionMiddleware already resolved (stashed in HttpContext.Items) to avoid a
    // second DB round-trip; fall back to resolving here if absent. JWT `sub` → TenantContext (or null when the
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

/// <summary>Outcome of the DEI gate: the resolved principal, or the failure to return.</summary>
public readonly struct DeiGateResult
{
    private DeiGateResult(TenantContext? context, IResult? failure)
    {
        Context = context;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public IResult? Failure { get; }

    public static DeiGateResult Ok(TenantContext context) => new(context, null);

    public static DeiGateResult Fail(IResult failure) => new(null, failure);
}
