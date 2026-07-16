using System.Globalization;
using Microsoft.Extensions.Hosting;
using Tims.Api.Authentication;
using Tims.Infrastructure.RateLimiting;

namespace Tims.Api.RateLimiting;

/// <summary>
/// Enforces the per-KEY rate-limit quota on the ApiKey-policy endpoints, AFTER the ApiKey scheme has
/// authenticated (Codex High#2). The main <see cref="RateLimitMiddleware"/> runs pre-auth and so
/// never sees an <c>api_key_id</c> (the ApiKey scheme is endpoint-policy auth, not the default), and
/// the auth-probe endpoints are exempt from it anyway; this filter runs post-authorization with the
/// resolved key and keys a second bucket on <c>apikey:{id}</c> — the C# analog of the TS per-key
/// limit in <c>requireApiKey</c> (trpc.ts). Faithful to TS: pre-auth IP limiting (the middleware, on
/// product surfaces) PLUS per-key limiting here.
/// </summary>
public sealed class ApiKeyRateLimitFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var apiKeyId = http.User.FindFirst(ApiKeyAuthenticationHandler.ApiKeyIdClaimType)?.Value;
        if (string.IsNullOrEmpty(apiKeyId))
        {
            // No resolved key (the ApiKey policy would have already 401'd) → nothing to key.
            return await next(context).ConfigureAwait(false);
        }

        var services = http.RequestServices;

        // Skip the per-key limit ONLY when no limiter can make a decision — the same "no limiter
        // available" state the guard encodes (no Redis configured AND not Development). A probe
        // endpoint must stay observable rather than 500 on a misconfigured host; a real deployment
        // always configures Redis, so this path throttles per key. When a limiter IS present, a
        // Redis outage still fails closed in Production (the guard rethrows) exactly like the
        // product surface.
        var redis = services.GetService<RedisSlidingWindowRateLimiter>();
        var environment = services.GetRequiredService<IHostEnvironment>();
        if (redis is null && !environment.IsDevelopment())
        {
            return await next(context).ConfigureAwait(false);
        }

        var guard = services.GetRequiredService<RateLimitGuard>();
        var category = RateLimitHttp.CategoryFor(http.Request);
        var result = await guard.CheckAsync($"apikey:{apiKeyId}", category, http.RequestAborted).ConfigureAwait(false);
        if (result.Allowed)
        {
            return await next(context).ConfigureAwait(false);
        }

        var (retryAfter, json) = RateLimitHttp.BuildRejection(result);
        http.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
        return Results.Content(json, "application/json", statusCode: StatusCodes.Status429TooManyRequests);
    }
}
