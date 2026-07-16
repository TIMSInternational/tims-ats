using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Testcontainers.PostgreSql;

namespace Tims.IntegrationTests;

/// <summary>
/// WP1.3 acceptance for the runtime conventions: boots the real Tims.Api host in-process
/// (WebApplicationFactory) and proves /health, /ready (reflecting DB state), and the OpenAPI
/// document actually work — closing the "container runs, /health 200, /ready reflects DB/Redis,
/// OpenAPI generated" gate. A real Postgres (Testcontainers) backs the healthy-readiness case.
/// </summary>
public sealed class ApiSmokeTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();

    public Task InitializeAsync() => _postgres.StartAsync();

    public Task DisposeAsync() => _postgres.DisposeAsync().AsTask();

    private static WebApplicationFactory<Program> Factory(string databaseConnectionString) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", databaseConnectionString));

    [Fact]
    public async Task Health_liveness_is_200_regardless_of_dependencies()
    {
        // Point at an unreachable DB — liveness must still be 200 (it runs no dependency checks).
        await using var factory = Factory("Host=localhost;Port=1;Database=x;Username=x;Password=x;Timeout=1;Command Timeout=1");
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_is_200_when_database_is_reachable()
    {
        await using var factory = Factory(_postgres.GetConnectionString());
        using var client = factory.CreateClient();

        // DB healthy; Redis unconfigured → Degraded → still 200 (readiness treats Degraded as ready).
        var response = await client.GetAsync("/ready");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_is_503_when_database_is_unreachable()
    {
        await using var factory = Factory("Host=localhost;Port=1;Database=x;Username=x;Password=x;Timeout=1;Command Timeout=1");
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/ready");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Config_validation_fails_fast_when_required_value_missing()
    {
        // Empty DatabaseConnectionString ([Required]) → ValidateOnStart throws at host start.
        await using var factory = Factory(string.Empty);
        Assert.ThrowsAny<Exception>(() => factory.CreateClient());
    }

    [Fact]
    public async Task OpenApi_document_is_served()
    {
        await using var factory = Factory(_postgres.GetConnectionString());
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("openapi", body);
    }
}
