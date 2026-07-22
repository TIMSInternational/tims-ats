using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 10 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the eleven nine-box
/// READ endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService <c>ninebox:read</c>
/// grant + the per-endpoint scope mechanic. Proves every mechanic end-to-end:
///
///   scopeWhereFor (row filter): team-scope getGrid drops the out-of-team evaluation (M4);
///   assertSubjectInScope (IDOR): team-scope getEmployeeDetail on M4 → 403, on M1 → 200;
///   requireOrgScope (F3): team-scope → 403 on the three org-rollup reads; org/company → 200;
///   calibration membership: creator/member read their session; a non-member narrow caller → 403; missing → 404;
///   auth matrix: no grant → 403; no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("NineBoxRead")]
public sealed class NineBoxReadEndpointAuthTests(NineBoxReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "ninebox-test-key" };

    private readonly NineBoxReadFixture _fixture = fixture;

    private const string Grid = "/ninebox/grid?period=2026Q1";
    private const string MovementHistory = "/ninebox/movement-history";
    private const string Calibrations = "/ninebox/calibrations";
    private const string MyCalibrations = "/ninebox/my-calibrations";
    private const string BenchStrength = "/ninebox/bench-strength?period=2026Q1";
    private const string DashboardKpis = "/ninebox/dashboard-kpis?period=2026Q1";
    private const string QuadrantPlan = "/ninebox/quadrant-plan?quadrant=star";

    private static string Employee(Guid id) => $"/ninebox/employee/{id}?period=2026Q2";
    private static string AxisBreakdown(Guid id) => $"/ninebox/employee/{id}/axis-breakdown?period=2026Q2";
    private static string Calibration(Guid id) => $"/ninebox/calibrations/{id}";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:NineBoxReadEnabled", "true");
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

    // ── getGrid: org sees all four (raw shape); team-scope drops the out-of-team evaluation (M4) ──
    [Fact]
    public async Task OrgScope_Grid_Is200_AllEvaluations_RawShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Grid, Mint(NineBoxReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(NineBoxReadFixture.M1Id.ToString(), body);
        Assert.Contains(NineBoxReadFixture.M4Id.ToString(), body);
        Assert.DoesNotContain("schemaVersion", body);
        // Pin the RAW WIRE SHAPE (Codex L2: the pure-kernel goldens only cover {id,quadrant}, so a
        // DTO/date/casing/user-include regression could slip past them). Assert the camelCase eval keys, the
        // nested user object + concrete seeded values (M1 = Mia One / Engineer / a1.png), the grid wrapper, and
        // a Node .toISOString() date (…fffZ). Any casing flip, dropped field, or date-format drift breaks these.
        foreach (var key in new[]
        {
            "\"grid\"", "\"totalEvaluations\"", "\"potentialScore\"", "\"performanceScore\"", "\"quadrant\"",
            "\"confidence\"", "\"axisBreakdown\"", "\"evaluatedAt\"", "\"createdAt\"", "\"user\"", "\"firstName\"",
            "\"lastName\"", "\"avatar\"", "\"jobTitle\"",
        })
        {
            Assert.Contains(key, body);
        }

        Assert.Contains("\"Mia\"", body);       // M1 user.firstName
        Assert.Contains("\"Engineer\"", body);  // M1 user.jobTitle
        Assert.Contains("\"a1.png\"", body);    // M1 user.avatar
        Assert.Matches(@"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", body); // NodeIso evaluatedAt/createdAt
    }

    [Fact]
    public async Task TeamScope_Grid_DropsOutOfTeamEvaluation()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Grid, Mint(NineBoxReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(NineBoxReadFixture.M1Id.ToString(), body);  // in team
        Assert.Contains(NineBoxReadFixture.M3Id.ToString(), body);  // in team
        Assert.DoesNotContain(NineBoxReadFixture.M4Id.ToString(), body); // scopeWhereFor drops it
    }

    // ── assertSubjectInScope IDOR: team-scope on M4 (out of team) → 403; on M1 (in team) → 200 ──
    [Fact]
    public async Task TeamScope_EmployeeDetail_OutOfSubjectSet_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Employee(NineBoxReadFixture.M4Id), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task TeamScope_EmployeeDetail_InSubjectSet_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Employee(NineBoxReadFixture.M1Id), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task TeamScope_AxisBreakdown_OutOfSubjectSet_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, AxisBreakdown(NineBoxReadFixture.M4Id), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_AxisBreakdown_MissingPeriod_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, $"/ninebox/employee/{NineBoxReadFixture.M2Id}/axis-breakdown?period=9999Q9",
            Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── org-rollup gate (F3): team-scope → 403 on the three analytics reads; org/company → pass ──
    [Theory]
    [InlineData(Calibrations)]
    [InlineData(BenchStrength)]
    [InlineData(DashboardKpis)]
    public async Task TeamScope_OrgRollupReads_Are403_OrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyScope_DashboardKpis_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(NineBoxReadFixture.CompanyReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"activeCalibrations\":1", body);
    }

    [Fact]
    public async Task OrgScope_Calibrations_Is200_BothSessions()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Calibrations, Mint(NineBoxReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(NineBoxReadFixture.Session1.ToString(), body);
        Assert.Contains("_count", body);
    }

    // ── getCalibration hand-rolled membership gate ──
    [Fact]
    public async Task TeamScope_Calibration_CreatedByCaller_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // TeamLead CREATED CS1 → allowed even at narrow scope.
        var response = await Get(client, Calibration(NineBoxReadFixture.Session1), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task TeamScope_Calibration_NotCreatorNotMember_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // TeamLead is neither creator NOR member of CS2 (created by OrgReader) → 403.
        var response = await Get(client, Calibration(NineBoxReadFixture.Session2), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task NarrowScope_Calibration_MemberOfSession_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // MemberReader (narrow leader@team) is a MEMBER of CS2 → allowed. Neutralize the membership check → 403 → RED.
        var response = await Get(client, Calibration(NineBoxReadFixture.Session2), Mint(NineBoxReadFixture.MemberReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_Calibration_AnySession_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Calibration(NineBoxReadFixture.Session2), Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task TeamScope_Calibration_Missing_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Calibration(Guid.NewGuid()), Mint(NineBoxReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── myCalibrations: only the caller's own (created OR member) sessions surface ──
    [Fact]
    public async Task MyCalibrations_SurfacesOnlyOwnSessions()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, MyCalibrations, Mint(NineBoxReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(NineBoxReadFixture.Session1.ToString(), body);   // created by TeamLead
        Assert.DoesNotContain(NineBoxReadFixture.Session2.ToString(), body); // neither creator nor member
    }

    // ── movement history (scoped) happy path + only-on-change ──
    [Fact]
    public async Task OrgScope_MovementHistory_Is200_TwoTransitions()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, MovementHistory, Mint(NineBoxReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"totalMovements\":2", body);
    }

    // ── pure reads (simulate / quadrant-plan) ──
    [Fact]
    public async Task Simulate_Is200_WithStub()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, $"/ninebox/simulate?userId={NineBoxReadFixture.M1Id}&newPotentialScore=90&newPerformanceScore=90",
            Mint(NineBoxReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"simulatedQuadrant\":\"star\"", body);
        Assert.Contains("\"_stub\":true", body);
    }

    [Fact]
    public async Task QuadrantPlan_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, QuadrantPlan, Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Retener y Acelerar", body); // star plan title
    }

    // ── 403: resolvable staff whose roles LACK ninebox:read ──
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Grid, Mint(NineBoxReadFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── 401: no token / tampered JWT / valid-signature-but-sub-not-staff ──
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, Grid, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Grid, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── input validation AFTER auth: grid missing period → 400 (authorized); unauth → 401 ──
    [Fact]
    public async Task OrgScope_Grid_MissingPeriod_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, "/ninebox/grid", Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // Input-parity edges (Codex L3). Empty period → 400 (documented improvement: an empty period is nonsensical;
    // TS z.string().max(100) laxly accepts it, we reject). A PRESENT-but-empty optional uuid (?teamId=) → 400,
    // matching Zod .uuid() (the earlier "empty = absent" reading accepted input TS rejects). Both bite the fix.
    [Fact]
    public async Task OrgScope_Grid_EmptyPeriod_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, "/ninebox/grid?period=", Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_Grid_PresentEmptyTeamId_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, "/ninebox/grid?period=2026Q1&teamId=", Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Simulate_OutOfRangeScore_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, $"/ninebox/simulate?userId={NineBoxReadFixture.M1Id}&newPotentialScore=200&newPerformanceScore=90",
            Mint(NineBoxReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_MissingPeriod_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/ninebox/grid");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── dark-by-default: flag OFF (default) → route NOT mapped → 404 (ALL routes) ──
    [Theory]
    [InlineData("/ninebox/grid")]
    [InlineData("/ninebox/employee/d0000000-0000-0000-0000-000000000001")]
    [InlineData("/ninebox/employee/d0000000-0000-0000-0000-000000000001/axis-breakdown")]
    [InlineData("/ninebox/movement-history")]
    [InlineData("/ninebox/simulate")]
    [InlineData("/ninebox/calibrations")]
    [InlineData("/ninebox/calibrations/ca000000-0000-0000-0000-000000000001")]
    [InlineData("/ninebox/my-calibrations")]
    [InlineData("/ninebox/quadrant-plan")]
    [InlineData("/ninebox/bench-strength")]
    [InlineData("/ninebox/dashboard-kpis")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ──
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
