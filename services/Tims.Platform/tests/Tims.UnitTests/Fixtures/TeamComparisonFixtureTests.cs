using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.TeamIntel;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="TeamComparisonBuilder"/> to the shared golden
/// (contracts/team-intel-fixtures/team-comparison.json) — the SAME cases the TS vitest
/// (tests/team-intel/team-comparison-fixtures.test.ts) asserts against the REAL <c>buildTeamComparison</c>.
/// Byte-parity for input order, leader passthrough (present/null), 30-day-month half-up avgTenureMonths,
/// distinct-non-empty roles, and passthrough counts. A drift on either stack turns its CI red.
/// </summary>
public sealed class TeamComparisonFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "team-intel-fixtures", "team-comparison.json")))!["cases"]!.AsArray();

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void TeamComparison_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var teams = node["input"]!["teams"]!.AsArray()
            .Select(t => new TeamComparisonInput(
                t!["id"]!.GetValue<string>(),
                t["name"]!.GetValue<string>(),
                ParseLeader(t["leader"]),
                t["members"]!.AsArray()
                    .Select(m => new TeamComparisonMember(m!["jobTitle"]?.GetValue<string>(), m["createdAtMs"]!.GetValue<long>()))
                    .ToList(),
                t["openVacancies"]!.GetValue<int>(),
                t["activeOkrs"]!.GetValue<int>()))
            .ToList();
        var nowMs = node["input"]!["nowMs"]!.GetValue<long>();

        var view = TeamComparisonBuilder.Build(teams, nowMs);

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"team-comparison mismatch for '{name}': {actual.ToJsonString()}");
    }

    private static TeamComparisonLeader? ParseLeader(JsonNode? leader) =>
        leader is null
            ? null
            : new TeamComparisonLeader(
                leader["id"]!.GetValue<string>(),
                leader["firstName"]!.GetValue<string>(),
                leader["lastName"]!.GetValue<string>());
}
