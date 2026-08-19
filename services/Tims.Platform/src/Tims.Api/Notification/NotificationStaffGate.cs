using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.Notification;

/// <summary>
/// The staff-JWT authorization gate for the two GRANT-gated notification endpoints — the C# analog of the TS
/// <c>permissionProcedure('notification', 'create')</c> guarding <c>create</c> and <c>bulkCreate</c>. Resolves
/// the TIMS staff principal from the JWT <c>sub</c> (the <see cref="PrincipalResolutionMiddleware"/> stash, else
/// <see cref="PrincipalResolver.ResolveStaffAsync"/>) and enforces the <c>notification:create</c> grant via the
/// SAME <see cref="PermissionService"/> kernel.
///
/// <para>The OTHER NINE procedures do NOT come through here — they are bare <c>protectedProcedure</c> and use
/// the shared <see cref="SelfServiceGate"/>, where identity alone authorizes. Keeping the two paths visibly
/// separate is the point: routing a self-service read through this gate would 403 every ordinary user, and
/// routing <c>create</c> through the self-service gate would let any authenticated user forge a notification
/// for anyone.</para>
///
/// <para>Like the succession/engagement/nine-box/fit-engine gates it does NOT itself force an org gate: it
/// RETURNS the resolved scope, and these two endpoints deliberately do not apply one — the TS procedures are
/// grant-only, with no <c>assertScoped</c> on the target user.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less → 400.</para>
/// </summary>
public static class NotificationStaffGate
{
    private const string NotificationModule = "notification";

    public static async Task<NotificationGateResult> AuthorizeAsync(
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
            return NotificationGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, NotificationModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return NotificationGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        // An allowed decision always carries a scope; a null Scope is a contract violation → fail closed.
        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return NotificationGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        return NotificationGateResult.Ok(context, scope);
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

/// <summary>Outcome of the notification grant gate: the resolved principal + its scope, or the failure.</summary>
public readonly struct NotificationGateResult
{
    private NotificationGateResult(TenantContext? context, AccessScope? scope, IResult? failure)
    {
        Context = context;
        Scope = scope;
        Failure = failure;
    }

    public TenantContext? Context { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static NotificationGateResult Ok(TenantContext context, AccessScope scope) => new(context, scope, null);

    public static NotificationGateResult Fail(IResult failure) => new(null, null, failure);
}
