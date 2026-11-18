using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Tims.Api.RateLimiting;
using Tims.IntegrationTests.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-5 rate-limit placement: the candidate's launch is on the strict IP-keyed <c>auth</c> tier (like the other
/// candidate routes), and the HMAC-signed provider webhook is exempt (like the Stripe webhook) so a delivery burst is
/// never 429'd into needless retries.
/// </summary>
public sealed class ProviderRateLimitTests
{
    private static RateLimitGuard InMemoryGuard() =>
        new(sharedLimiter: null,
            new InMemorySlidingWindowRateLimiter(() => 1_000_000_000, startCleanupTimer: false),
            new TestHostEnvironment(Environments.Development));

    private static DefaultHttpContext Post(string path, string ip)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = HttpMethods.Post;
        context.Request.Path = path;
        context.Request.Headers["x-real-ip"] = ip;
        context.Response.Body = new MemoryStream();
        return context;
    }

    [Theory]
    [InlineData("/portal/assessment-attempts/0b8f6e2a-4c3d-4e1f-9a7b-6c5d4e3f2a1b/launch")]
    [InlineData("/Portal/Assessment-Attempts/0b8f6e2a-4c3d-4e1f-9a7b-6c5d4e3f2a1b/LAUNCH/")]
    public async Task The_candidate_launch_is_on_the_strict_auth_budget_in_any_spelling(string path)
    {
        var guard = InMemoryGuard();
        var middleware = new RateLimitMiddleware(_ => Task.CompletedTask);

        for (var i = 0; i < 10; i++)
        {
            var ctx = Post(path, "198.51.100.40");
            await middleware.InvokeAsync(ctx, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, ctx.Response.StatusCode);
        }

        var blocked = Post(path, "198.51.100.40");
        await middleware.InvokeAsync(blocked, guard);
        Assert.Equal(StatusCodes.Status429TooManyRequests, blocked.Response.StatusCode);
    }

    [Fact]
    public async Task The_signed_provider_webhook_is_exempt_from_the_anonymous_ip_budget()
    {
        var guard = InMemoryGuard();
        var nextCalls = 0;
        var middleware = new RateLimitMiddleware(_ =>
        {
            nextCalls++;
            return Task.CompletedTask;
        });

        for (var i = 0; i < 200; i++)
        {
            var ctx = Post("/webhooks/tims-assessments", "203.0.113.7");
            await middleware.InvokeAsync(ctx, guard);
            Assert.NotEqual(StatusCodes.Status429TooManyRequests, ctx.Response.StatusCode);
        }

        Assert.Equal(200, nextCalls);
    }
}
