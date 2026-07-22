using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 9 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against
/// the fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the seven FX-free compensation
/// READ endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService <c>compensation:read</c>
/// grant + the per-endpoint mechanic. Proves each mechanic end-to-end:
///
///   grant-only (no org-gate): team-scope reaches salary-bands / market-comparison (200);
///   requireOrgScope (F3): team/own scope → 403 on benefits-utilization + compa-ratio-distribution; org/company → 200;
///   scopeWhereFor + selectFor (§21): leader pending-adjustments drops out-of-scope ADJ2 + strips restricted fields;
///   assertSubjectInScope (IDOR): leader reads M1 (in team) → 200, reads Emp (out) → 403;
///   self-service (own-pinned): employee my-compensation → 200 own (no compaRatio); recruiter (no comp row) → null;
///   fail-closed audit: pending-adjustments 200 proves the data_access_logs write succeeded (else 500);
///   min-5: OrgB compa-ratio (3 comps) → suppressed:true empty distribution;
///   auth matrix: no grant → 403; no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("CompensationRead")]
public sealed class CompensationReadEndpointAuthTests(CompensationReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "compensation-test-key" };

    private readonly CompensationReadFixture _fixture = fixture;

    private const string SalaryBands = "/compensation/salary-bands";
    private const string MarketComparison = "/compensation/market-comparison";
    private const string BenefitsUtilization = "/compensation/benefits-utilization";
    private const string CompaRatio = "/compensation/compa-ratio-distribution";
    private const string PendingAdjustments = "/compensation/pending-adjustments";
    private const string MyCompensation = "/compensation/my-compensation";

    private static string Employee(Guid id) => $"/compensation/employee/{id}";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:CompensationReadEnabled", "true");
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

    // ── grant-only reads (NO org-gate): a team-scoped caller still reaches the catalog reads ──
    [Theory]
    [InlineData(SalaryBands)]
    [InlineData(MarketComparison)]
    public async Task TeamScope_CatalogReads_Are200_NoOrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(CompensationReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("L5", body);
        Assert.DoesNotContain("schemaVersion", body);
    }

    // ── org-rollup gate (F3): team/own scope → 403 on the two aggregate reads; org/company → 200 ──
    [Theory]
    [InlineData(BenefitsUtilization)]
    [InlineData(CompaRatio)]
    public async Task TeamScope_OrgRollupReads_Are403_OrgGate(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, path, Mint(CompensationReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OwnScope_CompaRatio_Is403_OrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompaRatio, Mint(CompensationReadFixture.EmpSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_CompaRatio_Is200_NonSuppressed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompaRatio, Mint(CompensationReadFixture.OrgHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"suppressed\":false", body);
        Assert.Contains("\"totalEmployees\":5", body);
    }

    [Fact]
    public async Task CompanyScope_BenefitsUtilization_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, BenefitsUtilization, Mint(CompensationReadFixture.CompanyRecSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── min-5 over the wire: OrgB (3 comps) → suppressed empty distribution ──
    [Fact]
    public async Task OrgBScope_CompaRatio_Is200_SuppressedEmptyDistribution()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, CompaRatio, Mint(CompensationReadFixture.OrgBHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"suppressed\":true", body);
        Assert.Contains("\"distribution\":{}", body);  // all-or-nothing empty
        Assert.Contains("\"totalEmployees\":null", body);
    }

    // ── §21 field-auth + scopeWhereFor over the wire (read #5) ──
    [Fact]
    public async Task OrgScope_PendingAdjustments_Is200_FullFields_AndAudits()
    {
        // A 200 here proves the fail-closed data_access_logs audit of every exposed row succeeded (else 500).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, PendingAdjustments, Mint(CompensationReadFixture.OrgHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("previousSalary", body); // hr entitled to the restricted fields
        Assert.Contains("strong performer", body); // reason (restricted) present
    }

    [Fact]
    public async Task TeamScope_PendingAdjustments_Is200_StatusOnly_DropsOutOfScope_NoRestricted()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, PendingAdjustments, Mint(CompensationReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"pending\"", body); // leader entitled to status
        // Field-auth bite: NO restricted salary fields for a leader (never selected-then-nulled).
        Assert.DoesNotContain("previousSalary", body);
        Assert.DoesNotContain("newSalary", body);
        Assert.DoesNotContain("strong performer", body);
        Assert.DoesNotContain("promo to L5", body); // ADJ2 (Emp) dropped by scopeWhereFor entirely
    }

    // ── subject-scope IDOR (read #6): in-team → 200, out-of-team → 403 ──
    [Fact]
    public async Task TeamScope_GetEmployeeComp_InScope_Is200_SalaryOnly()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Employee(CompensationReadFixture.M1Id), Mint(CompensationReadFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("currentSalary", body);
        // Field-auth bite: a leader never receives the finance fields.
        Assert.DoesNotContain("compaRatio", body);
        Assert.DoesNotContain("variablePay", body);
    }

    [Fact]
    public async Task TeamScope_GetEmployeeComp_OutOfSubjectSet_Is403()
    {
        // Emp is NOT in TeamLead's team scope → assertSubjectInScope → 403 (never the comp row).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Employee(CompensationReadFixture.EmpId), Mint(CompensationReadFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_GetEmployeeComp_FullFinanceFields()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Employee(CompensationReadFixture.M1Id), Mint(CompensationReadFixture.OrgHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("compaRatio", body); // hr entitled
        Assert.Contains("\"band\":{", body); // M1 has band L5
    }

    // ── self-service (read #7): own-pinned; employee sees own (no finance fields); missing → null ──
    [Fact]
    public async Task Employee_MyCompensation_Is200_OwnRow_NoFinanceFields()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, MyCompensation, Mint(CompensationReadFixture.EmpSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("currentSalary", body);
        Assert.DoesNotContain("compaRatio", body); // employee not entitled to finance fields
    }

    [Fact]
    public async Task Recruiter_MyCompensation_MissingRow_Is200_NullBody()
    {
        // CompanyRec (recruiter, company scope) has NO comp row → null body (graceful, not an error / not 403).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, MyCompensation, Mint(CompensationReadFixture.CompanyRecSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadAsStringAsync()).Trim();
        Assert.Equal("null", body);
    }

    [Fact]
    public async Task Committee_MyCompensation_UnitScope_NotInUnit_Is403()
    {
        // F1 bite (3-reviewer consensus, Codex Med): myCompensation runs assertSubjectInScope(caller, caller)
        // faithfully — it is NOT always trivial. A UNIT-scoped caller with NO user_business_units row has an
        // empty unitMemberIds() that excludes the caller, so TS 403s; C# must 403 too, NOT return the caller's
        // own comp. Neutralizing the fix (skipping the assertion) → 200 with a null body → this test goes RED.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, MyCompensation, Mint(CompensationReadFixture.UnitScopeSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── 403: resolvable staff whose roles LACK compensation:read ──
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, SalaryBands, Mint(CompensationReadFixture.NoGrantSub));
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
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, SalaryBands, token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, SalaryBands, Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── input validation AFTER auth: bad companyId uuid → 400 (authorized); unauth bad → 401 ──
    [Fact]
    public async Task OrgScope_SalaryBands_BadCompanyId_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, $"{SalaryBands}?companyId=not-a-uuid", Mint(CompensationReadFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_BadCompanyId_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync($"{SalaryBands}?companyId=not-a-uuid");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── dark-by-default: flag OFF (default) → route NOT mapped → 404 (ALL routes) ──
    [Theory]
    [InlineData(SalaryBands)]
    [InlineData(MarketComparison)]
    [InlineData(BenefitsUtilization)]
    [InlineData(CompaRatio)]
    [InlineData(PendingAdjustments)]
    [InlineData("/compensation/employee/d0000000-0000-0000-0000-000000000001")]
    [InlineData(MyCompensation)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ──
    [Fact]
    public async Task SalaryBandsRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync(SalaryBands);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
