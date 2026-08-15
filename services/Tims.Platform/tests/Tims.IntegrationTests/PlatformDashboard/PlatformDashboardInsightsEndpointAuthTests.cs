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
using Tims.Application.PlatformDashboard;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Phase-5 slice 23 (issue #81, PR 2 of 3) endpoint matrix for the six remaining FX-free dashboard reads:
/// real host + real Postgres, driving the REAL HTTP pipeline through PrincipalResolver +
/// PlatformOwnerGate on every new route —
///   platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
///   flag OFF (default) → 404 (dark); and, for <c>search</c> alone, an out-of-range input → 400.
///
/// <para>TRAP 4: without this class the gate is unenforced on these six routes — every repository-level
/// test calls the repository directly, so <c>PlatformOwnerGate</c> could be deleted from all six handlers
/// with the whole suite green. The deny assertions are per-ROUTE because the gate is copied into each
/// handler and deleting it from ONE handler is the realistic mistake.</para>
///
/// <para>The payload tests assert EXACT WIRE VALUES — the Spanish description strings, the grouped
/// number format, the per-item-type key sets — not just shapes. A format-only assertion passes with every
/// value wrong, which is the lesson PR 1's timestamp test learned the hard way.</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformDashboardInsightsEndpointAuthTests(PlatformDashboardReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private const string AttentionItemsPath = "/platform/dashboard/attention-items";
    private const string MrrTrendPath = "/platform/dashboard/mrr-trend";
    private const string MrrForecastPath = "/platform/dashboard/mrr-forecast";
    private const string CustomerHealthPath = "/platform/dashboard/customer-health";
    private const string UpsellPath = "/platform/dashboard/upsell-opportunities";
    private const string SearchPath = "/platform/dashboard/search?query=acme";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-dashboard-insights-test-key" };

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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private async Task<JsonElement> OwnerBody(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    // ── the gate, per route ──────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(AttentionItemsPath)]
    [InlineData(MrrTrendPath)]
    [InlineData(MrrForecastPath)]
    [InlineData(CustomerHealthPath)]
    [InlineData(UpsellPath)]
    [InlineData(SearchPath)]
    public async Task PlatformOwner_Is200(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(AttentionItemsPath)]
    [InlineData(MrrTrendPath)]
    [InlineData(MrrForecastPath)]
    [InlineData(CustomerHealthPath)]
    [InlineData(UpsellPath)]
    [InlineData(SearchPath)]
    public async Task OrdinaryOrgUser_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(AttentionItemsPath, null)]
    [InlineData(MrrTrendPath, null)]
    [InlineData(MrrForecastPath, null)]
    [InlineData(CustomerHealthPath, null)]
    [InlineData(UpsellPath, null)]
    [InlineData(SearchPath, null)]
    [InlineData(AttentionItemsPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(MrrTrendPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(MrrForecastPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(CustomerHealthPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(UpsellPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(SearchPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string path, string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, token)).StatusCode);
    }

    [Theory]
    [InlineData(AttentionItemsPath)]
    [InlineData(MrrTrendPath)]
    [InlineData(MrrForecastPath)]
    [InlineData(CustomerHealthPath)]
    [InlineData(UpsellPath)]
    [InlineData(SearchPath)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
    }

    // ── search: the 400 matrix, and that auth still wins (TRAP 9) ────────────────────────────────────
    [Theory]
    [InlineData("/platform/dashboard/search")]              // no query parameter at all
    [InlineData("/platform/dashboard/search?query=")]       // present but empty — Zod min(1)
    public async Task Search_Is400_ForAnInvalidQuery(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Search_Is400_ForAQueryOver100Characters_AndAcceptsExactly100()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformDashboardReadFixture.PlatformOwnerSub);

        // REJECT, do not clamp — tRPC throws BAD_REQUEST rather than truncating.
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await Get(client, $"/platform/dashboard/search?query={new string('a', 101)}", token)).StatusCode);
        Assert.Equal(
            HttpStatusCode.OK,
            (await Get(client, $"/platform/dashboard/search?query={new string('a', 100)}", token)).StatusCode);
    }

    /// <summary>
    /// TRAP 9, asserted at the HTTP layer: a request with NO query parameter and NO credential must be
    /// 401, not 400.
    ///
    /// <para>Minimal-API binding runs before the handler, so declaring the parameter as a non-nullable
    /// <c>string</c> would have the framework reject the request during binding — before
    /// <c>PlatformOwnerGate</c> ever ran — and hand an anonymous caller a 400. tRPC runs middleware
    /// before Zod and answers 401. This is the only test that can tell the two apart, because every
    /// other 401 case supplies a valid query string.</para>
    /// </summary>
    [Fact]
    public async Task Search_withNoQueryAndNoToken_Is401_NOT_400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/platform/dashboard/search", null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>The same ordering one step further in: an ordinary org-user sending an invalid query gets
    /// 403, not 400 — authorization decides before input validation.</summary>
    [Fact]
    public async Task Search_withAnInvalidQueryAndAnOrgUserToken_Is403_NOT_400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/platform/dashboard/search?query=", Mint(PlatformDashboardReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── getAttentionItems, over the real wire ───────────────────────────────────────────────────────
    /// <summary>
    /// The whole merged worklist, in order, with every string asserted verbatim.
    ///
    /// <para>Order proves the two-level sort: critical (invoices by how overdue, then the failed payment
    /// whose missing <c>daysUntil</c> reads as 0), then warning (the suspended org at 0 BEFORE the trial
    /// at +3), then info. Content proves the two number formats that sit four lines apart in the TS
    /// helper — <c>1,234.5</c> with a grouping separator from <c>toLocaleString()</c>, and <c>999</c>
    /// without one from a bare interpolation.</para>
    /// </summary>
    [Fact]
    public async Task AttentionItems_FullWorklist_OrderStringsAndKeySets()
    {
        var items = await OwnerBody(AttentionItemsPath);

        Assert.Equal(7, items.GetArrayLength());

        var expected = new (string Id, string Type, string Severity, string Title, string Description)[]
        {
            (PlatformDashboardReadFixture.InvoiceOverdueGlobex.ToString(), "overdue_invoice", "critical",
                "Factura vencida - Globex Inc", "$2,000 EUR vencida hace 10 dias"),
            (PlatformDashboardReadFixture.InvoiceOverdueAcme.ToString(), "overdue_invoice", "critical",
                "Factura vencida - Acme Corp", "$1,234.5 USD vencida hace 3 dias"),
            ("f0000000-0000-0000-0000-000000000006", "failed_payment", "critical",
                "Pago fallido - Wayne Enterprises", "Suscripcion professional con pago pendiente ($999/mes)"),
            (PlatformDashboardReadFixture.OrgF.ToString(), "suspended_org", "warning",
                "Organizacion suspendida - Wayne Enterprises",
                "La organizacion esta desactivada y sus usuarios no pueden acceder"),
            ("f0000000-0000-0000-0000-000000000004", "expiring_trial", "warning",
                "Trial expira pronto - Umbrella Corp", "El periodo de prueba expira en 3 dias"),
            (PlatformDashboardReadFixture.InvitationStaleAcme.ToString(), "pending_invitation", "info",
                $"Invitacion sin aceptar - {PlatformDashboardReadFixture.StaleInvitationEmail}",
                "Enviada hace 9 dias para Acme Corp"),
            (PlatformDashboardReadFixture.InvitationStaleOrphan.ToString(), "pending_invitation", "info",
                $"Invitacion sin aceptar - {PlatformDashboardReadFixture.OrphanInvitationEmail}",
                "Enviada hace 6 dias"),
        };

        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].Id, items[i].GetProperty("id").GetString());
            Assert.Equal(expected[i].Type, items[i].GetProperty("type").GetString());
            Assert.Equal(expected[i].Severity, items[i].GetProperty("severity").GetString());
            Assert.Equal(expected[i].Title, items[i].GetProperty("title").GetString());
            Assert.Equal(expected[i].Description, items[i].GetProperty("description").GetString());
        }

        // The per-type KEY SETS, on the wire — the custom converter's entire reason to exist.
        Assert.Equal(12, items[0].EnumerateObject().Count());                       // overdue: everything
        Assert.Equal(-10, items[0].GetProperty("daysUntil").GetInt32());
        Assert.Equal(2000d, items[0].GetProperty("amount").GetDouble());
        Assert.Equal("EUR", items[0].GetProperty("currency").GetString());

        Assert.Equal(11, items[2].EnumerateObject().Count());                       // failed payment:
        Assert.False(items[2].TryGetProperty("daysUntil", out _));                  //   no daysUntil key
        Assert.Equal("USD", items[2].GetProperty("currency").GetString());          //   hardcoded USD

        Assert.Equal(10, items[4].EnumerateObject().Count());                       // expiring trial:
        Assert.False(items[4].TryGetProperty("amount", out _));                     //   no money keys
        Assert.Equal(3, items[4].GetProperty("daysUntil").GetInt32());

        // The org-less invitation: orgId/orgName present and NULL, never omitted.
        Assert.Equal(JsonValueKind.Null, items[6].GetProperty("orgId").ValueKind);
        Assert.Equal(JsonValueKind.Null, items[6].GetProperty("orgName").ValueKind);
        Assert.Equal(9, items[6].EnumerateObject().Count());

        // The decoys stayed out: an in-date pending invoice, a paid one, a fresh invitation and an
        // accepted one are all absent, and so is the 30-day trial.
        var ids = items.EnumerateArray().Select(i => i.GetProperty("id").GetString()).ToList();
        Assert.DoesNotContain("e0000000-0000-0000-0000-000000000003", ids);
        Assert.DoesNotContain("e0000000-0000-0000-0000-000000000004", ids);
        Assert.DoesNotContain("f1000000-0000-0000-0000-000000000003", ids);
        Assert.DoesNotContain("f1000000-0000-0000-0000-000000000004", ids);
        Assert.DoesNotContain("f0000000-0000-0000-0000-000000000007", ids);
    }

    // ── getMrrTrend, over the real wire ─────────────────────────────────────────────────────────────
    [Fact]
    public async Task MrrTrend_TwelveCumulativeBuckets_WithTheSeptAndTwoDigitYearLabels()
    {
        var points = await OwnerBody(MrrTrendPath);

        Assert.Equal(12, points.GetArrayLength());

        // Same month-boundary guard as PR 1's growth test: the seed hangs off the month current AT SEED
        // TIME, the endpoint windows off the month current AT REQUEST TIME.
        var nowUtc = DateTime.UtcNow;
        var monthStartNow = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        if (monthStartNow != _fixture.MonthStartUtc)
        {
            return;
        }

        // Active subscriptions: trial+starter created 5 months ago (0 + 499), and starter+professional+
        // enterprise created this month (499 + 999 + 2499). Cumulative, so the 499 carries forward.
        var expectedMrr = new long[] { 0, 0, 0, 0, 0, 0, 499, 499, 499, 499, 499, 4496 };

        for (var i = 0; i < 12; i++)
        {
            var bucketMonth = _fixture.MonthStartUtc.AddMonths(-11 + i);
            Assert.Equal(
                PlatformDashboardReadUseCase.SpanishShortMonthYear2(bucketMonth.Year, bucketMonth.Month - 1),
                points[i].GetProperty("month").GetString());
            Assert.Equal(expectedMrr[i], points[i].GetProperty("mrr").GetInt64());
            Assert.Equal(2, points[i].EnumerateObject().Count());
        }

        // The label format itself, spelled out on the wire: short month, one space, two-digit year.
        Assert.Matches(@"^[a-z]{3,4} \d{2}$", points[0].GetProperty("month").GetString()!);
    }

    // ── getMrrForecast, over the real wire ──────────────────────────────────────────────────────────
    [Fact]
    public async Task MrrForecast_HistoryProjectionAndBreakdown()
    {
        var body = await OwnerBody(MrrForecastPath);

        var nowUtc = DateTime.UtcNow;
        var monthStartNow = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        if (monthStartNow != _fixture.MonthStartUtc)
        {
            return;
        }

        Assert.Equal(9, body.EnumerateObject().Count());
        Assert.Equal(12, body.GetProperty("historical").GetArrayLength());
        Assert.Equal(12, body.GetProperty("projected").GetArrayLength());
        Assert.Equal("historical", body.GetProperty("historical")[0].GetProperty("type").GetString());
        Assert.Equal("projected", body.GetProperty("projected")[0].GetProperty("type").GetString());

        Assert.Equal(4496, body.GetProperty("currentMrr").GetInt64());
        Assert.Equal(4496, body.GetProperty("historical")[11].GetProperty("mrr").GetInt64());

        // 499 → 4496 in one step is far past the cap, so growth pins at exactly +30%/month, and the
        // twelve-month projection compounds it. Every expected number below was produced by running the
        // TS expression in Node — 4496 × 1.3^12 = 104 748.190…, so Math.round gives 104 748 — rather
        // than re-derived here, so the assertion cannot agree with a wrong reimplementation.
        Assert.Equal(30d, body.GetProperty("monthlyGrowthPct").GetDouble());
        Assert.Equal(104_748, body.GetProperty("projectedMrr12m").GetInt64());
        Assert.Equal(1_256_976, body.GetProperty("projectedArr").GetInt64());
        Assert.Equal(5845, body.GetProperty("projected")[0].GetProperty("mrr").GetInt64()); // 4496 × 1.3 = 5844.8

        // Two trialing subscriptions, valued at the starter price.
        Assert.Equal(2, body.GetProperty("pendingTrials").GetInt32());
        Assert.Equal(2 * 499, body.GetProperty("potentialMrrFromTrials").GetInt64());

        // planBreakdown is a JSON OBJECT keyed by plan, and covers ONLY plans with an active subscriber —
        // the two trialing professionals and the past-due one are absent from the professional count.
        var breakdown = body.GetProperty("planBreakdown");
        Assert.Equal(4, breakdown.EnumerateObject().Count());
        Assert.Equal(1, breakdown.GetProperty("trial").GetProperty("count").GetInt32());
        Assert.Equal(0, breakdown.GetProperty("trial").GetProperty("mrr").GetInt64());
        Assert.Equal(2, breakdown.GetProperty("starter").GetProperty("count").GetInt32());
        Assert.Equal(998, breakdown.GetProperty("starter").GetProperty("mrr").GetInt64());
        Assert.Equal(1, breakdown.GetProperty("professional").GetProperty("count").GetInt32());
        Assert.Equal(1, breakdown.GetProperty("enterprise").GetProperty("count").GetInt32());
        Assert.Equal(2499, breakdown.GetProperty("enterprise").GetProperty("mrr").GetInt64());
    }

    // ── getCustomerHealth, over the real wire ───────────────────────────────────────────────────────
    /// <summary>
    /// One row per organization — including the suspended one — banded and ordered, with the two
    /// different routes into <c>at_risk</c> both represented.
    /// </summary>
    [Fact]
    public async Task CustomerHealth_AllOrgsBandedAndOrdered_WithBothAtRiskRoutes()
    {
        var rows = await OwnerBody(CustomerHealthPath);

        // EVERY organization, with no is_active or deleted_at filter — the suspended Wayne Enterprises
        // is present, which is what the TS findMany does.
        Assert.Equal(8, rows.GetArrayLength());

        var byOrg = rows.EnumerateArray().ToDictionary(r => r.GetProperty("orgId").GetString()!);
        Assert.Contains(PlatformDashboardReadFixture.OrgF.ToString(), byOrg.Keys);

        // Bands appear in order: every critical, then every at_risk, then every healthy.
        var bands = rows.EnumerateArray().Select(r => r.GetProperty("health").GetString()).ToList();
        var rank = new Dictionary<string, int> { ["critical"] = 0, ["at_risk"] = 1, ["healthy"] = 2 };
        for (var i = 1; i < bands.Count; i++)
        {
            Assert.True(rank[bands[i - 1]!] <= rank[bands[i]!], $"band order broke at index {i}: {string.Join(",", bands)}");
        }

        Assert.Equal(5, bands.Count(b => b == "critical"));   // A and B carry overdue invoices; C, E, F have no users
        Assert.Equal(2, bands.Count(b => b == "at_risk"));
        Assert.Equal(1, bands.Count(b => b == "healthy"));

        // Acme: an overdue invoice makes it critical DESPITE a healthy 60% login rate — proving the
        // overdue clause short-circuits the band logic rather than contributing to a score.
        var acme = byOrg[PlatformDashboardReadFixture.OrgA.ToString()];
        Assert.Equal("critical", acme.GetProperty("health").GetString());
        Assert.Equal("Acme Corp", acme.GetProperty("orgName").GetString());
        Assert.Equal("trial", acme.GetProperty("plan").GetString());
        Assert.Equal(60, acme.GetProperty("signals").GetProperty("loginRate").GetInt32()); // 3 of 5
        Assert.Equal(1, acme.GetProperty("signals").GetProperty("overdueInvoices").GetInt32());
        Assert.Equal(1, acme.GetProperty("signals").GetProperty("daysSinceLastLogin").GetInt32());
        Assert.Equal(JsonValueKind.Null, acme.GetProperty("signals").GetProperty("trialDaysLeft").ValueKind);

        // Globex: 6 of 9 ACTIVE users logged in recently → 67%. The inactive Gus logged in today and must
        // NOT count; including him would give 7 of 10 = 70.
        var globex = byOrg[PlatformDashboardReadFixture.OrgB.ToString()];
        Assert.Equal(67, globex.GetProperty("signals").GetProperty("loginRate").GetInt32());

        // Umbrella: at_risk purely through the TRIAL clause — its login rate is a perfect 100.
        var umbrella = byOrg[PlatformDashboardReadFixture.OrgD.ToString()];
        Assert.Equal("at_risk", umbrella.GetProperty("health").GetString());
        Assert.Equal(100, umbrella.GetProperty("signals").GetProperty("loginRate").GetInt32());
        Assert.Equal(3, umbrella.GetProperty("signals").GetProperty("trialDaysLeft").GetInt32());

        // Hooli: at_risk purely through the LOGIN clause — its trial has 30 days left, far outside the
        // five-day rule. Two independent routes into one band, so dropping either clause fails.
        var hooli = byOrg[PlatformDashboardReadFixture.OrgG.ToString()];
        Assert.Equal("at_risk", hooli.GetProperty("health").GetString());
        Assert.Equal(25, hooli.GetProperty("signals").GetProperty("loginRate").GetInt32()); // 1 of 4
        Assert.Equal(30, hooli.GetProperty("signals").GetProperty("trialDaysLeft").GetInt32());

        // Pied Piper: the only healthy row.
        var piper = byOrg[PlatformDashboardReadFixture.OrgH.ToString()];
        Assert.Equal("healthy", piper.GetProperty("health").GetString());
        Assert.Equal("enterprise", piper.GetProperty("plan").GetString());

        // An organization with no users at all reports the 999 sentinel, not null — and that alone makes
        // it critical.
        var initech = byOrg[PlatformDashboardReadFixture.OrgC.ToString()];
        Assert.Equal(999, initech.GetProperty("signals").GetProperty("daysSinceLastLogin").GetInt32());
        Assert.Equal(0, initech.GetProperty("signals").GetProperty("loginRate").GetInt32());
        Assert.Equal("critical", initech.GetProperty("health").GetString());

        Assert.Equal(5, acme.EnumerateObject().Count());
        Assert.Equal(4, acme.GetProperty("signals").EnumerateObject().Count());
    }

    // ── getUpsellOpportunities, over the real wire ──────────────────────────────────────────────────
    [Fact]
    public async Task UpsellOpportunities_ScoredSortedAndCounted()
    {
        var body = await OwnerBody(UpsellPath);

        Assert.Equal(4, body.EnumerateObject().Count());
        var opportunities = body.GetProperty("opportunities");
        Assert.Equal(2, opportunities.GetArrayLength());

        // Sorted by mrrIncrease DESCENDING: Globex's starter→professional (+500) before Acme's
        // trial→starter (+499).
        var globex = opportunities[0];
        Assert.Equal(PlatformDashboardReadFixture.OrgB.ToString(), globex.GetProperty("orgId").GetString());
        Assert.Equal("Globex Inc", globex.GetProperty("orgName").GetString());
        Assert.Equal("starter", globex.GetProperty("currentPlan").GetString());
        Assert.Equal("professional", globex.GetProperty("targetPlan").GetString());
        Assert.Equal(500, globex.GetProperty("mrrIncrease").GetInt32());
        Assert.Equal("high", globex.GetProperty("confidence").GetString());
        // All four conditions fire (40+30+20+10 = 100), and `reason` is the FIRST of them, not a join.
        Assert.Equal("10 users (threshold: 8)", globex.GetProperty("reason").GetString());

        var signals = globex.GetProperty("signals");
        Assert.Equal(6, signals.GetProperty("activeUsers").GetInt32());
        // 10 = every user row, INCLUDING the inactive, soft-deleted Gus. The two user numbers are counted
        // by different rules on purpose; an implementation that filtered _count would report 9 here.
        Assert.Equal(10, signals.GetProperty("totalUsers").GetInt32());
        Assert.Equal(5, signals.GetProperty("features").GetInt32());   // includes the disabled flags
        Assert.Equal(3, signals.GetProperty("vacancies").GetInt32());  // includes the closed vacancy

        var acme = opportunities[1];
        Assert.Equal(PlatformDashboardReadFixture.OrgA.ToString(), acme.GetProperty("orgId").GetString());
        Assert.Equal("trial", acme.GetProperty("currentPlan").GetString());
        Assert.Equal("starter", acme.GetProperty("targetPlan").GetString());
        Assert.Equal(499, acme.GetProperty("mrrIncrease").GetInt32());
        Assert.Equal("medium", acme.GetProperty("confidence").GetString()); // 40 + 20
        Assert.Equal("5 users (threshold: 3)", acme.GetProperty("reason").GetString());

        Assert.Equal(999, body.GetProperty("totalPotentialMrr").GetInt64());
        Assert.Equal(1, body.GetProperty("highConfidence").GetInt32());
        Assert.Equal(1, body.GetProperty("mediumConfidence").GetInt32());

        // The SUSPENDED organization is excluded entirely — this read filters is_active, unlike
        // customer-health, and Wayne Enterprises is past_due anyway.
        var ids = opportunities.EnumerateArray().Select(o => o.GetProperty("orgId").GetString()).ToList();
        Assert.DoesNotContain(PlatformDashboardReadFixture.OrgF.ToString(), ids);
    }

    // ── search, over the real wire ──────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Search_MatchesOrganizationsUsersAndPages()
    {
        var body = await OwnerBody(SearchPath);

        Assert.Equal(3, body.EnumerateObject().Count());

        // One organization matches "acme" — on its NAME, and its slug and domain would match too.
        var organizations = body.GetProperty("organizations");
        Assert.Equal(1, organizations.GetArrayLength());
        Assert.Equal(PlatformDashboardReadFixture.OrgA.ToString(), organizations[0].GetProperty("id").GetString());
        Assert.Equal("Acme Corp", organizations[0].GetProperty("name").GetString());
        Assert.Equal("acme-corp", organizations[0].GetProperty("slug").GetString());
        Assert.Equal("trial", organizations[0].GetProperty("plan").GetString());
        Assert.True(organizations[0].GetProperty("isActive").GetBoolean());
        Assert.Equal(5, organizations[0].EnumerateObject().Count());

        // Four users match on their @acme.test email, ordered by FIRST NAME ascending.
        var users = body.GetProperty("users");
        Assert.Equal(4, users.GetArrayLength());
        Assert.Equal(
            ["Carlos", "Lena", "Nina", "Priya"],
            users.EnumerateArray().Select(u => u.GetProperty("firstName").GetString()));

        var carlos = users[0];
        Assert.Equal("current@acme.test", carlos.GetProperty("email").GetString());
        Assert.False(carlos.GetProperty("isPlatformOwner").GetBoolean());
        Assert.True(carlos.GetProperty("isActive").GetBoolean());
        // Both nullable fields are PRESENT: avatar is null, organization is the nested { name } object.
        Assert.Equal(JsonValueKind.Null, carlos.GetProperty("avatar").ValueKind);
        Assert.Equal("Acme Corp", carlos.GetProperty("organization").GetProperty("name").GetString());
        // `name` is the ONLY property Prisma selects on the nested relation.
        Assert.Equal("name", Assert.Single(carlos.GetProperty("organization").EnumerateObject()).Name);
        Assert.Equal(8, carlos.EnumerateObject().Count());

        Assert.Equal(0, body.GetProperty("pages").GetArrayLength());
    }

    [Fact]
    public async Task Search_forAnOrgLessUser_emits_a_NULL_organization()
    {
        var body = await OwnerBody("/platform/dashboard/search?query=Olivia");

        var users = body.GetProperty("users");
        Assert.Equal(1, users.GetArrayLength());
        Assert.Equal("owner@tims.test", users[0].GetProperty("email").GetString());
        Assert.True(users[0].GetProperty("isPlatformOwner").GetBoolean());
        // A platform owner has no organization_id, and Prisma emits `organization: null` rather than
        // omitting the key.
        Assert.Equal(JsonValueKind.Null, users[0].GetProperty("organization").ValueKind);
    }

    [Fact]
    public async Task Search_matchesStaticPages_andCapsThemAtFour()
    {
        var body = await OwnerBody("/platform/dashboard/search?query=a");

        var pages = body.GetProperty("pages");
        Assert.Equal(4, pages.GetArrayLength());
        Assert.Equal("Dashboard", pages[0].GetProperty("name").GetString());
        // The FULL static entry ships, including the internal keyword string.
        Assert.Equal(3, pages[0].EnumerateObject().Count());
        Assert.Equal("/dashboard", pages[0].GetProperty("href").GetString());
        Assert.Equal("inicio home panel", pages[0].GetProperty("keywords").GetString());

        // The row caps are independent: 5 per table, 4 for pages.
        Assert.True(body.GetProperty("organizations").GetArrayLength() <= 5);
        Assert.True(body.GetProperty("users").GetArrayLength() <= 5);
    }

    [Fact]
    public async Task Search_forAWhitespaceOnlyQuery_is200_withThreeEmptyArrays()
    {
        // "%20%20%20" is three spaces: valid under Zod's min(1), then trimmed to empty, then the early
        // return. A 400 here would mean the bound was applied to the trimmed value.
        var body = await OwnerBody("/platform/dashboard/search?query=%20%20%20");

        Assert.Equal(0, body.GetProperty("organizations").GetArrayLength());
        Assert.Equal(0, body.GetProperty("users").GetArrayLength());
        Assert.Equal(0, body.GetProperty("pages").GetArrayLength());
    }

    /// <summary>
    /// A <c>%</c> in the query matches everything, because neither stack escapes LIKE wildcards.
    ///
    /// <para>Prisma's <c>contains</c> does not escape <c>%</c> or <c>_</c>, so this is faithful rather
    /// than a defect introduced here — and escaping it in the port would be a silent behaviour change and
    /// a parity FAIL on any query containing one. Pinned so nobody "hardens" it without deciding to.</para>
    /// </summary>
    [Fact]
    public async Task Search_doesNotEscapeLikeWildcards()
    {
        var body = await OwnerBody("/platform/dashboard/search?query=%25");

        Assert.Equal(5, body.GetProperty("organizations").GetArrayLength()); // take: 5, of 8
        Assert.Equal(5, body.GetProperty("users").GetArrayLength());
        Assert.Equal(0, body.GetProperty("pages").GetArrayLength());         // no page name contains '%'
    }
}
