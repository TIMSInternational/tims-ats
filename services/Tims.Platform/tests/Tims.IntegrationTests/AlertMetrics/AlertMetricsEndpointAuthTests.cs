using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Api.AlertMetrics;

namespace Tims.IntegrationTests.AlertMetrics;

/// <summary>
/// The isolation boundary for the highest-blast-radius surface in the service: a reader that runs OUTSIDE
/// RLS and can count rows in EVERY organization. These tests are the acceptance criterion — the surface must
/// be unreachable without the privileged caller identity.
///
/// Matrix: flag off (default) → 404 · no header → 401 · wrong secret → 401 · secret NOT configured → 401
/// even with a header · a valid tenant JWT with no cron header → 401 · correct secret → 200.
/// </summary>
[Collection("AlertMetrics")]
public sealed class AlertMetricsEndpointAuthTests(AlertMetricsFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Path = "/internal/alert-metrics";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "alert-metrics-test-key" };

    private readonly AlertMetricsFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory(string? cronSecret = AlertMetricsFixture.CronSecret) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AlertMetricsCronReadEnabled", "true");
            if (cronSecret is not null)
            {
                builder.UseSetting("Platform:AlertMetricsCronSecret", cronSecret);
            }

            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

    private static string Mint(string sub)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private static string Query(Guid orgId, string metric) =>
        $"{Path}?organizationId={orgId}&metric={metric}";

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, string url, string? cronSecret = null, string? bearer = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (cronSecret is not null) request.Headers.Add(CronCallerGate.HeaderName, cronSecret);
        if (bearer is not null) request.Headers.Add("Authorization", $"Bearer {bearer}");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "active_surveys"), AlertMetricsFixture.CronSecret);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task NoCronHeader_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "active_surveys"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("wrong")]
    [InlineData("cron-secret-under-test-do-not-reus")]  // one char short — a prefix must not pass
    [InlineData("cron-secret-under-test-do-not-reuseX")] // one char long
    public async Task WrongCronSecret_Is401(string presented)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "active_surveys"), presented);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task SecretNotConfigured_Is401_EvenWithAMatchingLookingHeader(string? configured)
    {
        // Fail-closed on misconfiguration: an unset/blank secret must reject EVERYTHING, including a caller
        // presenting the same blank value. The opposite default is how an anonymous cross-org reader ships.
        await using var factory = EnabledFactory(cronSecret: configured);
        using var client = factory.CreateClient();

        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await Send(client, Query(AlertMetricsFixture.OrgA, "active_surveys"), configured ?? "")).StatusCode);
    }

    [Fact]
    public async Task ValidTenantJwt_WithoutTheCronSecret_Is401()
    {
        // The point of the whole design: holding a legitimate tenant session buys NOTHING here. There is no
        // code path from a user identity to this cross-org reader.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "active_surveys"), cronSecret: null, bearer: Mint("sub-any-tenant-user"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UnknownMetric_FromAnUNAUTHENTICATEDCaller_Is401_Not400()
    {
        // Auth is checked BEFORE input parsing, so an unauthenticated caller cannot use the 400/401 split to
        // discover which metric keys the surface implements.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "not_a_metric"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UnknownMetric_FromTheAuthenticatedCron_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgA, "not_a_metric"), AlertMetricsFixture.CronSecret);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CorrectCronSecret_Is200_AndReturnsTheCrossOrgCount()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(client, Query(AlertMetricsFixture.OrgB, "active_surveys"), AlertMetricsFixture.CronSecret);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("value", body.RootElement.GetProperty("status").GetString());
        Assert.Equal(AlertMetricsFixture.OrgBActiveSurveys, body.RootElement.GetProperty("value").GetInt32());
        Assert.Equal("active_surveys", body.RootElement.GetProperty("metric").GetString());
    }

    [Fact]
    public async Task SuppressedSensitiveMetric_CarriesNoNumberOnTheWire()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Send(
            client, Query(AlertMetricsFixture.OrgB, "pending_salary_adjustments"), AlertMetricsFixture.CronSecret);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        using var body = JsonDocument.Parse(raw);
        Assert.Equal("suppressed", body.RootElement.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, body.RootElement.GetProperty("value").ValueKind);
        // Belt and braces: the sub-floor count (3) must not appear ANYWHERE in the payload.
        Assert.DoesNotContain("3", raw);
    }
}
