using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Reporting;

/// <summary>
/// The staff-JWT authorization gate for the recruitment-analytics reports — the C# analog of the TS
/// <c>permissionProcedure('vacancy','read')</c> FOLLOWED by <c>requireOrgScope(ctx.access)</c>. It resolves
/// the TIMS staff principal from the JWT <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash,
/// else <see cref="PrincipalResolver.ResolveStaffAsync"/>), enforces the <c>vacancy:read</c> grant via the
/// SAME <see cref="PermissionService"/> kernel, and THEN — because these aggregates query ORG-WIDE
/// pipeline/offer data — requires the resolved scope to be organization/company (<see cref="OrgGate"/>).
/// Narrow team/unit/own <c>vacancy:read</c> roles fail closed with 403 (Codex F3 invariant).
///   unresolvable principal → 401; denied grant OR narrow scope → 403; privileged org-less → 400.
/// </summary>
public static class ReportingStaffGate
{
    private const string VacancyModule = "vacancy";
    private const string ReadAction = "read";

    public static async Task<StaffGateResult> AuthorizeAsync(
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
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, VacancyModule, ReadAction, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return StaffGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // permissionProcedure('vacancy','read') — grant check. An allowed decision always carries a scope,
        // so a null Scope is a contract violation → fail closed (never default to Organization).
        if (!decision.Allowed || decision.Scope is not { } resolvedScope)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        // requireOrgScope(ctx.access) — org-rollup gate. Narrow (own/team/unit) scopes must not read the
        // ORG-WIDE aggregates until they are scope-aware; fail closed with 403 (Codex F3).
        if (!OrgGate.RequireOrgScopeSatisfied(resolvedScope))
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return StaffGateResult.Ok(context);
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

/// <summary>Outcome of <see cref="ReportingStaffGate.AuthorizeAsync"/>: the resolved+authorized
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
