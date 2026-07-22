using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 7 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against
/// the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the five evaluation360 READ
/// endpoints, exercising the TWO auth patterns:
///
///   STAFF (/evaluation360/cycles, /cycles/{id}/progress): evaluation360:read + org-gate — organization/company
///   → 200; TEAM-scope → 403 (Codex F3); resolvable staff WITHOUT the grant → 403; no/tampered/non-staff JWT → 401.
///   SELF-SERVICE (/my/rater-tasks, /my/reports/{id}, /my/report-cycles): identity only — a NO-GRANT staff user
///   → 200 (protectedProcedure), hard-filtered on the caller (A sees only A's; an org-admin sees only their own
///   empty set); myReport gated to published + subject (else SAME 404); JWT → 401. Flag OFF (default) → 404.
/// </summary>
[Collection("Evaluation360Read")]
public sealed class Evaluation360ReadEndpointAuthTests(Evaluation360ReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private const string CyclesPath = "/evaluation360/cycles";
    private const string RaterTasksPath = "/evaluation360/my/rater-tasks";
    private const string ReportCyclesPath = "/evaluation360/my/report-cycles";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "evaluation360-test-key" };

    private readonly Evaluation360ReadFixture _fixture = fixture;

    private static string Progress(Guid cycleId) => $"/evaluation360/cycles/{cycleId}/progress";
    private static string Report(Guid cycleId) => $"/evaluation360/my/reports/{cycleId}";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:Evaluation360ReadEnabled", "true");
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

    // ======================= STAFF endpoints (evaluation360:read + org-gate) =======================

    [Fact]
    public async Task OrgScopeStaff_ListCycles_Is200_RawShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, CyclesPath, Mint(Evaluation360ReadFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Published Cycle A", body);
        Assert.DoesNotContain("schemaVersion", body); // INTERNAL raw shape
        Assert.DoesNotContain("OrgB Published", body); // RLS-isolated
    }

    [Fact]
    public async Task CompanyScopeStaff_ListCycles_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CyclesPath, Mint(Evaluation360ReadFixture.CompanySub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("cycles")]
    [InlineData("progress")]
    public async Task NarrowScopeStaff_Is403_OrgGate(string which)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var path = which == "cycles" ? CyclesPath : Progress(Evaluation360ReadFixture.OpenCycle);
        var response = await Get(client, path, Mint(Evaluation360ReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode); // leader@team → org-gate fails closed (F3)
    }

    [Fact]
    public async Task NoGrantStaff_OnStaffEndpoint_Is403()
    {
        // RaterA holds only the employee role (no evaluation360 grant) → the STAFF endpoint rejects (403)…
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CyclesPath, Mint(Evaluation360ReadFixture.RaterASub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScopeStaff_Progress_Is200_FourRelationships()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Progress(Evaluation360ReadFixture.OpenCycle), Mint(Evaluation360ReadFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"relationship\":\"direct_report\"", body); // all four always present
        Assert.Contains("\"total\":2", body); // the two pending peers
    }

    [Fact]
    public async Task OrgScopeStaff_Progress_UnknownCycle_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Progress(Guid.NewGuid()), Mint(Evaluation360ReadFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ======================= SELF-SERVICE endpoints (identity only) =======================

    [Fact]
    public async Task NoGrantStaff_OnSelfServiceTasks_Is200_AndAnchoredToCaller()
    {
        // …the SAME no-grant RaterA gets 200 on the SELF-SERVICE endpoint (authorization is IDENTITY, not a grant).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, RaterTasksPath, Mint(Evaluation360ReadFixture.RaterASub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Sam", body);            // A rates Subject1 (Sam)
        Assert.DoesNotContain("Sue", body);      // NEVER RaterB's task (Subject2 = Sue) — the rater hard-filter
        Assert.Contains("leadership", body);     // the fixed competency set is attached
    }

    [Fact]
    public async Task OrgAdmin_SelfServiceTasks_Is200_ButEmpty_NotEveryonesTasks()
    {
        // The org-admin (organization scope) is a rater of nothing. A scope-based query would return every task
        // in the org; identity anchoring returns only the caller's own → empty array. Proves match-all NOT used.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, RaterTasksPath, Mint(Evaluation360ReadFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("[]", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ReportCycles_RaterA_returnsOnlyAsCycle_notRaterBs()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, ReportCyclesPath, Mint(Evaluation360ReadFixture.RaterASub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Published Cycle A", body);
        Assert.DoesNotContain("Published Cycle B", body); // B's subject-cycle never leaks to A (subject filter)
    }

    [Fact]
    public async Task ReportCycles_RaterB_returnsOnlyBsCycle()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, ReportCyclesPath, Mint(Evaluation360ReadFixture.RaterBSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Published Cycle B", body);
        Assert.DoesNotContain("Published Cycle A", body);
    }

    // ---- myReport: min-3 anonymity + published/subject gates over HTTP -------------------------------
    [Fact]
    public async Task MyReport_RaterA_PublishedCycleA_Is200_min3ShownAndOmitted()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Report(Evaluation360ReadFixture.PublishedCycleA), Mint(Evaluation360ReadFixture.RaterASub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("schemaVersion", body);
        Assert.Contains("\"relationship\":\"peer\"", body);       // 3 peers → shown
        Assert.Contains("\"raterCount\":3", body);
        Assert.DoesNotContain("direct_report", body);              // 2 direct_reports → OMITTED (min-3)
        Assert.DoesNotContain("peer a", body);                     // peer comments NEVER surfaced
    }

    [Fact]
    public async Task MyReport_RaterA_NonSubjectCycleB_Is404_SubjectGate()
    {
        // RaterA is NOT a subject of Cycle B → the subject gate fails → NOT_FOUND (same message as not-published).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Report(Evaluation360ReadFixture.PublishedCycleB), Mint(Evaluation360ReadFixture.RaterASub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task MyReport_RaterA_ClosedCycle_Is404_PublishedOnlyGate()
    {
        // RaterA IS a subject of the closed cycle, but it is NOT published → NOT_FOUND (published-only gate).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Report(Evaluation360ReadFixture.ClosedCycle), Mint(Evaluation360ReadFixture.RaterASub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ======================= 401: no token / tampered / valid-but-not-staff =======================
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task StaffEndpoint_RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, CyclesPath, token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task SelfServiceEndpoint_RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, RaterTasksPath, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_SelfService_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, RaterTasksPath, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ======================= dark-by-default: flag OFF → 404 on ALL 5 routes =======================
    [Theory]
    [InlineData("/evaluation360/cycles")]
    [InlineData("/evaluation360/cycles/00000000-0000-0000-0000-000000000001/progress")]
    [InlineData("/evaluation360/my/rater-tasks")]
    [InlineData("/evaluation360/my/reports/00000000-0000-0000-0000-000000000001")]
    [InlineData("/evaluation360/my/report-cycles")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ----
    [Fact]
    public async Task CyclesRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(CyclesPath);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
