using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Reporting;

/// <summary>
/// Phase-5 Slice 5 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the six
/// recruitment-analytics READ endpoints through the actual Supabase JWT scheme + PrincipalResolver +
/// PermissionService <c>vacancy:read</c> grant + the organization/company org-gate:
///
///   organization-scope vacancy:read → 200 (real funnel data);
///   TEAM-scope vacancy:read → 403 (the Codex F3 org-gate bite — narrow scope must NOT read org-wide rollups);
///   resolvable staff WITHOUT the grant → 403; no token / tampered JWT / valid-but-not-staff sub → 401;
///   authorized but invalid ?period → 400 (input validated AFTER auth, matching tRPC);
///   flag OFF (the PlatformOptions DEFAULT) → 404 (dark — TS stays the sole active reader; bite-proven).
/// </summary>
[Collection("ReportingRead")]
public sealed class ReportingReadEndpointAuthTests(ReportingReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string FunnelPath = "/reporting/funnel";
    private const string KpisPath = "/reporting/kpis";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "reporting-test-key" };

    private readonly ReportingReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:ReportingReadEnabled", "true");
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

    // Flag left at its DEFAULT (false) — flipping the default to true makes the 404 cases fail (the
    // intended dark-by-default bite). Placeholder DB (lazy DbContext, never opened for a 404).
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

    // ---- 200: organization-scope vacancy:read returns real funnel data ------------------------------
    [Fact]
    public async Task OrgScopeStaff_Funnel_Is200_WithData()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, FunnelPath, Mint(ReportingReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Applied", body);
        Assert.Contains("\"conversionPct\":25", body); // real OrgA data through the full pipeline
        Assert.DoesNotContain("schemaVersion", body);  // INTERNAL read = raw kernel shape
    }

    // ---- 200: COMPANY-scope vacancy:read also passes the org-gate (both poles, not just organization) --
    [Fact]
    public async Task CompanyScopeStaff_Funnel_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, FunnelPath, Mint(ReportingReadFixture.CompanyReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- 403: TEAM-scope vacancy:read → the org-gate fails closed (Codex F3) ------------------------
    [Theory]
    [InlineData(FunnelPath)]
    [InlineData(KpisPath)]
    [InlineData("/reporting/recruiter-sla")]
    public async Task NarrowScopeStaff_Is403_OrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(ReportingReadFixture.TeamReaderSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 403: resolvable staff whose roles LACK vacancy:read ----------------------------------------
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, FunnelPath, Mint(ReportingReadFixture.NoGrantSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token / tampered JWT / valid-signature-but-sub-not-staff ---------------------------
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, FunnelPath, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, FunnelPath, Mint("sub-with-no-user-row"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- 400: authorized but invalid ?period (validated AFTER auth, matching tRPC middleware order) --
    [Fact]
    public async Task OrgScopeStaff_InvalidPeriod_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{KpisPath}?period=DECADE", Mint(ReportingReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UnauthenticatedBadPeriod_Is401_NotValidatedBeforeAuth()
    {
        // A bad period from an unauthenticated caller is 401 (auth runs first), NOT 400 — no pre-auth input work.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"{KpisPath}?period=DECADE");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 (bite: flipping it makes these fail) --
    [Theory]
    [InlineData(FunnelPath)]
    [InlineData(KpisPath)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ----
    [Fact]
    public async Task FunnelRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(FunnelPath);

        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
