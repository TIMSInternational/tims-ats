using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="LostByDelayViewBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/lost-by-delay-view.json) — the SAME cases the TS vitest
/// (tests/reporting/lost-by-delay-view-fixtures.test.ts) asserts against the REAL
/// <c>buildLostByDelayView</c>. Byte-parity for group-by-name, first-seen SLA,
/// strictly-over boundary, half-up day rounding, and stable lostCount-descending sort.
/// A drift on either stack turns its CI red.
/// </summary>
public sealed class LostByDelayViewFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "lost-by-delay-view.json")))!["cases"]!.AsArray();

    private static long? NL(JsonNode? n) => n is { } v ? v.GetValue<long>() : null;
    private static double? ND(JsonNode? n) => n is { } v ? v.GetValue<double>() : null;

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void LostByDelayView_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var rejected = node["input"]!["rejected"]!.AsArray()
            .Select(r => new LostByDelayApp(
                r!["stageName"]!.GetValue<string>(),
                ND(r["slaHours"]),
                NL(r["rejectedAtMs"]),
                r["appliedAtMs"]!.GetValue<long>(),
                NL(r["lastMovedAtMs"])))
            .ToList();

        var view = LostByDelayViewBuilder.Build(rejected);

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"lost-by-delay wire mismatch for '{name}': {actual.ToJsonString()}");
    }
}
