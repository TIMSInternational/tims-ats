using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Engagement;

/// <summary>
/// Phase-5 Slice 11 endpoint matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against the
/// fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the engagement READ endpoints
/// through the Supabase JWT scheme + PrincipalResolver + PermissionService <c>engagement:read</c> grant + the
/// per-endpoint mechanic. Proves the regression corpus end-to-end:
///
///   min-5 floor: getSurveyResults on the 3-response survey → suppressed + totalResponses null;
///   cross-endpoint DIFFERENCING oracle: a 1..4 per-survey count nulls getDashboardKpis.totalResponses;
///   present-key cardinality: getResultsByArea with a sub-floor area → EMPTY results + suppressed;
///   OWN-scoped reads (myPendingSurveys/getSurveyForResponse) do NOT org-gate (team-scope caller → 200, not 403);
///   scopeWhereFor row-drop: team-scope listActionPlans/listLeaderCommitments drop the out-of-team row;
///   requireOrgScope (F3): team-scope → 403 on the org-rollup reads; org/company → 200;
///   cross-org RLS isolation: OrgA reader never sees OrgB rows;
///   input bounds: listSurveys limit&gt;100 / page&lt;1 → 400 (AFTER auth);
///   auth matrix: no grant → 403; no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("EngagementRead")]
public sealed class EngagementReadEndpointTests(EngagementReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "engagement-test-key" };

    private readonly EngagementReadFixture _fixture = fixture;

    private const string Surveys = "/engagement/surveys";
    private const string PendingSurveys = "/engagement/my/pending-surveys";
    private const string Enps = "/engagement/enps";
    private const string ClimateHeatmap = "/engagement/climate-heatmap";
    private const string Alerts = "/engagement/alerts";
    private const string ActionPlans = "/engagement/action-plans";
    private const string LeaderCommitments = "/engagement/leader-commitments";
    private const string DashboardKpis = "/engagement/dashboard-kpis";
    private const string RotationRisk = "/engagement/rotation-risk";

    private static string Results(Guid id) => $"/engagement/surveys/{id}/results";
    private static string ResultsByArea(Guid id) => $"/engagement/surveys/{id}/results-by-area?groupBy=company";
    private static string Take(Guid id) => $"/engagement/surveys/{id}/take";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:EngagementReadEnabled", "true");
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

    // ── min-5: getSurveyResults suppresses the whole survey below the floor; passes above ──
    [Fact]
    public async Task GetSurveyResults_SubFloorSurvey_Is200_Suppressed_TotalNulled()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // S2 has 3 responses (1..4) → the whole survey is suppressed; totalResponses nulled (no raw 3 leaked).
        var response = await Get(client, Results(EngagementReadFixture.S2), Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"suppressed\":true", body);
        Assert.Contains("\"totalResponses\":null", body);
        Assert.DoesNotContain("\"totalResponses\":3", body); // never leak the raw sub-floor count
        Assert.Contains("\"questionSummaries\":[]", body);
    }

    [Fact]
    public async Task GetSurveyResults_AboveFloor_Is200_NotSuppressed_WithSummaries()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Results(EngagementReadFixture.S1), Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"suppressed\":false", body);
        Assert.Contains("\"totalResponses\":6", body);
        Assert.Contains("\"average\":4", body); // the scale question's avg (all answered 4)
        Assert.DoesNotContain("schemaVersion", body);
    }

    // ── cross-endpoint DIFFERENCING oracle: a 1..4 per-survey count nulls the dashboard org total ──
    [Fact]
    public async Task GetDashboardKpis_SubFloorSurvey_NullsOrgTotal_DifferencingGuard()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // S2 has a 1..4 response count → totalResponses nulled even though the org total (15) is ≥5, so a caller
        // cannot recover S2's count by subtracting the visible surveys' totals.
        var response = await Get(client, DashboardKpis, Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"totalResponsesSuppressed\":true", body);
        Assert.Contains("\"totalResponses\":null", body);
        Assert.DoesNotContain("\"totalResponses\":15", body);
        Assert.Contains("\"actionPlansOpen\":2", body);
    }

    // ── present-key cardinality: a sub-floor area → EMPTY results (no per-area keys) + suppressed ──
    [Fact]
    public async Task GetResultsByArea_SubFloorArea_Is200_EmptyResults_Suppressed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // S1 area split company A=4 / company B=2 → area B sub-floor → all-or-nothing empty results.
        var response = await Get(client, ResultsByArea(EngagementReadFixture.S1), Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"suppressed\":true", body);
        Assert.Contains("\"results\":[]", body);
        Assert.DoesNotContain(EngagementReadFixture.CompanyA.ToString(), body); // no per-area key leaks
    }

    // ── OWN-scoped reads do NOT org-gate: a team-scope caller reads them (200, not 403) ──
    [Fact]
    public async Task TeamScope_MyPendingSurveys_Is200_NotOrgGated()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // TeamLead is team-scope (would 403 on the org-rollup reads) but the OWN self-service pending list must NOT
        // org-gate. S1 is active and TeamLead has not answered it → it surfaces. Neutralize (add the org gate) → 403 → RED.
        var response = await Get(client, PendingSurveys, Mint(EngagementReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(EngagementReadFixture.S1.ToString(), body); // active, unanswered by TeamLead
        Assert.DoesNotContain(EngagementReadFixture.S2.ToString(), body); // closed → not pending
    }

    [Fact]
    public async Task TeamScope_GetSurveyForResponse_ActiveSurvey_Is200_NotOrgGated()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Take(EngagementReadFixture.S1), Mint(EngagementReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task GetSurveyForResponse_ClosedSurvey_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // S2 is closed → out of the renderable active window → 404 (never leak existence).
        var response = await Get(client, Take(EngagementReadFixture.S2), Mint(EngagementReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── scopeWhereFor row-drop: team-scope drops the out-of-team responsible/leader row ──
    [Fact]
    public async Task TeamScope_ListActionPlans_DropsOutOfTeamRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, ActionPlans, Mint(EngagementReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(EngagementReadFixture.Ap1.ToString(), body);   // responsible M1 (in team)
        Assert.Contains(EngagementReadFixture.Ap3.ToString(), body);   // responsible M2 (in team)
        Assert.DoesNotContain(EngagementReadFixture.Ap2.ToString(), body); // responsible M4 (OUT) → dropped
    }

    [Fact]
    public async Task OrgScope_ListActionPlans_SeesAll()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, ActionPlans, Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(EngagementReadFixture.Ap2.ToString(), body); // org scope → MatchAll, sees out-of-team too
    }

    [Fact]
    public async Task TeamScope_ListLeaderCommitments_DropsOutOfTeamRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, LeaderCommitments, Mint(EngagementReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(EngagementReadFixture.Lc1.ToString(), body);   // leader M1 (in team)
        Assert.DoesNotContain(EngagementReadFixture.Lc2.ToString(), body); // leader M4 (OUT) → dropped
    }

    // ── requireOrgScope (F3): team-scope → 403 on the org-rollup reads; company/org → 200 ──
    [Theory]
    [InlineData(Enps)]
    [InlineData(ClimateHeatmap)]
    [InlineData(Alerts)]
    [InlineData(DashboardKpis)]
    [InlineData(RotationRisk)]
    public async Task TeamScope_OrgRollupReads_Are403_OrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(EngagementReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CompanyScope_DashboardKpis_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(EngagementReadFixture.CompanyReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── cross-org RLS isolation: OrgA reader never sees OrgB rows ──
    [Fact]
    public async Task OrgScope_Alerts_DoesNotLeakOtherOrg()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Alerts, Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Clima bajo", body);       // OrgA alert
        Assert.DoesNotContain("OrgB alert", body);  // OrgB alert (RLS-isolated)
    }

    [Fact]
    public async Task OrgScope_GetSurveyResults_CrossOrgSurvey_Is500_NotFound()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        // OrgReader is OrgA; the OrgB survey is invisible under RLS → the TS plain-Error path → 500 (no existence leak).
        var response = await Get(client, Results(EngagementReadFixture.SbOrgB), Mint(EngagementReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }

    // ── input bounds (AFTER auth): listSurveys limit>100 / page<1 → 400 ──
    [Theory]
    [InlineData("/engagement/surveys?limit=101")]
    [InlineData("/engagement/surveys?page=0")]
    [InlineData("/engagement/surveys?status=bogus")]
    public async Task ListSurveys_InvalidInput_Is400_AfterAuth(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(EngagementReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ListSurveys_InvalidInput_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/engagement/surveys?limit=101");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ListSurveys_FloorsResponseCount()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Surveys, Mint(EngagementReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // S2 has response_count 3 (sub-floor) → floored to null + suppressed flag; the raw 3 is never emitted.
        Assert.Contains("\"responseCountSuppressed\":true", body);
    }

    // ── auth matrix ──
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Surveys, Mint(EngagementReadFixture.NoGrantSub));
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
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, Surveys, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Surveys, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── dark-by-default: flag OFF (default) → route NOT mapped → 404 (ALL routes) ──
    [Theory]
    [InlineData("/engagement/surveys")]
    [InlineData("/engagement/surveys/50000000-0000-0000-0000-000000000001/results")]
    [InlineData("/engagement/my/pending-surveys")]
    [InlineData("/engagement/surveys/50000000-0000-0000-0000-000000000001/take")]
    [InlineData("/engagement/enps")]
    [InlineData("/engagement/climate-heatmap")]
    [InlineData("/engagement/surveys/50000000-0000-0000-0000-000000000001/results-by-area")]
    [InlineData("/engagement/surveys/50000000-0000-0000-0000-000000000001/word-cloud")]
    [InlineData("/engagement/surveys/50000000-0000-0000-0000-000000000001/sentiment")]
    [InlineData("/engagement/alerts")]
    [InlineData("/engagement/action-plans")]
    [InlineData("/engagement/leader-commitments")]
    [InlineData("/engagement/dashboard-kpis")]
    [InlineData("/engagement/rotation-risk")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

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
