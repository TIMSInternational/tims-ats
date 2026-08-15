using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Application.Fx;

namespace Tims.IntegrationTests.PlatformDashboard;

/// <summary>
/// Phase-5 slice 23 (issue #81, PR 3 of 3) endpoint matrix for the three FX-DERIVED dashboard reads: real
/// host, real Postgres, real <c>fx_rates</c> pin, driving the REAL HTTP pipeline through
/// PrincipalResolver + PlatformOwnerGate on every new route —
///   platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
///   flag OFF (default) → 404 (dark); and, uniquely to these three, an unresolvable rate → 503.
///
/// <para>TRAP 4 again: without this class the gate is unenforced on these three routes. The deny
/// assertions are per-ROUTE because the gate is copied into each handler and deleting it from ONE handler
/// is the realistic mistake.</para>
///
/// <para><b>This class carries the ONLY cross-currency proof in the repository for these endpoints, and
/// that is by design rather than by omission.</b> The parity harness compares against USD-only invoices,
/// so both stacks take the identity path there and rate RESOLUTION is never compared — the two stacks read
/// different providers (live Frankfurter versus the daily <c>fx_rates</c> pin), which is precisely why the
/// numbers could not be compared even in principle. What parity cannot reach, the EUR assertions below do:
/// a 2000 EUR invoice cross-rating through the USD base at <c>1/0.8 = 1.25</c> to exactly 2500, and the
/// pin's <c>as_of</c> arriving on the wire as <c>outstandingRatesAsOf</c>.</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformDashboardFxEndpointAuthTests(PlatformDashboardReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private const string KpisPath = "/platform/dashboard/kpis";
    private const string RevenuePath = "/platform/dashboard/revenue-by-customer";
    private const string ChurnPath = "/platform/dashboard/churn-risk";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-dashboard-fx-test-key" };

    private readonly PlatformDashboardReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory(Action<IServiceCollection>? overrides = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformDashboardReadEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
                overrides?.Invoke(services);
            });
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
    [InlineData(KpisPath)]
    [InlineData(RevenuePath)]
    [InlineData(ChurnPath)]
    public async Task PlatformOwner_Is200(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub))).StatusCode);
    }

    [Theory]
    [InlineData(KpisPath)]
    [InlineData(RevenuePath)]
    [InlineData(ChurnPath)]
    public async Task OrdinaryOrgUser_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, path, Mint(PlatformDashboardReadFixture.OrgUserSub))).StatusCode);
    }

    [Theory]
    [InlineData(KpisPath, null)]
    [InlineData(RevenuePath, null)]
    [InlineData(ChurnPath, null)]
    [InlineData(KpisPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(RevenuePath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(ChurnPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string path, string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, token)).StatusCode);
    }

    [Theory]
    [InlineData(KpisPath)]
    [InlineData(RevenuePath)]
    [InlineData(ChurnPath)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(path)).StatusCode);
    }

    // ── the FX failure path, which only these three routes have ──────────────────────────────────────

    [Theory]
    [InlineData(KpisPath)]
    [InlineData(RevenuePath)]
    [InlineData(ChurnPath)]
    public async Task AnUnresolvableRate_Is503_AndNotAPartialPayload(string path)
    {
        // The rate SOURCE is stubbed to the cold-start shape (every cross-currency pair unresolvable);
        // everything else — the gate, the repository, the real SQL, the response mapping — is the real
        // pipeline. Seeding an unpinned currency into the fixture instead would 503 every other test in
        // this class, so the seam is here.
        await using var factory = EnabledFactory(services =>
        {
            services.RemoveAll<IFxRateProvider>();
            services.AddScoped<IFxRateProvider, ColdStartFxRateProvider>();
        });
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));

        // 503, never a 200 carrying a zero or a suppressed key: TS's getFxRate THROWS and takes the whole
        // procedure with it, and these payloads have no shape that could express a missing total.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("fx_unavailable", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheFxFailurePath_RunsAFTERTheGate()
    {
        // Ordering matters: an ordinary org-user must not be able to distinguish "FX is down" from
        // "you are not a platform owner". With the rate source dead, the deny is still a 403.
        await using var factory = EnabledFactory(services =>
        {
            services.RemoveAll<IFxRateProvider>();
            services.AddScoped<IFxRateProvider, ColdStartFxRateProvider>();
        });
        using var client = factory.CreateClient();

        Assert.Equal(
            HttpStatusCode.Forbidden,
            (await Get(client, KpisPath, Mint(PlatformDashboardReadFixture.OrgUserSub))).StatusCode);
    }

    // ── getDashboardKpis payload ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Kpis_returnExactWireValues_includingTheCrossRatedOutstandingTotal()
    {
        var body = await OwnerBody(KpisPath);

        // The seed hangs off the month current AT SEED TIME; the endpoint windows off the month current AT
        // REQUEST TIME. A boundary between the two shifts both "this month" deltas and the previous-month
        // MRR snapshot — a legitimate skip, not a pass.
        var nowUtc = DateTime.UtcNow;
        if (new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc) != _fixture.MonthStartUtc)
        {
            return;
        }

        Assert.Equal(8, body.GetProperty("totalOrgs").GetInt32());

        // C-H were created this month; A and B five months ago.
        Assert.Equal(6, body.GetProperty("totalOrgsChange").GetInt32());

        // 23 of the 24 seeded users are active (UserGhost is not), and the org-less platform owner counts.
        Assert.Equal(23, body.GetProperty("totalUsers").GetInt32());

        // Of those, four were created this month: UserCurrent, UserLater, UserSecondOwner, UserNewest.
        // UserGhost is inside the window too but INACTIVE, so an implementation that dropped the is_active
        // predicate from the delta would report 5.
        Assert.Equal(4, body.GetProperty("totalUsersChange").GetInt32());

        // ACTIVE subscriptions: A trial 0 + B starter 499 + C starter 499 + E professional 999 +
        // H enterprise 2499. D and G are trialing and F is past_due, so none of the three counts.
        Assert.Equal(4496, body.GetProperty("mrr").GetInt64());

        // Of those five, only A and B existed before this month began.
        Assert.Equal(499, body.GetProperty("mrrPrevMonth").GetInt64());

        Assert.Equal(2, body.GetProperty("activeTrials").GetInt32());

        // D's trial ends in 3 days (inside the window); G's in 30 (outside).
        Assert.Equal(1, body.GetProperty("trialsExpiringThisWeek").GetInt32());

        // Two overdue invoices — the pending-but-in-date one and the paid one are decoys.
        Assert.Equal(2, body.GetProperty("overdueInvoices").GetInt32());

        // THE CROSS-RATE. 1234.5 USD converts at identity; 2000 EUR cross-rates through the USD base at
        // 1/0.8 = 1.25 → 2500. Each row is roundMoney'd BEFORE the sum, then the total once more.
        Assert.Equal(3734.5, body.GetProperty("outstandingAmount").GetDouble());
        Assert.Equal("USD", body.GetProperty("currency").GetString());
        Assert.True(body.GetProperty("outstandingConverted").GetBoolean());

        // The pin's own effective date, threaded from fx_rates.as_of — the earliest NON-IDENTITY leg. The
        // USD rows contribute no date, which is why a single pin decides this value.
        Assert.Equal(PlatformDashboardReadFixture.FxPinAsOf, body.GetProperty("outstandingRatesAsOf").GetString());
    }

    // ── getRevenueByCustomer payload ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RevenueByCustomer_bucketsInvoicesExactlyAndSortsByMrrDescending()
    {
        var body = await OwnerBody(RevenuePath);

        Assert.Equal(8, body.GetArrayLength());

        var rows = body.EnumerateArray().ToList();
        var mrrs = rows.Select(r => r.GetProperty("mrr").GetInt32()).ToList();
        Assert.Equal(mrrs.OrderByDescending(m => m), mrrs);
        Assert.Equal(2499, mrrs[0]);

        var acme = rows.Single(r => r.GetProperty("orgName").GetString() == "Acme Corp");

        // Paid bucket: ONLY the 750 invoice paid ten days ago. The 999 paid forty days ago is outside the
        // window, the 321 is paid with a NULL paid_at, and the 555 is void — three different reasons to be
        // excluded, and each one is a separate mutation this number kills.
        Assert.Equal(750, acme.GetProperty("paidLast30d").GetDouble());

        // Outstanding bucket: pending OR draft, with NO date filter — 1234.5 (overdue) + 500 (not yet due)
        // + 100 (draft). An implementation that reused the overdue predicate reports 1234.5.
        Assert.Equal(1834.5, acme.GetProperty("outstandingAmount").GetDouble());
        Assert.False(acme.GetProperty("converted").GetBoolean());
        Assert.Equal(5, acme.GetProperty("userCount").GetInt32());
        Assert.Equal("trial", acme.GetProperty("plan").GetString());
        Assert.Equal(0, acme.GetProperty("mrr").GetInt32());

        var globex = rows.Single(r => r.GetProperty("orgName").GetString() == "Globex Inc");
        Assert.Equal(0, globex.GetProperty("paidLast30d").GetDouble());
        Assert.Equal(2500, globex.GetProperty("outstandingAmount").GetDouble());

        // The OR across both buckets: Globex's paid bucket is empty and its outstanding one is EUR.
        Assert.True(globex.GetProperty("converted").GetBoolean());
        Assert.Equal(9, globex.GetProperty("userCount").GetInt32());
    }

    [Fact]
    public async Task RevenueByCustomer_emitsLastActiveAt_inTheNodeIsoShape()
    {
        var body = await OwnerBody(RevenuePath);
        var acme = body.EnumerateArray().Single(r => r.GetProperty("orgName").GetString() == "Acme Corp");

        // TRAP 6: superjson serialises a Date with toISOString() — always a trailing Z, always 3-digit
        // milliseconds. Npgsql hands back DateTimeKind.Unspecified, so without the NodeIso converter this
        // is "…T12:34:56" with no zone and no ms, and the endpoint fails parity on its very first row.
        var lastActive = acme.GetProperty("lastActiveAt").GetString();
        Assert.NotNull(lastActive);
        Assert.EndsWith("Z", lastActive, StringComparison.Ordinal);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", lastActive);

        // Value, not just format: the most recent login among Acme's ACTIVE users is one day before seed.
        Assert.Equal(
            _fixture.SeedNowUtc.AddDays(-1).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
            lastActive);
    }

    [Fact]
    public async Task RevenueByCustomer_emitsNullLastActiveAt_forAnOrganizationWithNoLogins()
    {
        var body = await OwnerBody(RevenuePath);

        // Initech has no users at all, so the reduce's null seed survives — and the key must be PRESENT
        // and null rather than absent, because superjson renders a written-undefined property as null.
        var initech = body.EnumerateArray().Single(r => r.GetProperty("orgName").GetString() == "Initech");
        Assert.Equal(JsonValueKind.Null, initech.GetProperty("lastActiveAt").ValueKind);
        Assert.Equal(0, initech.GetProperty("userCount").GetInt32());
        Assert.Equal(0, initech.GetProperty("outstandingAmount").GetDouble());
        Assert.False(initech.GetProperty("converted").GetBoolean());
    }

    // ── getChurnRisk payload ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ChurnRisk_scoresEveryOrganisationAndOrdersWorstFirst()
    {
        var body = await OwnerBody(ChurnPath);
        var orgs = body.GetProperty("organizations").EnumerateArray().ToList();

        Assert.Equal(8, orgs.Count);

        var scores = orgs.Select(o => o.GetProperty("healthScore").GetInt32()).ToList();
        Assert.Equal(scores.OrderBy(s => s), scores);

        // Every score is the sum of its own five signals — the assembly invariant, which holds whatever
        // the tenure band happens to be on the day the suite runs (see the summary test).
        foreach (var org in orgs)
        {
            var signals = org.GetProperty("signals");
            Assert.Equal(
                signals.GetProperty("loginScore").GetInt32()
                    + signals.GetProperty("invoiceScore").GetInt32()
                    + signals.GetProperty("recencyScore").GetInt32()
                    + signals.GetProperty("adoptionScore").GetInt32()
                    + signals.GetProperty("tenureScore").GetInt32(),
                org.GetProperty("healthScore").GetInt32());
        }

        // The three tenant-less organizations score worst and lead the list.
        Assert.Equal(
            new HashSet<string> { "Initech", "Stark Industries", "Wayne Enterprises" },
            orgs.Take(3).Select(o => o.GetProperty("orgName").GetString()!).ToHashSet());
    }

    [Fact]
    public async Task ChurnRisk_putsTheCrossRatedTotalIntoTheRiskDescriptionAsWellAsTheNumber()
    {
        var body = await OwnerBody(ChurnPath);
        var globex = body.GetProperty("organizations").EnumerateArray()
            .Single(o => o.GetProperty("orgName").GetString() == "Globex Inc");

        // 2000 EUR → 2500 USD, and the SAME converted number reaches the wire twice: once as a JSON number
        // and once formatted into English prose by toLocaleString(). A port that converted only the
        // numeric field would leave "USD 2,000" in the description.
        Assert.Equal(2500, globex.GetProperty("overdueAmount").GetDouble());
        Assert.True(globex.GetProperty("overdueAmountConverted").GetBoolean());
        Assert.Equal("USD", globex.GetProperty("currency").GetString());
        Assert.Equal(
            "1 overdue invoice (USD 2,500)",
            globex.GetProperty("risks")[0].GetString());
        Assert.Equal("send_dunning", globex.GetProperty("actions")[0].GetString());
        Assert.Equal("1 overdue invoice (USD 2,500)", globex.GetProperty("primaryRisk").GetString());

        // 6 of Globex's 9 active users logged in within the week → 0.6667, rounded half-up to 67.
        Assert.Equal(67, globex.GetProperty("loginRate").GetInt32());
        Assert.Equal(9, globex.GetProperty("totalUsers").GetInt32());
        Assert.Equal(1, globex.GetProperty("overdueInvoices").GetInt32());
        Assert.Equal(5, globex.GetProperty("featureCount").GetInt32());
        Assert.Equal(1, globex.GetProperty("daysSinceLastLogin").GetInt32());
        Assert.Equal(499, globex.GetProperty("mrr").GetInt32());
        Assert.Equal("starter", globex.GetProperty("plan").GetString());
    }

    [Fact]
    public async Task ChurnRisk_reportsAnIdentityOnlyOverdueTotalAsUnconverted()
    {
        var body = await OwnerBody(ChurnPath);
        var acme = body.GetProperty("organizations").EnumerateArray()
            .Single(o => o.GetProperty("orgName").GetString() == "Acme Corp");

        Assert.Equal(1234.5, acme.GetProperty("overdueAmount").GetDouble());
        Assert.False(acme.GetProperty("overdueAmountConverted").GetBoolean());
        Assert.Equal("1 overdue invoice (USD 1,234.5)", acme.GetProperty("risks")[0].GetString());

        // Acme's only overdue invoice is the pending one three days past due; the draft, the void and the
        // two paid rows are all invisible to this read.
        Assert.Equal(1, acme.GetProperty("overdueInvoices").GetInt32());
        Assert.Equal(60, acme.GetProperty("loginRate").GetInt32());
        Assert.Equal(5, acme.GetProperty("totalUsers").GetInt32());
    }

    [Fact]
    public async Task ChurnRisk_reportsTheNeverLoggedInSentinelAsNull()
    {
        var body = await OwnerBody(ChurnPath);
        var initech = body.GetProperty("organizations").EnumerateArray()
            .Single(o => o.GetProperty("orgName").GetString() == "Initech");

        Assert.Equal(JsonValueKind.Null, initech.GetProperty("daysSinceLastLogin").ValueKind);
        Assert.Equal(0, initech.GetProperty("totalUsers").GetInt32());
        Assert.Contains("No login in 999 days", initech.GetProperty("risks").EnumerateArray().Select(r => r.GetString()));

        // No overdue invoice at all → the FX sum is over an empty row set: zero, unconverted.
        Assert.Equal(0, initech.GetProperty("overdueAmount").GetDouble());
        Assert.False(initech.GetProperty("overdueAmountConverted").GetBoolean());
    }

    [Fact]
    public async Task ChurnRisk_summarisesTheBandsAndSumsAtRiskMrrOverRedOnly()
    {
        var body = await OwnerBody(ChurnPath);
        var summary = body.GetProperty("summary");

        // The exact SCORES move by a few points with the day of the month — every organization's tenure
        // band depends on how far into the month the suite runs — but no organization is within that
        // margin of a band edge, so the BANDS are stable. The scoring boundaries themselves are pinned
        // exactly, with an injected clock, in ChurnRiskKernelTests.
        Assert.Equal(3, summary.GetProperty("green").GetInt32());   // Globex, Umbrella, Pied Piper
        Assert.Equal(2, summary.GetProperty("yellow").GetInt32());  // Acme, Hooli
        Assert.Equal(3, summary.GetProperty("red").GetInt32());     // the three with no users
        Assert.Equal(8, summary.GetProperty("total").GetInt32());

        // RED tier only, and only ACTIVE subscriptions inside it: Initech starter 499 + Stark professional
        // 999. Wayne is past_due, so its professional price does not count.
        Assert.Equal(1498, summary.GetProperty("atRiskMrr").GetInt64());
    }

    /// <summary>An <see cref="IFxRateProvider"/> in the COLD-START shape: identity pairs resolve (as the
    /// real provider does without touching the database), every cross-currency pair is unresolvable.</summary>
    private sealed class ColdStartFxRateProvider : IFxRateProvider
    {
        public Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken) =>
            Task.FromResult(string.Equals(from, to, StringComparison.Ordinal)
                ? new FxPin(1.0, null, Identity: true)
                : null);
    }
}
