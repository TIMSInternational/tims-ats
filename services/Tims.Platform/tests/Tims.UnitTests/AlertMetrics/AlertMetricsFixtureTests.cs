using System.Text.Json.Nodes;
using Tims.Application.AlertMetrics;
using Tims.Application.Audit;
using Tims.Domain.AlertMetrics;

namespace Tims.UnitTests.AlertMetrics;

/// <summary>
/// Pins the cross-org alert-metric surface to the shared goldens
/// (contracts/alert-metrics-fixtures/cases.json) — the SAME file the TS vitest
/// (tests/monitoring/alert-metrics-fixtures.test.ts) asserts against the REAL
/// <c>applyAlertMetricFloor</c> / <c>isSensitiveAlertMetric</c> the cron calls.
///
/// #172. What must not diverge is the §21 min-5 floor AND which metrics it applies to. An alert RULE is
/// an exact-count oracle, so if C# stops flooring <c>pending_salary_adjustments</c> a rule
/// <c>metric eq 3</c> silently recovers a sub-floor count over a restricted population; and if C# starts
/// flooring <c>active_surveys</c>, alerting silently dies for every org with fewer than five active
/// surveys. Both directions are invisible in production, which is why they are pinned rather than
/// eyeballed.
/// </summary>
public sealed class AlertMetricsFixtureTests
{
    private static JsonNode Fixture() =>
        JsonNode.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "alert-metrics-fixtures", "cases.json")))!;

    private static JsonArray Section(string key) => Fixture()[key]!.AsArray();

    public static IEnumerable<object[]> FloorRows() => Rows("floor");

    public static IEnumerable<object[]> SensitivityRows() => Rows("sensitivity");

    public static IEnumerable<object[]> MetricKeyRows() => Rows("metricKeys");

    private static IEnumerable<object[]> Rows(string key)
    {
        var arr = Section(key);
        for (var i = 0; i < arr.Count; i++)
        {
            yield return [i, arr[i]!["name"]!.GetValue<string>()];
        }
    }

    /// <summary>
    /// The floor, end to end, through the REAL <see cref="AlertMetricsReadUseCase"/> — the code the
    /// endpoint runs — with only the repository and the audit writer stubbed.
    ///
    /// <para>An earlier version of this test reproduced the composition inline
    /// (<c>IsSensitive(metric) ? SuppressBelowMin5(raw).Count : raw</c>). A review panel pointed out that
    /// this made the shared golden non-binding on one of the two stacks it exists to bind: mutating the
    /// use case to floor everything, or nothing, left this file GREEN. The TS twin explicitly asserts its
    /// live exports, so the C# side must too — otherwise the anti-divergence control only watches one
    /// side of the divergence. Same lesson as deriving a guard's scope from the artifact under test.</para>
    /// </summary>
    [Theory]
    [MemberData(nameof(FloorRows))]
    public async Task Floor_matches_golden(int index, string name)
    {
        var c = Section("floor")[index]!;
        Assert.True(AlertMetricKeys.TryParse(c["metric"]!.GetValue<string>(), out var metric));

        var raw = c["raw"]!.GetValue<int>();
        var useCase = new AlertMetricsReadUseCase(new FixedCountRepository(raw), new NullSecurityEventWriter());

        var outcome = await useCase.ComputeAsync(Guid.NewGuid(), metric, default);

        if (c["expectedStatus"]!.GetValue<string>() == "suppressed")
        {
            Assert.IsType<AlertMetricOutcome.Suppressed>(outcome);
        }
        else
        {
            Assert.Equal(c["expectedValue"]!.GetValue<int>(), Assert.IsType<AlertMetricOutcome.Value>(outcome).Count);
        }

        _ = name;
    }

    /// <summary>Returns the same count for either metric, so one fixture row drives whichever is named.</summary>
    private sealed class FixedCountRepository(int count) : IAlertMetricsReadRepository
    {
        public Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(count);

        public Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult(count);
    }

    private sealed class NullSecurityEventWriter : ISecurityEventWriter
    {
        public Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }

    [Theory]
    [MemberData(nameof(SensitivityRows))]
    public void IsSensitive_matches_golden(int index, string name)
    {
        var c = Section("sensitivity")[index]!;
        Assert.True(AlertMetricKeys.TryParse(c["metric"]!.GetValue<string>(), out var metric));
        Assert.Equal(c["sensitive"]!.GetValue<bool>(), AlertMetricKeys.IsSensitive(metric));
        _ = name;
    }

    /// <summary>
    /// The fail-closed parse. The rows that matter most are the four REAL <c>ALERT_METRIC_KEYS</c> this
    /// surface deliberately does not serve: adding one to the enum without a reader would make it parse
    /// here and then fall to the use case's <c>_ => null</c> Unavailable branch, and this test is what
    /// forces that to be a deliberate fixture edit rather than an accident.
    /// </summary>
    [Theory]
    [MemberData(nameof(MetricKeyRows))]
    public void TryParse_matches_golden(int index, string name)
    {
        var c = Section("metricKeys")[index]!;
        var input = c["input"]?.GetValue<string>();
        Assert.Equal(c["valid"]!.GetValue<bool>(), AlertMetricKeys.TryParse(input, out _));
        _ = name;
    }

    /// <summary>
    /// The served set is EXACTLY the fixture's — not merely a superset. A metric added to
    /// <see cref="AlertMetricKeys.All"/> without a golden row would otherwise inherit whatever the
    /// sensitivity default happens to be, unasserted, which is precisely how an unfloored restricted
    /// count reaches the wire.
    /// </summary>
    [Fact]
    public void Served_metrics_are_exactly_the_golden_set()
    {
        var expected = Section("servedMetrics").Select(n => n!.GetValue<string>()).OrderBy(s => s).ToArray();
        Assert.Equal(expected, AlertMetricKeys.All.OrderBy(s => s).ToArray());

        // And every served key must round-trip through the wire form the TS `condition.metric` supplies.
        foreach (var key in AlertMetricKeys.All)
        {
            Assert.True(AlertMetricKeys.TryParse(key, out var parsed));
            Assert.Equal(key, AlertMetricKeys.ToKey(parsed));
        }
    }

    [Fact]
    public void Fixture_sections_are_not_empty()
    {
        // Floor guards: every assertion above is a quantifier over a section, so an emptied fixture
        // would leave this file green while asserting nothing.
        Assert.True(Section("floor").Count >= 9);
        Assert.True(Section("sensitivity").Count >= 2);
        Assert.True(Section("metricKeys").Count >= 10);
        Assert.True(Section("servedMetrics").Count >= 2);

        // Sentinels, not bare counts: the two boundary rows that carry the whole oracle guard must be
        // present by NAME. A fixture padded back to nine rows with harmless cases would pass a count.
        var floor = Section("floor");
        Assert.Contains(floor, r =>
            r!["metric"]!.GetValue<string>() == AlertMetricKeys.PendingSalaryAdjustments
            && r["raw"]!.GetValue<int>() == 4
            && r["expectedStatus"]!.GetValue<string>() == "suppressed");
        Assert.Contains(floor, r =>
            r!["metric"]!.GetValue<string>() == AlertMetricKeys.PendingSalaryAdjustments
            && r["raw"]!.GetValue<int>() == 5
            && r["expectedStatus"]!.GetValue<string>() == "value");
        Assert.Contains(floor, r =>
            r!["metric"]!.GetValue<string>() == AlertMetricKeys.ActiveSurveys
            && r["raw"]!.GetValue<int>() == 1
            && r["expectedStatus"]!.GetValue<string>() == "value");
    }
}
