using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Tims.IntegrationTests;

/// <summary>
/// The runtime OpenAPI document (/openapi/v1.json) is a Development convenience. Outside Development the
/// route must not be mapped at all. The committed contract under contracts/openapi is produced at build
/// time and is unaffected. No database is needed: the host starts against an unreachable connection string
/// and nothing here touches it.
/// </summary>
public sealed class OpenApiExposureTests
{
    private const string UnreachableDatabase =
        "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x;Timeout=1;Command Timeout=1";

    private static WebApplicationFactory<Program> Factory(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            builder.UseSetting("Platform:DatabaseConnectionString", UnreachableDatabase);
            // Outside Development the host refuses to start without the rate-limit store; configure one
            // (never called here) so the host boots and the route table can be inspected.
            builder.UseSetting("Platform:RateLimitDynamoDbTable", "tims-ats-ratelimit");
            builder.UseSetting("Platform:RateLimitDynamoDbRegion", "us-west-2");
        });

    private static bool MapsOpenApi(WebApplicationFactory<Program> factory) =>
        factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Any(endpoint => endpoint.RoutePattern.RawText?.StartsWith("/openapi", StringComparison.OrdinalIgnoreCase) == true);

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task Openapi_document_is_not_mapped_outside_development(string environment)
    {
        await using var factory = Factory(environment);
        using var client = factory.CreateClient();

        Assert.False(MapsOpenApi(factory));
        var response = await client.GetAsync("/openapi/v1.json");
        Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("\"openapi\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Openapi_document_is_mapped_in_development()
    {
        // The positive control: the same route-table check sees the route when it IS mapped, so the
        // assertion above cannot pass merely because the lookup is wrong.
        await using var factory = Factory("Development");
        using var client = factory.CreateClient();

        Assert.True(MapsOpenApi(factory));
        var response = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
