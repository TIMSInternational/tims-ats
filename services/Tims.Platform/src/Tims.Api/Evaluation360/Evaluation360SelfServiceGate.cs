using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Api.Evaluation360;

/// <summary>
/// The IDENTITY-anchored authorization gate for the evaluation360 SELF-SERVICE reads (<c>myRaterTasks</c>,
/// <c>myReport</c>, <c>myReportCycles</c>) — the C# analog of the TS <c>protectedProcedure</c>. This is a NEW
/// pattern with no prior C# template: authorization here is IDENTITY, NOT an RBAC grant. It resolves the TIMS
/// staff principal exactly like <see cref="Evaluation360StaffGate"/> (the middleware stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and a VALID resolved principal is SUFFICIENT — there is
/// NO <c>evaluation360:read</c> grant check and NO org-scope gate. Any assigned rater/subject (e.g. a leader
/// with no eval grant) must succeed.
///
/// Crucially it MUST NOT call <see cref="Tims.Domain.Access.OrgGate"/>, <c>AssertScoped</c>, or
/// <c>ScopeWhereFor</c>: for an org-scoped admin those degrade to match-all and would let them read/forge on
/// behalf of another user. Instead the caller's resolved <see cref="TenantContext.UserId"/> is returned and the
/// downstream queries HARD-FILTER on it (<c>raterUserId</c>/<c>subjectUserId</c> = the caller) — there is no id
/// parameter for the subject/rater, it is ALWAYS the caller.
///   unresolvable principal → 401. (No 403 path exists — there is no grant/scope to deny.)
/// </summary>
public static class Evaluation360SelfServiceGate
{
    public static async Task<SelfServiceGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        return context is null
            ? SelfServiceGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized))
            : SelfServiceGateResult.Ok(context);
    }

    // Same resolution as the staff gate — the middleware stash first, else ResolveStaffAsync — but WITHOUT any
    // grant or scope check afterwards. A candidate/unprovisioned/deactivated sub resolves to null → 401.
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

/// <summary>Outcome of <see cref="Evaluation360SelfServiceGate.AuthorizeAsync"/>: the resolved
/// <see cref="TenantContext"/> (whose <see cref="TenantContext.UserId"/> the queries hard-filter on), or the
/// 401 failure. There is deliberately no scope here — identity is the whole authorization.</summary>
public readonly struct SelfServiceGateResult
{
    private SelfServiceGateResult(TenantContext? context, IResult? failure)
    {
        Context = context;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public IResult? Failure { get; }

    public static SelfServiceGateResult Ok(TenantContext context) => new(context, null);

    public static SelfServiceGateResult Fail(IResult failure) => new(null, failure);
}
