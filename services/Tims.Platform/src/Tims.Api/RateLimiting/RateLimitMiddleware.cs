using Tims.Api.Authentication;
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
/// Infra + auth-probe endpoints are exempt (they are not product surfaces — the current host maps
/// only health/readiness/OpenAPI + the WP2.1-2.5 auth probes). Real product endpoints added later
/// are limited by default (denylist, not allowlist).
/// </summary>
public sealed class RateLimitMiddleware(RequestDelegate next)
{
    private readonly RequestDelegate _next = next;

    // Infra + non-product auth-probe paths that must never be throttled.
    // /billing/webhooks/stripe is ANONYMOUS + authenticated by the Stripe signature; Stripe delivers from a
    // small shared-IP pool, so the anonymous IP-keyed limiter could 429 a delivery burst (a divergence from
    // the un-throttled TS/Vercel route). Exempt it — the apply is idempotent, but a 429 forces needless retries.
    private static readonly string[] ExemptExactPaths =
        ["/", "/health", "/ready", "/whoami", "/external-whoami", "/billing/webhooks/stripe"];
    private static readonly string[] ExemptPrefixes = ["/openapi", "/require-permission", "/require-org-scope"];

    public async Task InvokeAsync(HttpContext context, RateLimitGuard guard)
    {
        if (IsExempt(context.Request.Path))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        var category = RateLimitHttp.CategoryFor(context.Request);
        var identifier = BuildIdentifier(context, category);

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
    private static string BuildIdentifier(HttpContext context, RateLimitCategory category)
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
