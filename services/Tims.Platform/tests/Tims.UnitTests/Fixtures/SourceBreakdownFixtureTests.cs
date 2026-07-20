using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="SourceBreakdownBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/source-breakdown.json) — the SAME cases the TS vitest
/// (tests/reporting/source-breakdown-fixtures.test.ts) asserts against the REAL
/// <c>buildSourceBreakdown</c>. Byte-parity for the stable descending sort, top-6 slice,
/// and hires-by-source join. A drift on either stack turns its CI red.
/// </summary>
public sealed class SourceBreakdownFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "source-breakdown.json")))!["cases"]!.AsArray();

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void SourceBreakdown_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var apps = input["apps"]!.AsArray()
            .Select(a => new SourceApplications(a!["source"]!.GetValue<string>(), a["applications"]!.GetValue<int>()))
            .ToList();
        var hireSources = input["hireSources"]!.AsArray().Select(s => s!.GetValue<string>()).ToList();

        var view = SourceBreakdownBuilder.Build(apps, hireSources);

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"source-breakdown wire mismatch for '{name}': {actual.ToJsonString()}");
    }
}
