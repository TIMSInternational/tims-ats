using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="FunnelViewBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/funnel-view.json) — the SAME cases the TS vitest
/// (tests/reporting/funnel-view-fixtures.test.ts) asserts against the REAL
/// <c>buildFunnelView</c>. Byte-parity across stacks for merge-by-name, order sort,
/// JS half-up rounding of pctOfMax, and the 1-decimal/null conversionPct. A behavior
/// drift on either stack turns its CI red.
/// </summary>
public sealed class FunnelViewFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "funnel-view.json")))!["cases"]!.AsArray();

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void FunnelView_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var stages = input["stages"]!.AsArray()
            .Select(s => new FunnelStageInput(s!["id"]!.GetValue<string>(), s["name"]!.GetValue<string>(), s["order"]!.GetValue<int>()))
            .ToList();
        var counts = input["counts"]!.AsArray()
            .Select(c => new FunnelCountInput(c!["stageId"]!.GetValue<string>(), c["count"]!.GetValue<int>()))
            .ToList();

        var view = FunnelViewBuilder.Build(
            stages,
            counts,
            input["totalApplications"]!.GetValue<int>(),
            input["totalHired"]!.GetValue<int>());

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        var expected = node["expected"]!;
        Assert.True(JsonNode.DeepEquals(expected, actual), $"funnel wire mismatch for '{name}': {actual.ToJsonString()}");
        // INTERNAL read = raw view shape, no schemaVersion.
        Assert.False(actual.AsObject().ContainsKey("schemaVersion"));
    }
}
