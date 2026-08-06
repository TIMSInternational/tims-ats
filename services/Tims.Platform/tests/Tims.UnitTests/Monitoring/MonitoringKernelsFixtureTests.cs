using System.Text.Json.Nodes;
using Tims.Domain.Monitoring;

namespace Tims.UnitTests.Monitoring;

/// <summary>
/// Pins the C# <see cref="MonitoringKernels"/> to the shared goldens
/// (contracts/monitoring-fixtures/{module-health,month-window,engagement-trend-floor}.json) — the SAME
/// cases the TS vitest (tests/monitoring/monitoring-fixtures.test.ts) asserts against the REAL
/// <c>packages/api/src/services/monitoring.service.ts</c> exports the live router calls.
///
/// One JSON, two stacks. Byte-parity for the 8-module list and its health bands, the rolling window's
/// midnight-on-the-last-day upper bound, the JS <c>setMonth</c> day-overflow, and the all-or-nothing
/// engagement floor. A drift on either stack turns its CI red.
/// </summary>
public sealed class MonitoringKernelsFixtureTests
{
    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "monitoring-fixtures", file)))!["cases"]!
            .AsArray();

    private static IEnumerable<object[]> Rows(string file)
    {
        var cases = Cases(file);
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    public static IEnumerable<object[]> ModuleHealthRows() => Rows("module-health.json");

    public static IEnumerable<object[]> MonthWindowRows() => Rows("month-window.json");

    public static IEnumerable<object[]> TrendFloorRows() => Rows("engagement-trend-floor.json");

    [Theory]
    [MemberData(nameof(ModuleHealthRows))]
    public void BuildModuleHealth_matches_golden_fixture(int index, string name)
    {
        var node = Cases("module-health.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var counts = node["input"]!["alertCountsByModule"]!.AsObject()
            .ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<int>());

        var actual = MonitoringKernels.BuildModuleHealth(counts);
        var expected = node["expected"]!.AsArray()
            .Select(e => new ModuleHealthPoint(
                e!["module"]!.GetValue<string>(),
                e["activeAlerts"]!.GetValue<int>(),
                e["status"]!.GetValue<string>()))
            .ToList();

        Assert.Equal(expected, actual);
    }

    [Theory]
    [MemberData(nameof(MonthWindowRows))]
    public void BuildMonthWindow_matches_golden_fixture(int index, string name)
    {
        var node = Cases("month-window.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var anchorNode = node["input"]!["anchor"]!;
        var anchor = new DateTime(
            anchorNode["year"]!.GetValue<int>(),
            anchorNode["month"]!.GetValue<int>(),
            anchorNode["day"]!.GetValue<int>(),
            anchorNode["hour"]!.GetValue<int>(),
            0,
            0,
            DateTimeKind.Unspecified);
        var months = node["input"]!["months"]!.GetValue<int>();

        // Both bounds are midnight, so the goldens are wall-clock DATES; compare on those, exactly as
        // the TS side reads back local components rather than an ISO instant.
        var actual = MonitoringKernels.BuildMonthWindow(anchor, months)
            .Select(w => (w.Label, Start: w.Start.ToString("yyyy-MM-dd"), End: w.End.ToString("yyyy-MM-dd")))
            .ToList();

        var expected = node["expected"]!.AsArray()
            .Select(e => (
                Label: e!["label"]!.GetValue<string>(),
                Start: e["start"]!.GetValue<string>(),
                End: e["end"]!.GetValue<string>()))
            .ToList();

        Assert.Equal(expected, actual);

        // Both bounds must be exactly midnight — the "monthEnd is NOT end-of-day" quirk the whole
        // engagement bucket depends on. Encoding it in the date strings alone would not catch a port
        // that silently used 23:59:59.999.
        Assert.All(
            MonitoringKernels.BuildMonthWindow(anchor, months),
            w =>
            {
                Assert.Equal(TimeSpan.Zero, w.Start.TimeOfDay);
                Assert.Equal(TimeSpan.Zero, w.End.TimeOfDay);
            });
    }

    [Theory]
    [MemberData(nameof(TrendFloorRows))]
    public void ApplyEngagementTrendFloor_matches_golden_fixture(int index, string name)
    {
        var node = Cases("engagement-trend-floor.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var labels = node["input"]!["labels"]!.AsArray().Select(l => l!.GetValue<string>()).ToList();
        var rawCounts = node["input"]!["rawCounts"]!.AsArray().Select(c => c!.GetValue<int>()).ToList();

        var actual = MonitoringKernels.ApplyEngagementTrendFloor(labels, rawCounts);
        var expected = node["expected"]!.AsArray()
            .Select(e => new TrendPoint(
                e!["month"]!.GetValue<string>(),
                e["value"] is null ? null : e["value"]!.GetValue<int>(),
                e["suppressed"]!.GetValue<bool>()))
            .ToList();

        Assert.Equal(expected, actual);
    }
}
