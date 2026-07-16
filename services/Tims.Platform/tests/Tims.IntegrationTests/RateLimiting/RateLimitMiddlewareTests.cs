using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Tims.Api.Authentication;
using Tims.Api.RateLimiting;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Component test for <see cref="RateLimitMiddleware"/>: drives it with a real
/// <see cref="RateLimitGuard"/> (in-memory, Development) over crafted <see cref="HttpContext"/>s and
/// asserts it derives the category/identifier, short-circuits with 429 + the Spanish retry message
/// (byte-identical to the TS TRPCError) + a Retry-After header, and exempts infra/probe paths.
/// </summary>
public sealed class RateLimitMiddlewareTests
{
    private static RateLimitGuard InMemoryGuard() =>
        new(redisLimiter: null,
            new InMemorySlidingWindowRateLimiter(() => 1_000_000_000, startCleanupTimer: false),
            new TestHostEnvironment(Environments.Development));

    private static DefaultHttpContext Request(string method, string path, Action<HttpContext>? configure = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        configure?.Invoke(context);
        return context;
    }

    [Fact]
    public async Task Blocks_with_429_and_spanish_message_after_the_export_budget()
    {
        var guard = InMemoryGuard();
        var nextCalls = 0;
        var middleware = new RateLimitMiddleware(_ =>
        {
            nextCalls++;
            return Task.CompletedTask;
        });

        // "/report/export" → dotted "report.export" → export category (5 tokens). Anonymous, no headers.
        const int budget = 5;
        for (var i = 0; i < budget; i++)
        {
            var ctx = Request(HttpMethods.Get, "/report/export");
            await middleware.InvokeAsync(ctx, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, ctx.Response.StatusCode);
        }

        Assert.Equal(budget, nextCalls);

        var blocked = Request(HttpMethods.Get, "/report/export");
        await middleware.InvokeAsync(blocked, guard);

        Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
        Assert.Equal(budget, nextCalls); // next was NOT invoked for the blocked request
        Assert.False(StringValuesEmpty(blocked.Response.Headers.RetryAfter));

        blocked.Response.Body.Seek(0, SeekOrigin.Begin);
        var body = await new StreamReader(blocked.Response.Body, Encoding.UTF8).ReadToEndAsync();
        Assert.Contains("TOO_MANY_REQUESTS", body);
        Assert.Contains("Demasiadas solicitudes. Intenta de nuevo en", body);
        Assert.Contains("segundos.", body);
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/ready")]
    [InlineData("/")]
    [InlineData("/whoami")]
    [InlineData("/external-whoami")]
    [InlineData("/openapi/v1.json")]
    [InlineData("/require-permission/candidate/read")]
    [InlineData("/require-org-scope/candidate/read")]
    public async Task Exempts_infra_and_probe_paths(string path)
    {
        var guard = InMemoryGuard();
        var nextCalls = 0;
        var middleware = new RateLimitMiddleware(_ =>
        {
            nextCalls++;
            return Task.CompletedTask;
        });

        // Far more than any budget — an unexempt path would 429 well before this.
        for (var i = 0; i < 200; i++)
        {
            var ctx = Request(HttpMethods.Get, path);
            await middleware.InvokeAsync(ctx, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, ctx.Response.StatusCode);
        }

        Assert.Equal(200, nextCalls);
    }

    [Fact]
    public async Task Keys_external_api_key_surface_on_apikey_identifier()
    {
        // With the api_key_id claim present the external surface is throttled per key. Two requests
        // sharing the key share the bucket; a low budget (export) proves the identifier is honored.
        var guard = InMemoryGuard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);

        HttpContext WithKey() => Request(HttpMethods.Post, "/external/export", ctx =>
        {
            var identity = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(ApiKeyAuthenticationHandler.ApiKeyIdClaimType, "key-123"),
                new System.Security.Claims.Claim(ApiKeyAuthenticationHandler.OrganizationIdClaimType, "org-9"),
            ], "ApiKey");
            ctx.User = new System.Security.Claims.ClaimsPrincipal(identity);
        });

        for (var i = 0; i < RateLimits.Tokens(RateLimitCategory.Export); i++)
        {
            var ctx = WithKey();
            await middleware.InvokeAsync(ctx, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, ctx.Response.StatusCode);
        }

        var blocked = WithKey();
        await middleware.InvokeAsync(blocked, guard);
        Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
    }

    private static bool StringValuesEmpty(Microsoft.Extensions.Primitives.StringValues values) =>
        values.Count == 0 || string.IsNullOrEmpty(values.ToString());
}
