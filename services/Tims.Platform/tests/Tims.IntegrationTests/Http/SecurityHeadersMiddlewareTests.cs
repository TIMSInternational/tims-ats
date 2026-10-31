using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
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
            new TestHostEnvironment(environment),
            NullLogger<SecurityHeadersMiddleware>.Instance);
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

    [Fact]
    public async Task KeepsBothHeadersOnTheServer500WhenAnEndpointThrows()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Production" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        await using var app = builder.Build();
        app.UseMiddleware<SecurityHeadersMiddleware>();
        app.MapGet("/boom", (Func<IResult>)(() => throw new InvalidOperationException("boom")));
        app.MapGet("/ok", () => Results.Ok());
        await app.StartAsync();
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

            using var boom = await client.GetAsync(new Uri("/boom", UriKind.Relative));
            Assert.Equal(System.Net.HttpStatusCode.InternalServerError, boom.StatusCode);
            Assert.Equal("nosniff", string.Join(",", boom.Headers.GetValues("X-Content-Type-Options")));
            Assert.Equal(
                "max-age=31536000; includeSubDomains",
                string.Join(",", boom.Headers.GetValues("Strict-Transport-Security")));
            Assert.Equal(string.Empty, await boom.Content.ReadAsStringAsync());

            using var ok = await client.GetAsync(new Uri("/ok", UriKind.Relative));
            Assert.Equal(System.Net.HttpStatusCode.OK, ok.StatusCode);
            Assert.True(ok.Headers.Contains("Strict-Transport-Security"));
        }
        finally
        {
            await app.StopAsync();
        }
    }
}
