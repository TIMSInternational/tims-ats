using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 3b endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the billing
/// usage/plan/config READ endpoints through the SAME staff-JWT + billing:read gate as the invoice reads:
///
///   billing:read grant → 200 (/billing/usage real counts, /billing/plan subscription, /billing/config);
///   resolvable staff WITHOUT the grant → 403; no token / tampered JWT / valid-but-not-staff sub → 401;
///   flag OFF (the PlatformOptions DEFAULT) → 404 (dark — TS stays the sole active reader; bite-proven).
/// </summary>
[Collection("BillingRead")]
public sealed class BillingUsageEndpointAuthTests(BillingReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string UsagePath = "/billing/usage";
    private const string PlanPath = "/billing/plan";
    private const string ConfigPath = "/billing/config";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "billing-usage-test-key" };

    private readonly BillingReadFixture _fixture = fixture;

    // Flag ON (routes mapped) + trusts the locally-minted JWKS + points at the fixture DB.
    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:BillingUsageEnabled", "true");
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

    // Flag left at its DEFAULT (false) — flipping the default to true would make the 404 cases fail (the
    // intended dark-by-default bite). Placeholder DB (lazy DbContext, never opened on the dark path).
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ---- 200: billing:read grant returns real data on all three endpoints --------------------------
    [Fact]
    public async Task GrantedStaff_Usage_Is200_WithRealCounts()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, UsagePath, Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // Real professional limits + honest null storage/apiCalls.
        Assert.Contains("\"employees\":{\"used\":2,\"limit\":100}", body);
        Assert.Contains("\"storage\":{\"usedMb\":null,\"limitMb\":null}", body);
        Assert.DoesNotContain("schemaVersion", body);
    }

    [Fact]
    public async Task GrantedStaff_Plan_Is200_WithSubscription()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, PlanPath, Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"plan\":\"professional\"", body);
        Assert.Contains(BillingReadFixture.SubscriptionA.ToString(), body);
    }

    [Fact]
    public async Task GrantedStaff_Config_Is200_NotConfigured()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ConfigPath, Mint(BillingReadFixture.BillingUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // No Stripe config in the test host → honest "not configured".
        Assert.Contains("\"configured\":false", body);
    }

    // ---- 403: resolvable staff whose roles LACK billing:read ---------------------------------------
    [Theory]
    [InlineData(UsagePath)]
    [InlineData(PlanPath)]
    [InlineData(ConfigPath)]
    public async Task NoGrantStaff_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(BillingReadFixture.NoGrantUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token / tampered JWT / valid-signature-but-sub-not-staff --------------------------
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Usage_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, UsagePath, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, UsagePath, Mint("sub-with-no-user-row"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 (bite: flipping the default to
    // true makes these fail). ------------------------------------------------------------------------
    [Theory]
    [InlineData(UsagePath)]
    [InlineData(PlanPath)]
    [InlineData(ConfigPath)]
    public async Task Routes_Are404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ---
    [Fact]
    public async Task UsageRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(UsagePath);

        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
