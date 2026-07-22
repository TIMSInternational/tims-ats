using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 8 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c>
/// against the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the nine
/// succession READ endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService
/// <c>succession:read</c> grant + the per-endpoint scope mechanic. Proves ALL THREE mechanics end-to-end:
///
///   scopeWhereFor (row filter): team-scope listCriticalRoles drops the out-of-scope role (Beta);
///   assertScoped('criticalRole') IDOR: team-scope by-id on Beta → 404, on Alpha → 200 (never 403);
///   requireOrgScope (F3): team-scope → 403 on the five org-rollup reads; org/company → 200/pass;
///   §21 comp-gate: company-scope (no compensation:read) → 403 on comp-gap; org-scope → 200 + gapPercent 13;
///   auth matrix: no grant → 403; no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("SuccessionRead")]
public sealed class SuccessionReadEndpointAuthTests(SuccessionReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "succession-test-key" };

    private readonly SuccessionReadFixture _fixture = fixture;

    private const string CriticalRoles = "/succession/critical-roles";
    private const string FlightRisk = "/succession/flight-risk";
    private const string CompetencyCoverage = "/succession/competency-coverage";
    private const string RolesWithout = "/succession/roles-without-successor";
    private const string CompGap = "/succession/comp-gap-alerts";
    private const string DashboardKpis = "/succession/dashboard-kpis";

    private static string Role(Guid id) => $"/succession/critical-roles/{id}";
    private static string Suggested(Guid id) => $"/succession/critical-roles/{id}/suggested-successors";
    private static string SimulateExit(Guid id) => $"/succession/critical-roles/{id}/simulate-exit";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:SuccessionReadEnabled", "true");
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

    // ---- listCriticalRoles: org sees all three roles (raw shape); team-scope drops the out-of-scope role ----
    [Fact]
    public async Task OrgScope_ListCriticalRoles_Is200_AllRoles_RawShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CriticalRoles, Mint(SuccessionReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Alpha", body);
        Assert.Contains("Beta", body);
        Assert.Contains("Gamma", body);
        Assert.DoesNotContain("schemaVersion", body);
    }

    [Fact]
    public async Task TeamScope_ListCriticalRoles_DropsOutOfScopeRole()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CriticalRoles, Mint(SuccessionReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Alpha", body);          // holder M1 in team scope
        Assert.Contains("Gamma", body);          // holder M2 in team scope
        Assert.DoesNotContain("Beta", body);     // holder OrgReader → scopeWhereFor('criticalRole') drops it
    }

    // ---- by-id IDOR probe (assertScoped('criticalRole')): 404 out-of-scope, 200 in-scope, 200 for org ----
    [Fact]
    public async Task TeamScope_OutOfScopeRole_Is404_IdorProbe()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Role(SuccessionReadFixture.CriticalRole2), Mint(SuccessionReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task TeamScope_InScopeRole_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Role(SuccessionReadFixture.CriticalRole1), Mint(SuccessionReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_OutOfTeamRole_Is200()
    {
        // Organization scope reaches ANY in-org role (Beta included) — proves the 404 above is scope, not RLS.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Role(SuccessionReadFixture.CriticalRole2), Mint(SuccessionReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("suggested-successors")]
    [InlineData("simulate-exit")]
    public async Task TeamScope_OutOfScope_ByIdReads_Are404(string leaf)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, $"/succession/critical-roles/{SuccessionReadFixture.CriticalRole2}/{leaf}", Mint(SuccessionReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- org-rollup gate (F3): team-scope → 403 on ALL five analytics reads; org/company → pass ----
    [Theory]
    [InlineData(FlightRisk)]
    [InlineData(CompetencyCoverage)]
    [InlineData(RolesWithout)]
    [InlineData(CompGap)]
    [InlineData(DashboardKpis)]
    public async Task TeamScope_OrgRollupReads_Are403_OrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(SuccessionReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_FlightRisk_Is200_HighRiskOnly()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, FlightRisk, Mint(SuccessionReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Alpha", body);          // 0.9 >= 0.7
        Assert.DoesNotContain("Beta", body);     // 0.2 < 0.7
        Assert.Contains("_count", body);          // Prisma aggregate key preserved
    }

    [Fact]
    public async Task CompanyScope_DashboardKpis_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, DashboardKpis, Mint(SuccessionReadFixture.CompanyReaderSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- §21 comp-gap secondary gate: company-scope (no compensation:read) → 403; org-scope → 200 + gap ----
    [Fact]
    public async Task CompanyScope_CompGap_Is403_MissingCompensationGrant()
    {
        // company-scope PASSES the org-gate, so this 403 is the SECONDARY compensation:read gate, not F3.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompGap, Mint(SuccessionReadFixture.CompanyReaderSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_CompGap_Is200_WithGapPercent_AndAudits()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompGap, Mint(SuccessionReadFixture.OrgReaderSub));

        // A 200 here proves the fail-closed data_access_logs audit of the EXPOSED comp row succeeded (else 500).
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"gapPercent\":13", body); // half-up round(12.5) = 13 (userA)
        // Org compensation scope → BOTH alerts (userA gap 13 + userB gap 20) — no over-restriction.
        Assert.Contains("\"gapPercent\":20", body);
        Assert.Contains(SuccessionReadFixture.M4Id.ToString(), body);
    }

    // ---- Codex hardening BITE (end-to-end): company-succession + TEAM-compensation caller ----
    // CompLead PASSES the org-gate (succession@company) but its compensation:read is TEAM-scoped, and it
    // leads T-A whose only member is M1. The endpoint resolves that comp scope from the compensation grant
    // (compDecision.Scope → anchor loader → ScopeWhereFor) and applies it as the employee_compensations ROW
    // filter, so it returns userA's (M1) comp-gap but NOT userB's (M4). Neutralize the endpoint's compScope
    // wiring (or the repo row filter) → M4 leaks back in → this test goes RED.
    [Fact]
    public async Task NarrowCompScope_CompGap_Is200_OnlyUserA_DropsUserB()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompGap, Mint(SuccessionReadFixture.CompLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"gapPercent\":13", body);                       // userA (M1) survives the team scope
        Assert.Contains(SuccessionReadFixture.M1Id.ToString(), body);
        Assert.DoesNotContain("\"gapPercent\":20", body);                 // userB (M4) dropped by the row scope
        Assert.DoesNotContain(SuccessionReadFixture.M4Id.ToString(), body);
    }

    // ---- suggested / simulate happy paths ----
    [Fact]
    public async Task OrgScope_Suggested_Is200_WithStarCandidate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Suggested(SuccessionReadFixture.CriticalRole1), Mint(SuccessionReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(SuccessionReadFixture.M3Id.ToString(), body);   // M3 = star, not already a successor
        Assert.Contains("ready_now", body);                             // star → ready_now
    }

    [Fact]
    public async Task OrgScope_SimulateExit_Is200_LowRisk()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, SimulateExit(SuccessionReadFixture.CriticalRole1), Mint(SuccessionReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"riskLevel\":\"low\"", body); // S1 is ready_now
    }

    // ---- 403: resolvable staff whose roles LACK succession:read ----
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CriticalRoles, Mint(SuccessionReadFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token / tampered JWT / valid-signature-but-sub-not-staff ----
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, CriticalRoles, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CriticalRoles, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- input validation AFTER auth: bad threshold → 400 (authorized); unauth bad input → 401 ----
    [Fact]
    public async Task OrgScope_FlightRisk_BadThreshold_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{FlightRisk}?threshold=2", Mint(SuccessionReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_BadThreshold_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync($"{FlightRisk}?threshold=2");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- Finding 4: listCriticalRoles input bounds (Zod parity: search ≤ 200, criticality ≤ 100) → 400 ----
    [Fact]
    public async Task OrgScope_ListCriticalRoles_OverLengthSearch_Is400()
    {
        // search > 200 chars → ParseFilters returns null → 400 (validated AFTER auth). Remove the length
        // guard in ParseFilters → this becomes a 200 → RED.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var overLong = new string('a', 201);
        var response = await Get(client, $"{CriticalRoles}?search={overLong}", Mint(SuccessionReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_ListCriticalRoles_OverLengthCriticality_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var overLong = new string('c', 101);
        var response = await Get(client, $"{CriticalRoles}?criticality={overLong}", Mint(SuccessionReadFixture.OrgReaderSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 (ALL routes) ----
    [Theory]
    [InlineData("/succession/critical-roles")]
    [InlineData("/succession/critical-roles/5c000000-0000-0000-0000-000000000001")]
    [InlineData("/succession/critical-roles/5c000000-0000-0000-0000-000000000001/suggested-successors")]
    [InlineData("/succession/critical-roles/5c000000-0000-0000-0000-000000000001/simulate-exit")]
    [InlineData("/succession/flight-risk")]
    [InlineData("/succession/competency-coverage")]
    [InlineData("/succession/roles-without-successor")]
    [InlineData("/succession/comp-gap-alerts")]
    [InlineData("/succession/dashboard-kpis")]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ----
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
