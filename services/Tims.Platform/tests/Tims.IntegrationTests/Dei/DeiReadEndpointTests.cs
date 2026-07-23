using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Dei;

/// <summary>
/// Phase-5 Slice 11b endpoint matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against the
/// fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the DEI READ endpoints through the
/// Supabase JWT scheme + PrincipalResolver + PermissionService <c>dei:read</c> grant. Proves the corpus end-to-end:
///
///   enum materialization: gender-representation returns typed labels (female/male/non_binary), not ints;
///   min-5 + present-key cardinality: OrgB gender-representation → EMPTY groups + suppressed (female=3 sub-floor);
///   cross-endpoint DIFFERENCING: OrgB dashboard nulls coverage/parity/womenPct but KEEPS totalNationalities (CO
///     visible) — a visible male=8 never recovers the hidden female;
///   GRANT-ONLY (no org-gate): a TEAM-scope dei:read caller → 200 (NOT 403 — unlike the engagement org-rollups);
///   getInclusionIndex multi-tier suppression; getPromotionEquity floored count; getHiringFunnel NO suppression;
///   input bounds (year/surveyId/dateFrom) → 400 AFTER auth; cross-org RLS isolation;
///   auth matrix: no grant → 403; no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("DeiRead")]
public sealed class DeiReadEndpointTests(DeiReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "dei-test-key" };

    private readonly DeiReadFixture _fixture = fixture;

    private const string DashboardKpis = "/dei/dashboard-kpis";
    private const string GenderRepresentation = "/dei/gender-representation";
    private const string AgeDistribution = "/dei/age-distribution";
    private const string NationalityDiversity = "/dei/nationality-diversity";
    private const string EthnicityDistribution = "/dei/ethnicity-distribution";
    private const string DisabilityDistribution = "/dei/disability-distribution";
    private const string LeadershipDiversity = "/dei/leadership-diversity";
    private const string HiringFunnel = "/dei/hiring-funnel";
    private const string PromotionEquity = "/dei/promotion-equity";
    private const string InclusionIndex = "/dei/inclusion-index";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:DeiReadEnabled", "true");
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private static async Task<string> Body(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync();
    }

    // ── enum materialization + clear dashboard (OrgA, hr_admin@organization) ─────────
    [Fact]
    public async Task DashboardKpis_OrgA_Is200_AllMetricsPresent_NoSchemaVersion()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, DashboardKpis, Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"totalEmployees\":18", body);
        Assert.Contains("\"demographicsCoverage\":83.3", body);
        Assert.Contains("\"genderParityIndex\":1", body);
        Assert.Contains("\"womenPct\":33.3", body);
        Assert.Contains("\"leadershipWomenPct\":50", body);
        Assert.Contains("\"totalNationalities\":3", body);
        Assert.DoesNotContain("schemaVersion", body);
    }

    [Fact]
    public async Task GenderRepresentation_OrgA_Is200_TypedLabels_NotSuppressed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, GenderRepresentation, Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"gender\":\"female\"", body);       // enum label, not an int
        Assert.Contains("\"gender\":\"non_binary\"", body);
        Assert.Contains("\"count\":5", body);
        Assert.Contains("\"percentage\":33.3", body);
        Assert.Contains("\"suppressed\":false", body);
    }

    [Fact]
    public async Task AgeEthnicityDisability_OrgA_Is200_NotSuppressed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Contains("\"range\":\"25-34\"", await Body(await Get(client, AgeDistribution, Mint(DeiReadFixture.OrgReaderSub))));
        Assert.Contains("\"ethnicity\":\"mestizo\"", await Body(await Get(client, EthnicityDistribution, Mint(DeiReadFixture.OrgReaderSub))));
        Assert.Contains("\"status\":\"has_disability\"", await Body(await Get(client, DisabilityDistribution, Mint(DeiReadFixture.OrgReaderSub))));
    }

    [Fact]
    public async Task LeadershipDiversity_OrgA_Is200_5F5M()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, LeadershipDiversity, Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"totalLeaders\":10", body);
        Assert.Contains("\"gender\":\"female\"", body);
        Assert.Contains("\"percentage\":50", body);
    }

    // ── min-5 present-key cardinality + cross-endpoint differencing (OrgB) ───────────
    [Fact]
    public async Task GenderRepresentation_OrgB_SubFloorFemale_EmptyGroups_Suppressed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, GenderRepresentation, Mint(DeiReadFixture.OrgBReaderSub)));

        Assert.Contains("\"suppressed\":true", body);
        Assert.Contains("\"groups\":[]", body);       // no present keys — nothing recoverable
        Assert.DoesNotContain("\"count\":8", body);   // the visible male=8 never leaks
        Assert.DoesNotContain("\"count\":3", body);
    }

    [Fact]
    public async Task DashboardKpis_OrgB_DifferencingGuard_NullsGenderMetrics_KeepsNationality()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, DashboardKpis, Mint(DeiReadFixture.OrgBReaderSub)));

        Assert.Contains("\"demographicsCoverage\":null", body); // any demographic sub-floor nulls coverage
        Assert.Contains("\"genderParityIndex\":null", body);
        Assert.Contains("\"womenPct\":null", body);
        Assert.Contains("\"totalNationalities\":1", body);      // nationality (CO×11) stays visible — selective null
        Assert.Contains("\"totalEmployees\":12", body);
    }

    [Fact]
    public async Task NationalityDiversity_OrgB_Is200_SingleGroupVisible()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, NationalityDiversity, Mint(DeiReadFixture.OrgBReaderSub)));

        Assert.Contains("\"totalNationalities\":1", body);
        Assert.Contains("\"nationality\":\"CO\"", body);
        Assert.Contains("\"count\":11", body);
        Assert.Contains("\"percentage\":100", body);
        Assert.Contains("\"suppressed\":false", body);
    }

    // ── GRANT-ONLY: a team-scope dei:read caller passes (no org-gate, unlike engagement) ─────────────
    [Fact]
    public async Task TeamScopeCaller_Is200_GrantOnly_NoOrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(DeiReadFixture.TeamReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); // team scope → 200, NOT 403
    }

    // ── getInclusionIndex multi-tier suppression ────────────────────────────────────
    [Fact]
    public async Task InclusionIndex_OrgA_Is200_ClearIndex()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, InclusionIndex, Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"index\":4", body);
        Assert.Contains("\"totalResponses\":6", body);
        Assert.Contains("\"questionsEvaluated\":2", body);
        Assert.Contains("\"suppressed\":false", body);
    }

    [Fact]
    public async Task InclusionIndex_OrgB_SubFloorSurvey_Suppressed_Nulled()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, InclusionIndex, Mint(DeiReadFixture.OrgBReaderSub)));

        Assert.Contains("\"index\":null", body);
        Assert.Contains("\"totalResponses\":null", body);
        Assert.Contains("\"suppressed\":true", body);
        Assert.DoesNotContain("questionsEvaluated", body);
    }

    // ── getPromotionEquity floored count ────────────────────────────────────────────
    [Fact]
    public async Task PromotionEquity_2026_Is200_Count6_TypeFiltered()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, $"{PromotionEquity}?year=2026", Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"year\":2026", body);
        Assert.Contains("\"totalPromotions\":6", body); // the 2 'merit' rows excluded
        Assert.Contains("\"suppressed\":false", body);
    }

    [Fact]
    public async Task PromotionEquity_2025_SubFloor_Floored()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var body = await Body(await Get(client, $"{PromotionEquity}?year=2025", Mint(DeiReadFixture.OrgReaderSub)));

        Assert.Contains("\"totalPromotions\":null", body); // 3 → floored
        Assert.Contains("\"suppressed\":true", body);
    }

    // ── getHiringFunnel: NO suppression, real window ────────────────────────────────
    [Fact]
    public async Task HiringFunnel_OrgA_UnfilteredAndWindowed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Contains("\"total\":7", await Body(await Get(client, HiringFunnel, Mint(DeiReadFixture.OrgReaderSub))));
        Assert.Contains("\"total\":4", await Body(await Get(
            client, $"{HiringFunnel}?dateFrom=2026-05-01T00:00:00Z", Mint(DeiReadFixture.OrgReaderSub))));
    }

    // ── input bounds (AFTER auth) ───────────────────────────────────────────────────
    [Theory]
    [InlineData("/dei/promotion-equity?year=abc")]
    [InlineData("/dei/promotion-equity?year=0")]      // Codex L2: out of DateTimeOffset range → 400, not a 500
    [InlineData("/dei/promotion-equity?year=10000")]  // year+1 overflows the ctor → 400, not a 500
    [InlineData("/dei/inclusion-index?surveyId=not-a-uuid")]
    [InlineData("/dei/hiring-funnel?dateFrom=not-a-date")]
    public async Task InvalidInput_Is400_AfterAuth(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(DeiReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task InvalidInput_WithoutAuth_Is401_NotValidated()
    {
        // auth-before-parse: a bad param on a no-token request is 401, never 400.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{PromotionEquity}?year=abc", null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── auth matrix ─────────────────────────────────────────────────────────────────
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(DeiReadFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, DashboardKpis, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── dark-by-default: flag OFF → 404 on ALL 10 routes (with a VALID staff slug) ───
    [Theory]
    [InlineData("/dei/dashboard-kpis")]
    [InlineData("/dei/gender-representation")]
    [InlineData("/dei/age-distribution")]
    [InlineData("/dei/nationality-diversity")]
    [InlineData("/dei/ethnicity-distribution")]
    [InlineData("/dei/disability-distribution")]
    [InlineData("/dei/leadership-diversity")]
    [InlineData("/dei/hiring-funnel")]
    [InlineData("/dei/promotion-equity")]
    [InlineData("/dei/inclusion-index")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, path, Mint(DeiReadFixture.OrgReaderSub))).StatusCode);
    }

    [Fact]
    public async Task Route_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(DashboardKpis);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
