using Microsoft.AspNetCore.Http;
using Tims.Api.Http;
using Tims.IntegrationTests.RateLimiting;

namespace Tims.IntegrationTests.Http;

public sealed class SecurityHeadersMiddlewareTests
{
    private static async Task<(HttpContext Context, bool NextCalled)> RunAsync(string environment)
    {
        var nextCalled = false;
        var middleware = new SecurityHeadersMiddleware(
            _ =>
            {
                nextCalled = true;
                return Task.CompletedTask;
            },
            new TestHostEnvironment(environment));
        var context = new DefaultHttpContext();
        await middleware.InvokeAsync(context);
        return (context, nextCalled);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task AddsNosniffAndHstsOutsideDevelopment(string environment)
    {
        var (context, nextCalled) = await RunAsync(environment);

        Assert.True(nextCalled);
        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"].ToString());
        Assert.Equal(
            "max-age=31536000; includeSubDomains",
            context.Response.Headers["Strict-Transport-Security"].ToString());
    }

    [Fact]
    public async Task AddsNoHeadersInDevelopment()
    {
        var (context, nextCalled) = await RunAsync("Development");

        Assert.True(nextCalled);
        Assert.False(context.Response.Headers.ContainsKey("X-Content-Type-Options"));
        Assert.False(context.Response.Headers.ContainsKey("Strict-Transport-Security"));
    }
}
