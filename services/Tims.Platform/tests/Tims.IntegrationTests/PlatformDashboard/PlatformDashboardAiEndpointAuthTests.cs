using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Phase-5 slice 23 (issue #81, final read) endpoint matrix + wire payload for
/// <c>GET /platform/dashboard/ai-cost-anomalies</c>: real host + real Postgres through
/// PrincipalResolver + PlatformOwnerGate —
///   platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
///   flag OFF (default) → 404 (dark). No input exists, so no 400 is reachable, faithfully
///   (the TS procedure declares no <c>.input()</c>).
///
/// <para>TRAP 4: without this class the gate is unenforced on this route — the kernel's unit tests and
/// the repository queries never touch <c>PlatformOwnerGate</c>, so it could be deleted from the handler
/// with everything else green.</para>
///
/// <para>The payload test asserts EXACT WIRE VALUES over the whole response — the sorted anomaly order,
/// each item's full key set, both <c>toFixed(2)</c> detail strings (verified against Node), and the
/// literal <c>null</c> a budget-less config puts on the wire.</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformDashboardAiEndpointAuthTests(PlatformDashboardReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private const string Path = "/platform/dashboard/ai-cost-anomalies";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-dashboard-ai-test-key" };

    private readonly PlatformDashboardReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformDashboardReadEnabled", "true");
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, Path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── the gate ─────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task PlatformOwner_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await Get(client, Mint(PlatformDashboardReadFixture.PlatformOwnerSub))).StatusCode);
    }

    [Fact]
    public async Task OrdinaryOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, Mint(PlatformDashboardReadFixture.OrgUserSub))).StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Path)).StatusCode);
    }

    // ── the window bound is INCLUSIVE (gte), proven at the exact boundary ────────────────────────────
    [Fact]
    public async Task TheUsageWindow_IsInclusiveAtItsExactBoundary()
    {
        // TS is `createdAt: { gte: thirtyDaysAgo }`. The payload test cannot pin `>=` against `>` —
        // its rows sit whole days from the request-time bound — so this drives the repository directly
        // with `since` set to the EXACT created_at of Alpha@OrgA's newest usage row (seed −2d). `>=`
        // keeps exactly that row (calls 1, cost 100.25, the −5d and −31d rows excluded); a `>` returns
        // the group without it or no group at all. Deterministic: both instants are fixture constants,
        // no wall clock involved. (The panel found this mutation survived every prior test.)
        await using var db = _fixture.NewReadContext();
        var repository = new Tims.Infrastructure.PlatformDashboard.PlatformDashboardAiRepository(db);

        var boundary = _fixture.SeedNowUtc.AddDays(-2);
        var rows = await repository.GetUsageSinceAsync(boundary, CancellationToken.None);

        var alphaOrgA = Assert.Single(rows, r =>
            r.AgentId == PlatformDashboardReadFixture.AgentAlpha && r.OrganizationId == PlatformDashboardReadFixture.OrgA);
        Assert.Equal(1, alphaOrgA.Calls);
        Assert.Equal(100.25, alphaOrgA.CostSum);
    }

    // ── the whole payload, exact wire values ─────────────────────────────────────────────────────────
    [Fact]
    public async Task AiCostAnomalies_ClassifiedSortedAndSummed()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

        Assert.Equal(4, body.EnumerateObject().Count());

        var anomalies = body.GetProperty("anomalies");
        Assert.Equal(4, anomalies.GetArrayLength());

        // Every item carries the same NINE keys — including monthlyBudget when it is null, because the
        // TS object literal always writes it.
        foreach (var item in anomalies.EnumerateArray())
        {
            Assert.Equal(
                ["type", "agentName", "agentSlug", "orgName", "orgId", "detail", "monthlyCost", "monthlyBudget", "potentialSavings"],
                item.EnumerateObject().Select(p => p.Name).ToArray());
        }

        // Sorted by potentialSavings DESCENDING — the four values are deliberately distinct
        // (50.25 > 5 > 2 > 0.5), so the order is deterministic regardless of config row order.
        var overBudget = anomalies[0];
        Assert.Equal("over_budget", overBudget.GetProperty("type").GetString());
        Assert.Equal("CV Parser", overBudget.GetProperty("agentName").GetString());
        Assert.Equal("cv-parser", overBudget.GetProperty("agentSlug").GetString());
        Assert.Equal("Acme Corp", overBudget.GetProperty("orgName").GetString());
        Assert.Equal(PlatformDashboardReadFixture.OrgA.ToString(), overBudget.GetProperty("orgId").GetString());
        // toFixed(2) semantics on both interpolations, verified against Node — and the spend is the
        // WINDOWED sum: the 400-cost log 31 days back must not be in it.
        Assert.Equal("$150.25 spent vs $100.00 budget", overBudget.GetProperty("detail").GetString());
        Assert.Equal(PlatformDashboardReadFixture.AlphaOrgASpend, overBudget.GetProperty("monthlyCost").GetDouble());
        Assert.Equal(100, overBudget.GetProperty("monthlyBudget").GetDouble());
        Assert.Equal(50.25, overBudget.GetProperty("potentialSavings").GetDouble());

        // Gamma@Hooli appears TWICE — the negative-budget config yields BOTH anomaly types, which is
        // the pin that the two branches are independent `if`s and that a negative budget is JS-truthy.
        var negativeBudget = anomalies[1];
        Assert.Equal("over_budget", negativeBudget.GetProperty("type").GetString());
        Assert.Equal("Salary Advisor", negativeBudget.GetProperty("agentName").GetString());
        Assert.Equal("salary-advisor", negativeBudget.GetProperty("agentSlug").GetString());
        Assert.Equal("Hooli", negativeBudget.GetProperty("orgName").GetString());
        Assert.Equal(PlatformDashboardReadFixture.OrgG.ToString(), negativeBudget.GetProperty("orgId").GetString());
        Assert.Equal("$0.00 spent vs $-5.00 budget", negativeBudget.GetProperty("detail").GetString());
        Assert.Equal(0, negativeBudget.GetProperty("monthlyCost").GetDouble());
        Assert.Equal(-5, negativeBudget.GetProperty("monthlyBudget").GetDouble());
        Assert.Equal(5, negativeBudget.GetProperty("potentialSavings").GetDouble());

        var gammaZeroUsage = anomalies[2];
        Assert.Equal("zero_usage", gammaZeroUsage.GetProperty("type").GetString());
        Assert.Equal("salary-advisor", gammaZeroUsage.GetProperty("agentSlug").GetString());
        // `Enabled but 0 calls in 30 days` — a constant template literal; monthlyCost is the literal 0
        // the TS branch writes, NOT the (absent) usage sum, and estimatedWaste is costPerCall × 10.
        Assert.Equal("Enabled but 0 calls in 30 days", gammaZeroUsage.GetProperty("detail").GetString());
        Assert.Equal(0, gammaZeroUsage.GetProperty("monthlyCost").GetDouble());
        Assert.Equal(-5, gammaZeroUsage.GetProperty("monthlyBudget").GetDouble());
        Assert.Equal(2, gammaZeroUsage.GetProperty("potentialSavings").GetDouble());

        var alphaZeroUsage = anomalies[3];
        Assert.Equal("zero_usage", alphaZeroUsage.GetProperty("type").GetString());
        Assert.Equal("CV Parser", alphaZeroUsage.GetProperty("agentName").GetString());
        Assert.Equal("Globex Inc", alphaZeroUsage.GetProperty("orgName").GetString());
        Assert.Equal(PlatformDashboardReadFixture.OrgB.ToString(), alphaZeroUsage.GetProperty("orgId").GetString());
        // The key is PRESENT and NULL — a budget-less config writes monthlyBudget: null, and dropping
        // the key (e.g. via JsonIgnore) is the realistic wrong port. Also proves the 30-day window from
        // the other side: Alpha@OrgB HAS a usage row, 31 days old, and still counts as zero usage.
        Assert.Equal(JsonValueKind.Null, alphaZeroUsage.GetProperty("monthlyBudget").ValueKind);
        Assert.Equal(0.5, alphaZeroUsage.GetProperty("potentialSavings").GetDouble());

        // 50.25 + 0.5 + 2 + 5, accumulated in config scan order — exact in double, so an equality.
        Assert.Equal(57.75, body.GetProperty("totalPotentialSavings").GetDouble());
        Assert.Equal(2, body.GetProperty("zeroUsageCount").GetInt32());
        Assert.Equal(2, body.GetProperty("overBudgetCount").GetInt32());

        // The decoys, by name: the stub agent's config (status skip), the DISABLED Job Matcher config
        // with 999.5 of in-window spend (enabled filter), its healthy OrgB sibling (under budget), the
        // zero-budget DEI Analyst with 25.5 of spend (JS falsiness — 0 budget can never be exceeded),
        // and the configless Gamma@OrgH usage row. None may surface.
        var slugs = anomalies.EnumerateArray().Select(a => a.GetProperty("agentSlug").GetString()).ToList();
        Assert.DoesNotContain("stub-agent", slugs);
        Assert.DoesNotContain("job-matcher", slugs);
        Assert.DoesNotContain("dei-analyst", slugs);
        var orgIds = anomalies.EnumerateArray().Select(a => a.GetProperty("orgId").GetString()).ToList();
        Assert.DoesNotContain(PlatformDashboardReadFixture.OrgH.ToString(), orgIds);
    }
}
