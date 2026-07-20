using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="TrendViewBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/trend-view.json) — the SAME cases the TS vitest
/// (tests/reporting/trend-view-fixtures.test.ts) asserts against the REAL
/// <c>buildTrendView</c>. Byte-parity across stacks for the six UTC month buckets,
/// oldest-first order, 0-indexed month, and month normalization across the year
/// boundary. A local-time port or a throwing month-arithmetic turns this CI red.
/// </summary>
public sealed class TrendViewFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "trend-view.json")))!["cases"]!.AsArray();

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
    public void TrendView_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var nowMs = input["nowMs"]!.GetValue<long>();
        var appliedAtMs = input["appliedAtMs"]!.AsArray().Select(x => x!.GetValue<long>()).ToList();

        var view = TrendViewBuilder.Build(nowMs, appliedAtMs);

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        var expected = node["expected"]!;
        Assert.True(JsonNode.DeepEquals(expected, actual), $"trend wire mismatch for '{name}': {actual.ToJsonString()}");
    }
}
