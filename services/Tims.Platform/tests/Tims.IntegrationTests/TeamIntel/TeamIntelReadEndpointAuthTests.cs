using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.TeamIntel;

/// <summary>
/// Phase-5 Slice 6 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the seven
/// team-intel READ endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService
/// <c>team_intel:read</c> grant + the per-endpoint scope mechanic:
///
///   organization/company-scope → 200; team-scope → 200 on its OWN team's by-id reads but 404 on an
///   OUT-OF-SCOPE team (the assertScoped('team') IDOR bite) and 403 on dashboard-kpis (the org-gate, F3);
///   compareTeams drops out-of-scope teamIds (team-scope sees only its team); resolvable staff WITHOUT the
///   grant → 403; no / tampered / non-staff JWT → 401; authorized but invalid teamIds → 400 (after auth);
///   getBalanceAlerts/getRecommendedHires → 501 AFTER the probe (404 out-of-scope); flag OFF (default) → 404.
/// </summary>
[Collection("TeamIntelRead")]
public sealed class TeamIntelReadEndpointAuthTests(TeamIntelReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "team-intel-test-key" };

    private readonly TeamIntelReadFixture _fixture = fixture;

    private static string Profile(Guid teamId) => $"/team-intel/teams/{teamId}/profile";
    private static string Members(Guid teamId) => $"/team-intel/teams/{teamId}/members";
    private static string BalanceScore(Guid teamId) => $"/team-intel/teams/{teamId}/balance-score";
    private static string BalanceAlerts(Guid teamId) => $"/team-intel/teams/{teamId}/balance-alerts";
    private static string RecommendedHires(Guid teamId) => $"/team-intel/teams/{teamId}/recommended-hires";
    private const string DashboardKpis = "/team-intel/dashboard-kpis";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:TeamIntelReadEnabled", "true");
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

    // Flag left at its DEFAULT (false). Placeholder DB (lazy DbContext, never opened for a 404).
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

    // ---- 200: organization-scope reads the raw profile (leader email + _count, no schemaVersion) ---------
    [Fact]
    public async Task OrgScope_Profile_Is200_RawShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, Profile(TeamIntelReadFixture.Team1), Mint(TeamIntelReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("lead@tims.test", body);       // leader select incl. email
        Assert.Contains("Unit One", body);              // businessUnit include
        Assert.Contains("_count", body);                // Prisma aggregate key preserved
        Assert.DoesNotContain("schemaVersion", body);   // INTERNAL raw shape
    }

    [Fact]
    public async Task CompanyScope_DashboardKpis_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(TeamIntelReadFixture.CompanyReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- team-scope by-id: 200 in-scope, 404 out-of-scope (the assertScoped('team') IDOR bite) -----------
    [Fact]
    public async Task TeamScope_OwnTeamProfile_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profile(TeamIntelReadFixture.Team1), Mint(TeamIntelReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("profile")]
    [InlineData("members")]
    [InlineData("balance-score")]
    [InlineData("balance-alerts")]
    [InlineData("recommended-hires")]
    public async Task TeamScope_OutOfScopeTeam_Is404_IdorProbe(string leaf)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // T2 is led by the org-admin, NOT the team-lead → the scope probe fails closed → NOT_FOUND (all 5
        // id-keyed endpoints, incl. the 501 stubs which probe BEFORE returning 501).
        var response = await Get(client, $"/team-intel/teams/{TeamIntelReadFixture.Team2}/{leaf}", Mint(TeamIntelReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_OutOfTeamProfile_Is200()
    {
        // Organization scope reaches ANY in-org team (T2 included) — proves the 404 above is scope, not RLS.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profile(TeamIntelReadFixture.Team2), Mint(TeamIntelReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- 403: TEAM-scope on the org-rollup dashboard-kpis → the org-gate fails closed (Codex F3) ----------
    [Fact]
    public async Task TeamScope_DashboardKpis_Is403_OrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(TeamIntelReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- balance-score: 200 with the deterministic kernel fields --------------------------------------
    [Fact]
    public async Task OrgScope_BalanceScore_Is200_WithKernelFields()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, BalanceScore(TeamIntelReadFixture.Team1), Mint(TeamIntelReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains($"\"teamId\":\"{TeamIntelReadFixture.Team1}\"", body);
        Assert.Contains("\"balanceScore\":84", body);
        Assert.Contains("\"roleDiversity\":67", body);
    }

    // ---- 501 honest stubs (AFTER the probe) for an in-scope caller ------------------------------------
    [Theory]
    [InlineData("balance-alerts")]
    [InlineData("recommended-hires")]
    public async Task OrgScope_Stubs_Are501(string leaf)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"/team-intel/teams/{TeamIntelReadFixture.Team1}/{leaf}", Mint(TeamIntelReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.NotImplemented, response.StatusCode);
    }

    // ---- compareTeams: org sees both; team-scope drops the out-of-scope teamId (scopeWhereFor) -----------
    [Fact]
    public async Task OrgScope_Compare_ReturnsBothTeams()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var path = $"/team-intel/compare?teamIds={TeamIntelReadFixture.Team1}&teamIds={TeamIntelReadFixture.Team2}";
        var response = await Get(client, path, Mint(TeamIntelReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Alpha", body); // T1
        Assert.Contains("Beta", body);  // T2
    }

    [Fact]
    public async Task TeamScope_Compare_DropsOutOfScopeTeam()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var path = $"/team-intel/compare?teamIds={TeamIntelReadFixture.Team1}&teamIds={TeamIntelReadFixture.Team2}";
        var response = await Get(client, path, Mint(TeamIntelReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Alpha", body);        // T1 (in scope)
        Assert.DoesNotContain("Beta", body);    // T2 dropped by scopeWhereFor('team')
    }

    // ---- 400: authorized but invalid teamIds (below the 2..5 bound), validated AFTER auth ---------------
    [Fact]
    public async Task OrgScope_Compare_TooFewTeamIds_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"/team-intel/compare?teamIds={TeamIntelReadFixture.Team1}", Mint(TeamIntelReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_BadTeamIds_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync($"/team-intel/compare?teamIds={TeamIntelReadFixture.Team1}");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- 403: resolvable staff whose roles LACK team_intel:read --------------------------------------
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profile(TeamIntelReadFixture.Team1), Mint(TeamIntelReadFixture.NoGrantSub));
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
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, Profile(TeamIntelReadFixture.Team1), token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profile(TeamIntelReadFixture.Team1), Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 (ALL 7 routes) -----------------
    [Theory]
    [InlineData("/team-intel/teams/00000000-0000-0000-0000-000000000001/profile")]
    [InlineData("/team-intel/teams/00000000-0000-0000-0000-000000000001/members")]
    [InlineData("/team-intel/teams/00000000-0000-0000-0000-000000000001/balance-score")]
    [InlineData("/team-intel/teams/00000000-0000-0000-0000-000000000001/balance-alerts")]
    [InlineData("/team-intel/teams/00000000-0000-0000-0000-000000000001/recommended-hires")]
    [InlineData("/team-intel/compare?teamIds=00000000-0000-0000-0000-000000000001&teamIds=00000000-0000-0000-0000-000000000002")]
    [InlineData("/team-intel/dashboard-kpis")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) -------
    [Fact]
    public async Task DashboardKpisRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(DashboardKpis);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
