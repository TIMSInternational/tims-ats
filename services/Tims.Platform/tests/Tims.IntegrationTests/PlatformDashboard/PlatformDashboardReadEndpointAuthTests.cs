using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Application.PlatformDashboard;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Phase-5 slice 23 (issue #81, PR 1 of 3) endpoint boot matrix: real host + real Postgres, driving the
/// REAL HTTP pipeline through PrincipalResolver + PlatformOwnerGate on all THREE routes —
///   platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
///   flag OFF (default) → 404 (dark).
///
/// <para>TRAP 4: without this class the gate is unenforced — every repository-level test calls the
/// repository directly, so <c>PlatformOwnerGate</c> could be deleted from all three handlers with the whole
/// suite green. The deny assertions are per-ROUTE because the gate is copied into each handler and deleting
/// it from ONE handler is the realistic mistake.</para>
///
/// <para>There is NO 400 matrix, and that is not an omission: none of the three procedures declares any
/// input in TS, so the C# handlers bind nothing — TRAP 9 has no surface here.</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformDashboardReadEndpointAuthTests(PlatformDashboardReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string PlanDistributionPath = "/platform/dashboard/plan-distribution";
    private const string UserGrowthPath = "/platform/dashboard/user-growth";
    private const string RecentActivityPath = "/platform/dashboard/recent-activity";

    /// <summary>Exactly what superjson + <c>Date.prototype.toISOString()</c> emit: three millisecond
    /// digits, trailing Z — the #211 defect class, asserted on every timestamp on the wire.</summary>
    private static readonly Regex NodeIsoPattern =
        new(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", RegexOptions.None, TimeSpan.FromSeconds(1));

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-dashboard-test-key" };

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

    /// <summary>The Node `Date.prototype.toISOString()` shape of a naive-UTC instant.</summary>
    private static string NodeIso(DateTime utc) =>
        utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── the gate, per route ──────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(PlanDistributionPath)]
    [InlineData(UserGrowthPath)]
    [InlineData(RecentActivityPath)]
    public async Task PlatformOwner_Is200(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(PlanDistributionPath)]
    [InlineData(UserGrowthPath)]
    [InlineData(RecentActivityPath)]
    public async Task OrdinaryOrgUser_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(PlanDistributionPath, null)]
    [InlineData(UserGrowthPath, null)]
    [InlineData(RecentActivityPath, null)]
    [InlineData(PlanDistributionPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(UserGrowthPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(RecentActivityPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string path, string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, token)).StatusCode);
    }

    [Theory]
    [InlineData(PlanDistributionPath)]
    [InlineData(UserGrowthPath)]
    [InlineData(RecentActivityPath)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── getPlanDistribution, over the real wire ─────────────────────────────────────────────────────
    /// <summary>
    /// Cross-org bucket counts in the SEEDED order, with JS rounding. The load-bearing cell: 1/8 = 12.5%,
    /// which must serialise as 13 — .NET's default banker's rounding emits 12, so this single digit is the
    /// wire-level proof that <c>JsRound</c> (AwayFromZero) reached production code and not just the unit
    /// suite. Every item is exactly <c>{ plan, count, percentage }</c>, and the array order is the TS
    /// object-insertion order (the four seeds, then unknowns — none possible in prod, where the column is
    /// the 4-label OrgPlan enum).
    /// </summary>
    [Fact]
    public async Task PlanDistribution_SeedOrderCountsAndJsRounding()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, PlanDistributionPath, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = json.RootElement;

        Assert.Equal(4, items.GetArrayLength());

        var expected = new (string Plan, int Count, int Percentage)[]
        {
            ("trial", 1, 13),        // 12.5% — banker's would say 12; JS says 13
            ("starter", 3, 38),      // 37.5% — both roundings say 38 (to-even lands on the even 38)
            ("professional", 3, 38),
            ("enterprise", 1, 13),
        };

        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].Plan, items[i].GetProperty("plan").GetString());
            Assert.Equal(expected[i].Count, items[i].GetProperty("count").GetInt32());
            Assert.Equal(expected[i].Percentage, items[i].GetProperty("percentage").GetInt32());
            Assert.Equal(3, items[i].EnumerateObject().Count());
        }
    }

    // ── getUserGrowth, over the real wire ───────────────────────────────────────────────────────────
    /// <summary>
    /// Six gap-filled buckets, oldest first, Spanish short labels, and BOTH window boundaries:
    /// the owner sits at exactly <c>from</c> (inclusive → counted in bucket 0), the org user 1s before it
    /// (excluded entirely), one user 1s before the current month (bucket 4) and five in the current month
    /// (bucket 5) — one of them 30 minutes after the boundary, which a session-TZ-dependent
    /// <c>date_trunc</c> would misfile under a non-UTC session. Expected counts: [1, 0, 0, 0, 1, 5].
    ///
    /// <para>The label expectation reuses <see cref="PlatformDashboardReadUseCase.SpanishShortMonth"/>,
    /// which is legitimate here because the twelve strings themselves are pinned byte-for-byte against the
    /// shared golden by the unit suites of BOTH stacks — this test only proves the wiring put the right
    /// month in the right bucket.</para>
    /// </summary>
    [Fact]
    public async Task UserGrowth_SixGapFilledBuckets_WindowBounds_SpanishLabels()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, UserGrowthPath, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();

        // The seed hangs off the month current AT SEED TIME; the endpoint windows off the month current AT
        // REQUEST TIME. If a month boundary fell between the two, every expectation below shifts by one
        // bucket — a legitimate skip (roughly one run in a hundred thousand), not a pass.
        var nowUtc = DateTime.UtcNow;
        var monthStartNow = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        if (monthStartNow != _fixture.MonthStartUtc)
        {
            return;
        }

        using var json = JsonDocument.Parse(body);
        var items = json.RootElement;
        Assert.Equal(6, items.GetArrayLength());

        var expectedCounts = new[] { 1, 0, 0, 0, 1, 5 };
        for (var i = 0; i < 6; i++)
        {
            var bucketMonth = _fixture.MonthStartUtc.AddMonths(-5 + i);
            Assert.Equal(
                PlatformDashboardReadUseCase.SpanishShortMonth(bucketMonth.Month - 1),
                items[i].GetProperty("month").GetString());
            Assert.Equal(expectedCounts[i], items[i].GetProperty("count").GetInt32());
            Assert.Equal(2, items[i].EnumerateObject().Count());
        }
    }

    // ── getRecentActivity, over the real wire ───────────────────────────────────────────────────────
    /// <summary>
    /// The full merged list: ten items, strictly descending, with every deliberate seed property visible —
    /// <list type="bullet">
    /// <item>the millisecond-equal org/user pair keeps the ORG first (TS pushes orgs before users and
    /// ES2019 sort is stable; <c>OrderByDescending</c> must reproduce that, and items 0/1 carry the SAME
    /// wire timestamp, so this is the tiebreak and nothing else);</item>
    /// <item><c>is_platform_owner</c> surfaces as type <c>platform_owner</c>, others as
    /// <c>user_created</c>/<c>org_created</c>;</item>
    /// <item>org <c>meta</c> is the PLAN (a native enum materialised as text — the wire-level proof the
    /// unmapped-types data source is engaged on organizations too), user <c>meta</c> is the email;</item>
    /// <item>the INACTIVE org and the INACTIVE, SOFT-DELETED user are both present — the TS queries have
    /// no <c>where</c>;</item>
    /// <item>the sixth-newest org and user are absent — the per-source <c>take: 5</c>;</item>
    /// <item>every timestamp is asserted as the EXACT NodeIso string of its seeded instant — value AND
    /// format. A format-only regex (the first version of this test) would pass with every wire value
    /// wrong: a converter that shifted the instant by a constant offset preserves ordering, the tie, and
    /// the pattern. The <c>.000</c> whole-second items double as the STJ-truncation pin.</item>
    /// </list>
    /// </summary>
    [Fact]
    public async Task RecentActivity_MergeOrderTiebreakTypesAndMeta()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, RecentActivityPath, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var items = json.RootElement;

        Assert.Equal(10, items.GetArrayLength());

        var m0 = _fixture.MonthStartUtc;
        var expected = new (Guid Id, string Type, string Title, string Meta, DateTime Instant)[]
        {
            (PlatformDashboardReadFixture.OrgH, "org_created", "Nueva organizacion: Pied Piper", "enterprise", m0.AddMinutes(45).AddMilliseconds(123)),
            (PlatformDashboardReadFixture.UserNewest, "user_created", "Nuevo usuario: Nina Newest", "newest@acme.test", m0.AddMinutes(45).AddMilliseconds(123)),
            (PlatformDashboardReadFixture.OrgG, "org_created", "Nueva organizacion: Hooli", "professional", m0.AddMinutes(44)),
            (PlatformDashboardReadFixture.UserSecondOwner, "platform_owner", "Nuevo usuario: Pat Platform", "owner2@tims.test", m0.AddMinutes(40)),
            (PlatformDashboardReadFixture.OrgF, "org_created", "Nueva organizacion: Wayne Enterprises", "professional", m0.AddMinutes(35)),
            (PlatformDashboardReadFixture.UserCurrent, "user_created", "Nuevo usuario: Carlos Current", "current@acme.test", m0.AddMinutes(30)),
            (PlatformDashboardReadFixture.OrgE, "org_created", "Nueva organizacion: Stark Industries", "professional", m0.AddMinutes(25)),
            (PlatformDashboardReadFixture.UserGhost, "user_created", "Nuevo usuario: Gus Ghost", "ghost@globex.test", m0.AddMinutes(20)),
            (PlatformDashboardReadFixture.OrgD, "org_created", "Nueva organizacion: Umbrella Corp", "starter", m0.AddMinutes(15)),
            (PlatformDashboardReadFixture.UserLater, "user_created", "Nuevo usuario: Lena Later", "later@acme.test", m0.AddMinutes(10)),
        };

        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].Id.ToString(), items[i].GetProperty("id").GetString());
            Assert.Equal(expected[i].Type, items[i].GetProperty("type").GetString());
            Assert.Equal(expected[i].Title, items[i].GetProperty("title").GetString());
            Assert.Equal(expected[i].Meta, items[i].GetProperty("meta").GetString());
            // The EXACT wire string of the seeded instant — superjson's toISOString shape (3-digit ms,
            // trailing Z), computed from the same MonthStartUtc the fixture seeded from. Value + format
            // in one assertion; the regex below is then structurally redundant but kept as belt/braces.
            Assert.Equal(NodeIso(expected[i].Instant), items[i].GetProperty("timestamp").GetString());
            Assert.Matches(NodeIsoPattern, items[i].GetProperty("timestamp").GetString()!);
            Assert.Equal(5, items[i].EnumerateObject().Count());
        }

        // The tie, explicitly: items 0 and 1 carry the SAME instant on the wire, so their relative order
        // above is purely the stable-sort tiebreak — not a smaller timestamp difference in disguise.
        Assert.Equal(
            items[0].GetProperty("timestamp").GetString(),
            items[1].GetProperty("timestamp").GetString());

        // The sixth-newest of each source must not appear anywhere (take: 5 per source, before the merge).
        var ids = items.EnumerateArray().Select(i => i.GetProperty("id").GetString()).ToList();
        Assert.DoesNotContain(PlatformDashboardReadFixture.OrgC.ToString(), ids);
        Assert.DoesNotContain(PlatformDashboardReadFixture.UserPreviousMonth.ToString(), ids);
    }
}
