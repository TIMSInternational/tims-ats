using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Boots <c>WebApplicationFactory&lt;Program&gt;</c> and drives the REAL HTTP pipeline for the self-serve billing
/// WRITE endpoints — proving the two endpoint-level guarantees cheaply (no DB / no Stripe): DARK-by-default
/// (the routes are NOT mapped when the flag is off → 404) and AUTH-REQUIRED (mapped but no JWT → 401). The
/// grant/permission gate itself is the reused <see cref="Tims.Api.Billing.BillingStaffGate"/> (already
/// HTTP-tested by the billing read endpoints); the orchestration is covered by the use-case unit suite.
/// </summary>
public sealed class BillingSelfServeEndpointTests
{
    // A non-empty placeholder DB connection: the DbContexts are lazy, so 404/401 never open it.
    private const string PlaceholderDb = "Host=localhost;Port=1;Database=none;Username=none;Password=none";

    private static WebApplicationFactory<Program> Factory(bool selfServeEnabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", PlaceholderDb);
            builder.UseSetting("Platform:BillingSelfServeEnabled", selfServeEnabled ? "true" : "false");
        });

    [Theory]
    [InlineData("/billing/checkout-session")]
    [InlineData("/billing/portal-session")]
    [InlineData("/billing/cancel-subscription")]
    public async Task Dark_by_default_the_routes_are_not_mapped(string path)
    {
        await using var factory = Factory(selfServeEnabled: false);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(path, new { plan = "professional" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode); // flag off → route absent
    }

    [Theory]
    [InlineData("/billing/checkout-session")]
    [InlineData("/billing/portal-session")]
    [InlineData("/billing/cancel-subscription")]
    public async Task Enabled_but_unauthenticated_is_401(string path)
    {
        await using var factory = Factory(selfServeEnabled: true);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(path, new { plan = "professional" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode); // mapped, but the JWT gate rejects
    }
}
