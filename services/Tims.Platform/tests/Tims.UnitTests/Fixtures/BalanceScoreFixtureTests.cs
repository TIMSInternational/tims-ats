using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.TeamIntel;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="BalanceScoreBuilder"/> to the shared golden
/// (contracts/team-intel-fixtures/balance-score.json) — the SAME cases the TS vitest
/// (tests/team-intel/balance-score-fixtures.test.ts) asserts against the REAL <c>buildBalanceScore</c>.
/// Byte-parity for 30-day months, the integer-percent roleDiversity, JS half-up rounding, the sizeScore
/// piecewise, and empty-team behavior. A drift on either stack turns its CI red.
/// </summary>
public sealed class BalanceScoreFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "team-intel-fixtures", "balance-score.json")))!["cases"]!.AsArray();

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void BalanceScore_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var members = node["input"]!["members"]!.AsArray()
            .Select(m => new BalanceScoreMember(m!["jobTitle"]?.GetValue<string>(), m["createdAtMs"]!.GetValue<long>()))
            .ToList();
        var nowMs = node["input"]!["nowMs"]!.GetValue<long>();

        var view = BalanceScoreBuilder.Build(members, nowMs);

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"balance-score mismatch for '{name}': {actual.ToJsonString()}");
        Assert.False(actual.AsObject().ContainsKey("schemaVersion"));
    }
}
