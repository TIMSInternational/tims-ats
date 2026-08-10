using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Tims.Api.AlertMetrics;
using Tims.Domain.AlertMetrics;

namespace Tims.IntegrationTests.Monitoring;

/// <summary>
/// §8 Q0b slice 2 (issue #172) — the cross-org alert-metric surface against a real host, real Postgres
/// and real RLS. Reuses <see cref="MonitoringReadFixture"/>, whose seed already contains exactly the
/// shape this needs: OrgA has 3 pending adjustments (SUB-FLOOR), OrgB has 5 (AT the floor), OrgC is empty.
///
/// <para><b>The RLS proof here is real, not a Postgres axiom.</b> The previous attempt at this slice
/// (PR #141) read cross-org UNSCOPED and relied on the login role being BYPASSRLS — under a fixture that
/// connects as <c>postgres</c> (SUPERUSER) that "proof" only demonstrated that superusers bypass RLS,
/// which is true of every Postgres install and says nothing about production. This implementation runs
/// every read inside <c>TenantScope</c>, which issues <c>SET LOCAL ROLE app_tenant</c> — and app_tenant is
/// created <c>NOLOGIN NOBYPASSRLS</c> by the fixture. RLS applies to the CURRENT role, not the login role,
/// so once that SET ROLE runs the query is genuinely subject to the fail-closed <c>tenant_isolation</c>
/// policy even though the connection was opened as a superuser. The cross-org rows below therefore prove
/// scoping, not privilege.</para>
/// </summary>
[Collection("MonitoringRead")]
public sealed class AlertMetricsEndpointTests(MonitoringReadFixture fixture)
{
    private const string Path = "/internal/alert-metrics";
    private const string Secret = "test-cron-secret-value";

    private readonly MonitoringReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory(string? secret = Secret) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AlertMetricsCronReadEnabled", "true");
            if (secret is not null)
            {
                builder.UseSetting("Platform:AlertMetricsCronSecret", secret);
            }
        });

    // Flag left at its DEFAULT (false). Placeholder DB — a 404 never opens a connection.
    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

    private static HttpClient WithSecret(WebApplicationFactory<Program> factory, string? secret)
    {
        var client = factory.CreateClient();
        if (secret is not null)
        {
            client.DefaultRequestHeaders.Add(CronCallerGate.HeaderName, secret);
        }

        return client;
    }

    private static string Url(Guid org, string metric) => $"{Path}?organizationId={org}&metric={metric}";

    private sealed record MetricResponse(string Metric, Guid OrganizationId, string Status, int? Value, string? Reason);

    private static async Task<MetricResponse> ReadAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MetricResponse>(
            new JsonSerializerOptions(JsonSerializerDefaults.Web)))!;
    }

    // ── Dark by default ──────────────────────────────────────────────────────

    [Fact]
    public async Task Flag_off_is_the_default_and_the_route_does_not_exist()
    {
        using var factory = DarkFactory();
        using var client = WithSecret(factory, Secret);

        var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── The secret IS the authorization boundary ─────────────────────────────

    [Fact]
    public async Task No_secret_header_is_401()
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, null);

        var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("wrong-secret")]
    [InlineData("")]
    [InlineData("test-cron-secret-valu")]   // one char short — the length must not be a timing oracle
    [InlineData("test-cron-secret-valueX")] // one char long
    public async Task A_wrong_secret_is_401(string presented)
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, presented);

        var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task An_unconfigured_secret_refuses_everything_rather_than_admitting_everything()
    {
        // The fail-open version of this ("no secret configured means no check") is how anonymous
        // cross-org readers ship. Enabling the flag without setting the secret must be inert, not open.
        using var factory = EnabledFactory(secret: null);
        using var client = WithSecret(factory, Secret);

        var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Auth_is_checked_before_input_validation()
    {
        // A malformed request from an unauthenticated caller must look identical to a well-formed one,
        // or the 400/401 split becomes a probe for what the surface accepts.
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, "wrong-secret");

        var response = await client.GetAsync($"{Path}?organizationId=not-a-guid&metric=nonsense");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Input validation, once authenticated ─────────────────────────────────

    [Theory]
    [InlineData("headcount")]              // a REAL ALERT_METRIC_KEY this surface deliberately does not serve
    [InlineData("active_alerts")]
    [InlineData("sla_active_breaches")]
    [InlineData("vacancies_open_60d")]
    [InlineData("ACTIVE_SURVEYS")]         // case is exact
    [InlineData("not_a_metric")]
    public async Task An_unserved_metric_is_400_not_a_fabricated_number(string metric)
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, metric));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_missing_organization_is_400()
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var response = await client.GetAsync($"{Path}?metric={AlertMetricKeys.ActiveSurveys}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Cross-org correctness + the §21 floor, end to end over the wire ──────

    [Fact]
    public async Task OrgA_pending_adjustments_are_sub_floor_and_come_back_suppressed_with_no_number()
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var body = await ReadAsync(await client.GetAsync(
            Url(MonitoringReadFixture.OrgA, AlertMetricKeys.PendingSalaryAdjustments)));

        Assert.Equal("suppressed", body.Status);
        Assert.Null(body.Value); // the count (3) must not be recoverable from the wire at all
    }

    [Fact]
    public async Task OrgB_pending_adjustments_sit_at_the_floor_and_come_back_as_a_value()
    {
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var body = await ReadAsync(await client.GetAsync(
            Url(MonitoringReadFixture.OrgB, AlertMetricKeys.PendingSalaryAdjustments)));

        Assert.Equal("value", body.Status);
        Assert.Equal(MonitoringReadFixture.OrgBPendingAdjustments, body.Value);
    }

    [Fact]
    public async Task The_same_metric_returns_each_orgs_OWN_number_across_orgs()
    {
        // THE cross-org assertion. One caller, one credential, three organizations, three different
        // answers — and OrgA's answer is not OrgB's, nor the union of both. A reader that leaked across
        // orgs would return the same (or a summed) value here.
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var a = await ReadAsync(await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys)));
        var b = await ReadAsync(await client.GetAsync(Url(MonitoringReadFixture.OrgB, AlertMetricKeys.ActiveSurveys)));
        var c = await ReadAsync(await client.GetAsync(Url(MonitoringReadFixture.OrgC, AlertMetricKeys.ActiveSurveys)));

        Assert.Equal(MonitoringReadFixture.OrgAActiveSurveys, a.Value);
        Assert.Equal(MonitoringReadFixture.OrgA, a.OrganizationId);

        // OrgB and the EMPTY OrgC both have no active surveys — an honest 0, never a null or an error.
        Assert.Equal("value", b.Status);
        Assert.Equal("value", c.Status);
        Assert.Equal(0, c.Value);

        // And the sub-floor org's count did not bleed into the org that is at the floor.
        Assert.NotEqual(a.Value, c.Value);
    }

    [Fact]
    public async Task An_empty_org_returns_an_honest_zero_not_an_error()
    {
        // The failure mode this pins: if the read were silently returning nothing (e.g. RLS filtering
        // everything because the GUC never got set), EVERY org would look like OrgC. The test above is
        // what distinguishes "correctly zero" from "silently zero" — this one just fixes the baseline.
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var body = await ReadAsync(await client.GetAsync(
            Url(MonitoringReadFixture.OrgC, AlertMetricKeys.PendingSalaryAdjustments)));

        Assert.Equal("value", body.Status);
        Assert.Equal(0, body.Value);
    }

    [Fact]
    public async Task The_response_echoes_the_metric_and_org_it_answered_for()
    {
        // The cron issues one request per (org, metric) across the whole platform. A response that did
        // not identify what it answered would make a mis-routed reply undetectable.
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        var body = await ReadAsync(await client.GetAsync(
            Url(MonitoringReadFixture.OrgB, AlertMetricKeys.PendingSalaryAdjustments)));

        Assert.Equal(AlertMetricKeys.PendingSalaryAdjustments, body.Metric);
        Assert.Equal(MonitoringReadFixture.OrgB, body.OrganizationId);
    }

    // ── The rate limiter must not throttle the surface's only caller ─────────

    [Fact]
    public async Task The_cron_can_issue_many_requests_without_being_rate_limited()
    {
        // The endpoint is ANONYMOUS (the secret is its credential), so without an exemption the limiter
        // keys it by IP and the cron throttles ITSELF partway through a platform-wide run — after which
        // every remaining metric silently stops evaluating. The anonymous query quota is well under 60.
        using var factory = EnabledFactory();
        using var client = WithSecret(factory, Secret);

        for (var i = 0; i < 60; i++)
        {
            var response = await client.GetAsync(Url(MonitoringReadFixture.OrgA, AlertMetricKeys.ActiveSurveys));
            Assert.NotEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        }
    }
}
