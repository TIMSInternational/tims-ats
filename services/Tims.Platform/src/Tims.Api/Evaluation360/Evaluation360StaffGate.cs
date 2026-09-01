using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Evaluation360;

/// <summary>
/// The staff-JWT authorization gate for the evaluation360 STAFF reads (<c>listCycles</c>, <c>getCycleProgress</c>)
/// — the C# analog of the TS <c>permissionProcedure('evaluation360','read')</c> FOLLOWED by
/// <c>requireOrgScope(ctx.access)</c>. It resolves the TIMS staff principal from the JWT <c>sub</c> (the
/// <see cref="PrincipalResolutionMiddleware"/> stash, else <see cref="PrincipalResolver.ResolveStaffAsync"/>),
/// enforces the <c>evaluation360:read</c> grant via the SAME <see cref="PermissionService"/> kernel, and THEN —
/// because these procedures list/aggregate ORG-WIDE cycles + assignments — requires the resolved scope to be
/// organization/company (<see cref="OrgGate"/>). Narrow team/unit/own <c>evaluation360:read</c> roles fail
/// closed with 403 (Codex F3 invariant).
///   unresolvable principal → 401; denied grant OR narrow scope → 403; privileged org-less → 400.
///
/// This mirrors <c>ReportingStaffGate</c> exactly, differing only in the module (<c>evaluation360</c>). It is
/// SEPARATE from <see cref="SelfServiceGate"/>: the self-service reads authorize on IDENTITY, not a
/// grant, and MUST NOT run this org-gate (an org-scoped admin degrades match-all and could read another user's
/// data). Do not cross the two.
///
/// Slice-13 (evaluation360 WRITE) adds an action-parameterized overload so the 5 STAFF writes enforce
/// <c>evaluation360:create</c> (createCycle/assignRaters) / <c>evaluation360:update</c> (open/close/publishCycle)
/// through the SAME kernel + the SAME org-gate (TS <c>requireOrgScope</c> is the first line of every staff resolver).
/// The original read overload forwards <c>action = "read"</c> so every read call site is byte-unchanged.
/// </summary>
public static class Evaluation360StaffGate
{
    private const string Evaluation360Module = "evaluation360";
    private const string ReadAction = "read";

    /// <summary>Read gate (original signature) — forwards <c>action = "read"</c> so read call sites are unchanged.</summary>
    public static Task<StaffGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken) =>
        AuthorizeAsync(user, httpContext, principalResolver, permissionService, options, ReadAction, cancellationToken);

    /// <summary>Action-parameterized gate: enforces <c>evaluation360:&lt;action&gt;</c> (create/update for the writes)
    /// + the organization/company org-gate. CA1068-safe (<c>CancellationToken</c> stays last).</summary>
    public static async Task<StaffGateResult> AuthorizeAsync(
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
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, Evaluation360Module, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return StaffGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // permissionProcedure('evaluation360', action) — grant check. An allowed decision always carries a scope,
        // so a null Scope is a contract violation → fail closed (never default to Organization).
        if (!decision.Allowed || decision.Scope is not { } resolvedScope)
        {
            return StaffGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        // requireOrgScope(ctx.access) — org-rollup gate. Narrow (own/team/unit) scopes must not read the
        // org-wide cycle list/progress; fail closed with 403 (Codex F3).
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

/// <summary>Outcome of <see cref="Evaluation360StaffGate.AuthorizeAsync"/>: the resolved+authorized
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
