using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Api.Authentication;

/// <summary>
/// The resolved TIMS principal for a request, stashed in <see cref="HttpContext.Items"/> by
/// <see cref="PrincipalResolutionMiddleware"/>. A wrapper (not a bare <see cref="TenantContext"/>)
/// so a resolved-to-NULL outcome (valid JWT whose <c>sub</c> is not active staff/owner) is
/// distinguishable from "the middleware never ran" — the presence of the wrapper means resolution
/// happened, and downstream consumers use <see cref="Context"/> directly instead of resolving again.
/// </summary>
public sealed record ResolvedPrincipal(TenantContext? Context)
{
    /// <summary>The <see cref="HttpContext.Items"/> key under which the resolution is stashed.</summary>
    public const string HttpContextKey = "tims.resolved-principal";
}

/// <summary>
/// Resolves the TIMS principal ONCE per request (after <c>UseAuthentication</c>, before the
/// rate-limit middleware) and stashes it in <see cref="HttpContext.Items"/>. This closes the
/// rate-limit divergence (Codex High#1 / opus M1): the limiter must key authenticated requests on
/// the resolved TIMS <c>users.id</c> (AI → <c>org:{orgId}</c>), NOT the raw Supabase JWT <c>sub</c>,
/// exactly like the TS <c>ctx.user.id</c> surface (trpc.ts). It also dedupes the per-endpoint
/// resolve — the authz probe endpoints read the stashed context instead of resolving a second time.
///
/// Only JWT-authenticated requests (<c>HttpContext.User</c> carries a <c>sub</c>) are resolved;
/// anonymous requests skip it (→ the limiter falls back to trusted IP). The candidate/portal org is
/// NOT known from the JWT alone, so candidate resolution can't run here (its <c>organizationId</c> is
/// null → staff-only); an unresolvable JWT stays anonymous for keying. Infra + auth-probe paths are
/// exempt (no principal needed to key them, and some are booted against a placeholder DB).
/// </summary>
public sealed class PrincipalResolutionMiddleware(RequestDelegate next)
{
    private readonly RequestDelegate _next = next;

    // Infra + auth-probe paths that never need a resolved principal for rate-limit keying. NOTE this
    // deliberately does NOT exempt /require-permission or /require-org-scope: those are resolved here
    // so their handlers reuse the stashed context (dedupe). /whoami IS exempt — it echoes the JWT
    // `sub` directly and is booted against a placeholder DB in the WP2.1 tests.
    private static readonly string[] ExemptExactPaths = ["/", "/health", "/ready", "/whoami", "/external-whoami"];
    private static readonly string[] ExemptPrefixes = ["/openapi"];

    public async Task InvokeAsync(
        HttpContext context,
        PrincipalResolver principalResolver,
        IOptions<PlatformOptions> platformOptions)
    {
        if (!IsExempt(context.Request.Path))
        {
            var sub = context.User.FindFirstValue("sub");
            if (!string.IsNullOrEmpty(sub))
            {
                TenantContext? resolved = null;
                try
                {
                    resolved = await principalResolver.ResolveAsync(
                        sub,
                        context.User.FindFirstValue("email") ?? string.Empty,
                        organizationId: null, // portal candidate org is unknown from the JWT → staff-only here
                        context.Request.Headers.Cookie.ToString(),
                        platformOptions.Value.ImpersonationSecret,
                        DateTime.UtcNow,
                        context.RequestAborted).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // Rate-limit keying must NOT be coupled to identity-DB availability: on a
                    // resolution failure the request degrades to anonymous-IP keying (the limiter
                    // reads no stashed principal), and the downstream authorization path — which
                    // re-resolves and enforces — still fails properly if the DB is genuinely down.
                    resolved = null;
                }

                context.Items[ResolvedPrincipal.HttpContextKey] = new ResolvedPrincipal(resolved);
            }
        }

        await _next(context).ConfigureAwait(false);
    }

    private static bool IsExempt(PathString path)
    {
        var value = path.Value ?? "/";
        foreach (var exact in ExemptExactPaths)
        {
            if (string.Equals(value, exact, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        foreach (var prefix in ExemptPrefixes)
        {
            if (value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
