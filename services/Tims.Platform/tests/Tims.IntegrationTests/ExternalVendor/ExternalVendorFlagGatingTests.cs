using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// FIX 1 (Codex HIGH) — the Phase-5 strangler deploy flags are REAL: dark-by-default gating of the C#
/// external surfaces. When a per-surface flag is OFF (the DEFAULT), the route is NOT mapped, so a request
/// 404s and TS remains the ONLY active writer/reader (no dual-writer coexistence). When ON, the route is
/// mapped, so an unauthenticated request reaches the ApiKey gate and is 401 (proving the route EXISTS).
///
/// The 404 cases deliberately DON'T set the flag — they rely on the PlatformOptions DEFAULT (false), so
/// flipping that default to true makes them fail (the intended bite). No container: the host boots against
/// a placeholder DB (lazy DbContext), and both 404 (route absent) and 401 (no credential) precede any DB hit.
///
/// Joins the "ExternalValidation" collection (whose container it does NOT use) purely to SERIALIZE its
/// in-process host boots with the other external-vendor host tests — sharing a collection disables
/// intra-collection parallelism, avoiding a Serilog ReloadableLogger freeze race that surfaces when several
/// WebApplicationFactory&lt;Program&gt; hosts freeze the shared static bootstrap logger concurrently.
/// </summary>
[Collection("ExternalValidation")]
public sealed class ExternalVendorFlagGatingTests
{
    private const string WritePath = "/external/validations/11111111-1111-1111-1111-111111111111/result";
    private const string ReadPath = "/external/assessment-results";
    private const string PlaceholderDb = "Host=localhost;Port=5432;Database=x;Username=x";

    // Relies on the deploy-flag DEFAULTS (both false) — sets NOTHING but the required DB connection string.
    private static WebApplicationFactory<Program> DefaultFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", PlaceholderDb));

    private static WebApplicationFactory<Program> Factory(bool write, bool read) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", PlaceholderDb);
            builder.UseSetting("Platform:ExternalVendorWriteEnabled", write ? "true" : "false");
            builder.UseSetting("Platform:ExternalVendorReadEnabled", read ? "true" : "false");
        });

    private static StringContent EmptyJson() => new("{}", Encoding.UTF8, "application/json");

    // ---- dark by default: flag OFF (default) → route NOT mapped → 404 (TS is the sole active stack) ----
    [Fact]
    public async Task WriteRoute_is_404_when_write_flag_defaults_off()
    {
        await using var factory = DefaultFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsync(WritePath, EmptyJson());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ReadRoute_is_404_when_read_flag_defaults_off()
    {
        await using var factory = DefaultFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(ReadPath);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route exists) --------
    [Fact]
    public async Task WriteRoute_is_not_404_when_write_flag_on()
    {
        await using var factory = Factory(write: true, read: false);
        using var client = factory.CreateClient();
        var response = await client.PostAsync(WritePath, EmptyJson());
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ReadRoute_is_not_404_when_read_flag_on()
    {
        await using var factory = Factory(write: false, read: true);
        using var client = factory.CreateClient();
        var response = await client.GetAsync(ReadPath);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
