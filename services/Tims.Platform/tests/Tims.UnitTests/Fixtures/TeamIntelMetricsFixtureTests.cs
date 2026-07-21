using System.Collections.Generic;
using System.Text.Json.Nodes;
using Tims.Domain.TeamIntel;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="TeamIntelMetrics"/> to the shared goldens
/// (contracts/team-intel-fixtures/{avg-tenure-years,role-diversity}.json) — the SAME cases the TS vitest
/// (tests/team-intel/tenure-diversity-fixtures.test.ts) asserts against the REAL <c>@tims/shared</c> exports.
/// Byte-parity for the 365-day-year divisor, the 2-decimal ratio, JS half-up rounding, and distinct-non-empty
/// counting. A drift on either stack turns its CI red.
/// </summary>
public sealed class TeamIntelMetricsFixtureTests
{
    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "team-intel-fixtures", file)))!["cases"]!.AsArray();

    public static IEnumerable<object[]> TenureRows()
    {
        var cases = Cases("avg-tenure-years.json");
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    public static IEnumerable<object[]> DiversityRows()
    {
        var cases = Cases("role-diversity.json");
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(TenureRows))]
    public void AvgTenureYears_matches_golden_fixture(int index, string name)
    {
        var node = Cases("avg-tenure-years.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var createdAtMs = node["input"]!["members"]!.AsArray()
            .Select(m => m!["createdAtMs"]!.GetValue<long>())
            .ToList();
        var nowMs = node["input"]!["nowMs"]!.GetValue<long>();
        var expected = node["expected"]!.GetValue<double>();

        Assert.Equal(expected, TeamIntelMetrics.ComputeAvgTenureYears(createdAtMs, nowMs), 9);
    }

    [Theory]
    [MemberData(nameof(DiversityRows))]
    public void RoleDiversity_matches_golden_fixture(int index, string name)
    {
        var node = Cases("role-diversity.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var jobTitles = node["input"]!["members"]!.AsArray()
            .Select(m => m!["jobTitle"]?.GetValue<string>())
            .ToList();
        var expected = node["expected"]!.GetValue<double>();

        Assert.Equal(expected, TeamIntelMetrics.ComputeRoleDiversity(jobTitles), 9);
    }
}
