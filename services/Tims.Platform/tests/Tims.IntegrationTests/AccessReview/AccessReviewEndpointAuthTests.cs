using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Phase-5 Slice 18 endpoint boot matrix — mirrors `AuditReadEndpointAuthTests` exactly:
/// platform-owner → 200; resolvable org-user → 403; no/tampered JWT → 401; flags OFF (default) → 404.
/// </summary>
[Collection("AccessReview")]
public sealed class AccessReviewEndpointAuthTests(AccessReviewFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ReportPath = "/access-review";
    private const string ExportPath = "/access-review/export";
    private const string AttestPath = "/access-review/attest";
    private const string HistoryPath = "/access-review/attestations";

    // The fixed, deliberately NON-EXISTENT organization id that scripts/parity/surfaces.ts's
    // `access-review` surface pins into all three read paths. Not kept in sync by tooling — if the
    // registry ever changes the value, PlatformOwner_Reads_Are200_ForNonExistentOrg below still
    // proves the PROPERTY the registration depends on, just for a different id.
    private const string ParityHarnessOrgId = "00000000-0000-0000-0000-000000000000";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "access-review-test-key" };

    private readonly AccessReviewFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AccessReviewReadEnabled", "true");
            builder.UseSetting("Platform:AccessReviewWriteEnabled", "true");
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
        if (token is not null) request.Headers.Add("Authorization", $"Bearer {token}");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task PlatformOwner_Report_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("neverLoggedIn", body);
    }

    [Fact]
    public async Task OrdinaryOrgUser_Report_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Report_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagsDefaultOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{ReportPath}?organizationId={AccessReviewFixture.OrgA}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync(AttestPath, JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }))).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Export_Is200_WithHardenedCsv()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var csv = json.RootElement.GetProperty("data").GetString();
        Assert.Contains("\"Usuario\",\"Email\",\"Organizacion\"", csv);
    }

    [Fact]
    public async Task PlatformOwner_Attest_Is200_ThenOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA, notes = "Q3 review" }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var forbiddenRequest = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }),
        };
        forbiddenRequest.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.OrgUserSub)}");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(forbiddenRequest)).StatusCode);
    }

    [Fact]
    public async Task Attest_Is404_WhenOrgDoesNotExist()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = Guid.NewGuid() }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Attestations_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{HistoryPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// Pins the assumption the parity harness's `access-review` surface registration rests on
    /// (scripts/parity/surfaces.ts, re-registered C#-only 2026-08-11): all three READ routes answer
    /// 200 with an EMPTY report for a non-existent organization, so the harness can pin a fixed
    /// all-zeros org id and assert `platform_owner: 200` without seeding or resolving a real org.
    ///
    /// Two behaviours make that true and both are load-bearing, so both are asserted here rather
    /// than inferred from the source: (1) <see cref="Tims.Application.AccessReview.AccessReviewService.BuildReportAsync"/>
    /// has NO org-exists precondition — only <c>AttestAsync</c> does, which is why
    /// <see cref="Attest_Is404_WhenOrgDoesNotExist"/> above expects 404 while these expect 200;
    /// (2) the security-event write that <c>report</c>/<c>export</c> perform with that bogus org id
    /// cannot fail the request, because <c>SecurityEventWriter.WriteAsync</c> is fail-soft.
    ///
    /// The literal below is the SAME id the registry pins. If a future change makes an unknown org
    /// 404 here — the behaviour <c>getOrganization</c> already has, which is exactly why THAT read
    /// is still unregistered — this test fails instead of the parity run failing in Federico's hands.
    /// </summary>
    [Theory]
    [InlineData(ReportPath)]
    [InlineData(ExportPath)]
    [InlineData(HistoryPath)]
    public async Task PlatformOwner_Reads_Are200_ForNonExistentOrg(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{path}?organizationId={ParityHarnessOrgId}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// The other half of the registry's expectation matrix on the same fixed id: `org_admin` (any
    /// ordinary org user) is refused by <c>PlatformOwnerGate</c> BEFORE any org lookup, so the 403
    /// does not depend on the org existing either. Without this, a green RBAC run on the harness
    /// could not distinguish "the gate denied" from "the unknown org happened to error".
    /// </summary>
    [Fact]
    public async Task OrdinaryOrgUser_Report_Is403_ForNonExistentOrg()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={ParityHarnessOrgId}", Mint(AccessReviewFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// Regression test for the whole-branch-review Critical finding: pre-fix, `AccessReviewRow.Status`
    /// was a bare `AccessStatus` enum with no converter, so `Results.Ok(report)` serialized `status` as
    /// the raw integer 0 (ValueKind.Number) instead of the TS contract's lowercase string "active" —
    /// `GetString()` below would THROW against the pre-fix code, not merely assert false. Also proves
    /// nothing else drifted from `contracts/access-review-fixtures/access-review-report.json`'s shape
    /// (the gap the review flagged: nothing on the C# side ever compared real output to these fixtures).
    /// </summary>
    [Fact]
    public async Task PlatformOwner_Report_MatchesGoldenFixtureShape_AndStatusIsLowercaseString()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var actual = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var fixtureJson = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "access-review-fixtures", "access-review-report.json"));
        using var golden = JsonDocument.Parse(fixtureJson);

        AssertSameKeys(golden.RootElement, actual.RootElement);
        AssertSameKeys(golden.RootElement.GetProperty("summary"), actual.RootElement.GetProperty("summary"));

        var goldenRow = golden.RootElement.GetProperty("rows")[0];
        var actualRow = actual.RootElement.GetProperty("rows")
            .EnumerateArray()
            .First(r => r.GetProperty("userId").GetString() == AccessReviewFixture.HealthyUserId.ToString());
        AssertSameKeys(goldenRow, actualRow);
        AssertSameKeys(goldenRow.GetProperty("flags"), actualRow.GetProperty("flags"));
        AssertSameKeys(goldenRow.GetProperty("roles")[0], actualRow.GetProperty("roles")[0]);

        Assert.Equal(JsonValueKind.String, actualRow.GetProperty("status").ValueKind);
        Assert.Equal("active", actualRow.GetProperty("status").GetString());
    }

    /// <summary>
    /// Regression test for the Important finding that nothing on the C# side byte-compares CSV export
    /// output against the golden fixture. <see cref="AccessReviewFixture.CsvFixtureUserId"/> mirrors
    /// `export-access-review-csv.json`'s "sample" fields exactly (formula-injection name, companyScope,
    /// assignedBy, all flags "N") so the REAL <c>AccessReviewEndpoints.BuildCsv</c> output for that row
    /// can be asserted byte-for-byte against `expectedCsvRow` — stricter than the header-substring check
    /// in <c>AuditReadEndpointAuthTests</c>.
    /// </summary>
    [Fact]
    public async Task PlatformOwner_Export_CsvFixtureRow_MatchesGoldenFixtureByteExact()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var csv = json.RootElement.GetProperty("data").GetString();
        Assert.NotNull(csv);

        var fixtureJson = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "access-review-fixtures", "export-access-review-csv.json"));
        using var golden = JsonDocument.Parse(fixtureJson);
        var expectedRow = golden.RootElement.GetProperty("expectedCsvRow").GetString();
        Assert.NotNull(expectedRow);

        // The formula-injection prefix is unique to CsvFixtureUserId's seeded name — no other row
        // collides with it.
        var actualRow = csv!.Split('\n').Single(line => line.Contains("cmd|"));
        Assert.Equal(expectedRow, actualRow);
    }

    private static void AssertSameKeys(JsonElement expected, JsonElement actual)
    {
        var expectedKeys = expected.EnumerateObject().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToArray();
        var actualKeys = actual.EnumerateObject().Select(p => p.Name).OrderBy(k => k, StringComparer.Ordinal).ToArray();
        Assert.Equal(expectedKeys, actualKeys);
    }
}
