using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.Proctoring;
using Tims.Domain.Identity;
using Tims.Domain.RateLimiting;

namespace Tims.Api.RateLimiting;

/// <summary>
/// The ASP.NET seam that runs the limiter on every non-infra request — the C# analog of the tRPC
/// <c>withRateLimit</c> middleware. It derives the category (<see cref="RateLimitPolicy.CategoryFor"/>
/// over a dotted path + GET/other → query/mutation) and the identifier
/// (<see cref="RateLimitIdentity.For"/> over the resolved principal + trusted IP headers), then
/// asks the <see cref="RateLimitGuard"/>. On a block it short-circuits with 429
/// <c>TOO_MANY_REQUESTS</c>, the Spanish retry message (byte-identical to the TS <c>TRPCError</c>),
/// and a <c>Retry-After</c> header.
///
/// Infrastructure endpoints are exempt for unresolved callers. Resolved principals and
/// authorization probes are always limited because they can trigger security audit writes.
/// Product endpoints added later are limited by default (denylist, not allowlist).
/// </summary>
public sealed class RateLimitMiddleware(RequestDelegate next)
{
    private readonly RequestDelegate _next = next;

    // Infrastructure paths exempt for callers without a resolved TIMS principal.
    // /billing/webhooks/stripe is ANONYMOUS + authenticated by the Stripe signature; Stripe delivers from a
    // small shared-IP pool, so the anonymous IP-keyed limiter could 429 a delivery burst (a divergence from
    // the un-throttled TS/Vercel route). Exempt it — the apply is idempotent, but a 429 forces needless retries.
    //
    // AlertMetricsEndpoints.RoutePath (#172) is exempt for the same reason, and more sharply: it is an
    // ANONYMOUS route (the cron secret is its credential), so the limiter would key it by IP — and its ONLY
    // intended caller is a single machine issuing one request per (org, metric) across the whole platform in
    // one nightly run. Under the anonymous quota that caller throttles ITSELF partway through, and a metric
    // that 429s is a metric that never evaluates: alerts silently stop firing for every org after the cutoff.
    // The TS/Vercel route it replaces is un-throttled, so exempting it is parity, not a relaxation. Referenced
    // as a constant, never re-typed — a literal here could drift from the route registration silently.
    private static readonly string[] ExemptExactPaths =
    [
        "/", "/health", "/ready", "/whoami", "/external-whoami", "/billing/webhooks/stripe",
        Tims.Api.AlertMetrics.AlertMetricsEndpoints.RoutePath,
    ];
    private static readonly string[] ExemptPrefixes = ["/openapi"];

    public async Task InvokeAsync(HttpContext context, RateLimitGuard guard)
    {
        // Even infrastructure URLs can reach MFA enforcement for resolved staff.
        // Keep health checks exempt, but never provide an audit amplification bypass
        // to a privileged caller by choosing an otherwise exempt path (#181).
        if (IsExempt(context.Request.Path)
            && context.Items[ResolvedPrincipal.HttpContextKey] is not ResolvedPrincipal { Context: not null })
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        var category = RateLimitHttp.CategoryFor(context.Request);
        var identifier = await BuildIdentifierAsync(context, category).ConfigureAwait(false);

        var result = await guard.CheckAsync(identifier, category, context.RequestAborted).ConfigureAwait(false);
        if (result.Allowed)
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        var (retryAfter, json) = RateLimitHttp.BuildRejection(result);
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.Response.Headers.RetryAfter = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(json, context.RequestAborted).ConfigureAwait(false);
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

    /// <summary>
    /// Builds the per-caller identifier. Priority (faithful to the TS <c>ctx.user.id</c> surface):
    /// <list type="number">
    /// <item>The TIMS principal resolved once by <see cref="PrincipalResolutionMiddleware"/>
    /// (JWT-authenticated staff/owner) → the resolved <c>users.id</c> (AI → <c>org:{orgId}</c>) —
    /// NEVER the raw Supabase JWT <c>sub</c> (closes Codex High#1 / opus M1).</item>
    /// <item>The external ApiKey scheme's <c>api_key_id</c> claim (only present if that scheme
    /// authenticated this request) → per-key <c>apikey:{id}</c>.</item>
    /// <item>Anonymous → the trusted IP headers. The raw JWT <c>sub</c> is never a key.</item>
    /// </list>
    /// </summary>
    private static async Task<string> BuildIdentifierAsync(HttpContext context, RateLimitCategory category)
    {
        var xRealIp = context.Request.Headers["x-real-ip"].ToString();
        var xForwardedFor = context.Request.Headers["x-forwarded-for"].ToString();

        if (context.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal { Context: { } principal })
        {
            var isApiKey = principal.PrincipalType == PrincipalType.ExternalApiKey;
            return RateLimitIdentity.For(
                category,
                userId: isApiKey ? null : principal.UserId,
                organizationId: principal.OrganizationId,
                apiKeyId: isApiKey ? principal.UserId : null,
                xRealIp,
                xForwardedFor);
        }

        // PrincipalResolutionMiddleware cannot identify a portal candidate without
        // an organization. For this fixed candidate route, resolve the route slug
        // through the server-side org repository, then resolve the validated JWT's
        // email within that org. Never key on a raw JWT sub/email, slug, or
        // assignment id: only a resolved candidate's TIMS id may separate users
        // behind a shared school/company IP. A missing/invalid identity falls
        // through to the existing anonymous IP bucket.
        var authenticatedIdentity = context.User.Identities.FirstOrDefault(identity => identity.IsAuthenticated);
        if (RateLimitHttp.TryCandidateProctoringPath(context.Request.Path, out var orgSlug)
            && authenticatedIdentity?.FindFirst("sub")?.Value is { Length: > 0 } sub
            && authenticatedIdentity.FindFirst("email")?.Value is { Length: > 0 } email)
        {
            TenantContext? resolved = null;
            try
            {
                var proctoring = context.RequestServices.GetRequiredService<CandidateProctoringUseCase>();
                var organizationId = await proctoring.ResolveOrganizationBySlugAsync(
                    orgSlug, context.RequestAborted).ConfigureAwait(false);
                if (organizationId is { } orgId)
                {
                    var resolver = context.RequestServices.GetRequiredService<PrincipalResolver>();
                    var options = context.RequestServices.GetRequiredService<IOptions<PlatformOptions>>().Value;
                    resolved = await resolver.ResolveAsync(sub, email, orgId.ToString(),
                        context.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
                        DateTime.UtcNow, context.RequestAborted).ConfigureAwait(false);

                    if (resolved is { PrincipalType: PrincipalType.Candidate }
                        && Guid.TryParse(resolved.UserId, out _)
                        && string.Equals(resolved.OrganizationId, orgId.ToString(), StringComparison.OrdinalIgnoreCase))
                    {
                        return RateLimitIdentity.For(category, resolved.UserId, resolved.OrganizationId,
                            apiKeyId: null, xRealIp, xForwardedFor);
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Match PrincipalResolutionMiddleware: a transient identity/slug
                // lookup failure must not turn the limiter itself into a 500.
                // The handler resolves again and remains the auth boundary;
                // this request receives the anonymous IP budget meanwhile.
            }

            // If a linked staff account also has a candidate email match, the
            // staff-first resolver wins just as it does at the endpoint. Use the
            // ordinary resolved staff key, never the candidate row or raw JWT.
            if (resolved is { PrincipalType: PrincipalType.OrgUser or PrincipalType.PlatformOwner })
            {
                return RateLimitIdentity.For(category, resolved.UserId, resolved.OrganizationId,
                    apiKeyId: null, xRealIp, xForwardedFor);
            }
        }

        var apiKeyIdClaim = context.User.FindFirst(ApiKeyAuthenticationHandler.ApiKeyIdClaimType)?.Value;
        if (!string.IsNullOrEmpty(apiKeyIdClaim))
        {
            return RateLimitIdentity.For(
                category,
                userId: null,
                organizationId: context.User.FindFirst(ApiKeyAuthenticationHandler.OrganizationIdClaimType)?.Value,
                apiKeyId: apiKeyIdClaim,
                xRealIp,
                xForwardedFor);
        }

        // Anonymous — trusted IP only, never the raw JWT `sub`.
        return RateLimitIdentity.For(category, userId: null, organizationId: null, apiKeyId: null, xRealIp, xForwardedFor);
    }
}
