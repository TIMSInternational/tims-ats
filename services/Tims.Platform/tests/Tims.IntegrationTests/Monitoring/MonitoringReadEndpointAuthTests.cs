using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Monitoring;

/// <summary>
/// Phase-5 Q0b slice 1 (issue #100) endpoint boot matrix — real host + real Postgres + real RLS. Boots
/// <c>WebApplicationFactory</c> against the fixture DB with a locally-minted JWKS and drives the REAL
/// HTTP pipeline for the six monitoring READ endpoints through the Supabase JWT scheme →
/// PrincipalResolver → PermissionService <c>monitoring:read</c> grant → the per-endpoint mechanic:
///
/// <list type="bullet">
///   <item><description>organization-scope → 200 on all six.</description></item>
///   <item><description>UNIT-scope (hrbp, the real seed grant) → 200 as well, because the live TS
///     reader applies NO org-gate here. That is asserted deliberately: it is the pre-existing shape of
///     the surface, and a port that silently 403'd it would break a role that reads these dashboards
///     today. What unit scope DOES change is <c>action-plan-alerts</c>, where the row filter drops the
///     plan owned outside the caller's unit.</description></item>
///   <item><description>resolvable staff WITHOUT the grant → 403; no / tampered / unknown-sub JWT → 401.</description></item>
///   <item><description>authorized but invalid query input → 400, AFTER auth (tRPC parity).</description></item>
///   <item><description>flag OFF (the DEFAULT) → 404 on every path — the dark-by-default proof.</description></item>
/// </list>
/// </summary>
[Collection("MonitoringRead")]
public sealed class MonitoringReadEndpointAuthTests(MonitoringReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private const string ExecutiveKpis = "/monitoring/executive-kpis";
    private const string ModuleHealth = "/monitoring/module-health";
    private const string Alerts = "/monitoring/alerts";
    private const string ActionPlanAlerts = "/monitoring/action-plan-alerts";
    private const string CrossModuleTrend = "/monitoring/cross-module-trend?metric=headcount";
    private const string AlertRules = "/monitoring/alert-rules";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "monitoring-test-key" };

    public static IEnumerable<object[]> AllPaths() =>
    [
        [ExecutiveKpis], [ModuleHealth], [Alerts], [ActionPlanAlerts], [CrossModuleTrend], [AlertRules],
    ];

    private readonly MonitoringReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:MonitoringReadEnabled", "true");
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

    // ── 200s ─────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(AllPaths))]
    public async Task OrgScope_Is200_onEveryReadPath(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(MonitoringReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AllPaths))]
    public async Task UnitScope_Is200_onEveryReadPath_becauseTheLiveTsReaderHasNoOrgGate(string path)
    {
        // PARITY, asserted on purpose. `seed-access-matrix.ts` grants monitoring:read to hrbp at UNIT
        // scope and the TS reader applies no requireOrgScope, so a unit-scoped caller reads these
        // dashboards today. If a future product decision narrows that, it is a behaviour change to be
        // made on BOTH stacks — this test is the thing that will force the conversation.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(MonitoringReadFixture.UnitReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task OrgScope_ExecutiveKpis_suppressesTheSubFloorPendingAdjustments_overTheWire()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.OrgReaderSub));
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"pendingAdjustments\":null", body);
        Assert.Contains("\"pendingAdjustmentsSuppressed\":true", body);
        Assert.DoesNotContain("\"pendingAdjustments\":3", body); // the raw sub-floor count never ships
        Assert.DoesNotContain("schemaVersion", body);            // INTERNAL staff read = raw shape
    }

    [Fact]
    public async Task UnitScope_ActionPlanAlerts_dropsThePlanOutsideTheCallersUnit()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var org = await Get(client, ActionPlanAlerts, Mint(MonitoringReadFixture.OrgReaderSub));
        var unit = await Get(client, ActionPlanAlerts, Mint(MonitoringReadFixture.UnitReaderSub));

        var orgBody = await org.Content.ReadAsStringAsync();
        var unitBody = await unit.Content.ReadAsStringAsync();

        // The org reader sees both due-soon plans; the hrbp sees only the one owned inside its unit.
        Assert.Contains("\"total\":2", orgBody);
        Assert.Contains(MonitoringReadFixture.Ap2.ToString(), orgBody);
        Assert.Contains("\"total\":1", unitBody);
        Assert.Contains(MonitoringReadFixture.Ap1.ToString(), unitBody);
        Assert.DoesNotContain(MonitoringReadFixture.Ap2.ToString(), unitBody);
    }

    [Fact]
    public async Task OrgC_EMPTY_org_returnsHonestZeroes_not404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var kpis = await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.OrgCReaderSub));
        var health = await Get(client, ModuleHealth, Mint(MonitoringReadFixture.OrgCReaderSub));
        var alerts = await Get(client, Alerts, Mint(MonitoringReadFixture.OrgCReaderSub));

        Assert.Equal(HttpStatusCode.OK, kpis.StatusCode);
        var kpiBody = await kpis.Content.ReadAsStringAsync();
        Assert.Contains("\"pendingAdjustments\":0", kpiBody);
        Assert.Contains("\"pendingAdjustmentsSuppressed\":false", kpiBody);

        var healthBody = await health.Content.ReadAsStringAsync();
        Assert.Contains("\"recruitment\"", healthBody);       // all 8 rows, not an empty array
        Assert.Contains("\"performance\"", healthBody);
        Assert.DoesNotContain("critical", healthBody);

        Assert.Contains("\"total\":0", await alerts.Content.ReadAsStringAsync());
    }

    // ── 403 / 401 ────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(AllPaths))]
    public async Task ResolvableStaffWithoutTheGrant_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(MonitoringReadFixture.NoGrantSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AllPaths))]
    public async Task NoToken_Is401(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UnknownSub_Is401_neverAnEmpty200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, Mint("sub-that-is-nobody"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TokenSignedByAnotherKey_Is401()
    {
        using var otherRsa = RSA.Create(2048);
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", MonitoringReadFixture.OrgReaderSub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(
                new RsaSecurityKey(otherRsa) { KeyId = PrivateKey.KeyId }, SecurityAlgorithms.RsaSha256),
        };
        var forged = new JsonWebTokenHandler().CreateToken(descriptor);

        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, forged);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── 400 AFTER auth (tRPC middleware-before-Zod parity) ───────────────────────────────────────

    [Theory]
    [InlineData("/monitoring/alerts?severity=nope")]
    [InlineData("/monitoring/alerts?page=0")]
    [InlineData("/monitoring/alerts?limit=101")]
    [InlineData("/monitoring/alerts?limit=0")]
    [InlineData("/monitoring/cross-module-trend")]
    [InlineData("/monitoring/cross-module-trend?metric=salary")]
    [InlineData("/monitoring/cross-module-trend?metric=headcount&period=3m")]
    public async Task AuthorizedButInvalidInput_Is400(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(MonitoringReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UnauthenticatedInvalidInput_Is401_NOT400_authRunsFirst()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/monitoring/alerts?severity=nope", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task OverLongModuleFilter_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(
            client, "/monitoring/alerts?module=" + new string('x', 101), Mint(MonitoringReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── dark by default ──────────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(AllPaths))]
    public async Task FlagOff_Is404_onEveryPath(string path)
    {
        // MonitoringReadEnabled defaults to FALSE, so nothing is mapped and nothing about production
        // behaviour changes when this branch merges.
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(MonitoringReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
