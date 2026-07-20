using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="RecruiterSlaViewBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/recruiter-sla-view.json) — the SAME cases the TS vitest
/// (tests/reporting/recruiter-sla-view-fixtures.test.ts) asserts against the REAL
/// <c>buildRecruiterSlaView</c>. Byte-parity for first-seen name/order, candidate sums,
/// non-negative-span avgTtf, null-SLA exclusion + on-time boundary, and the stable
/// vacancy-descending sort. A drift on either stack turns its CI red.
/// </summary>
public sealed class RecruiterSlaViewFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "recruiter-sla-view.json")))!["cases"]!.AsArray();

    private static long? NL(JsonNode? n) => n is { } v ? v.GetValue<long>() : null;
    private static double? ND(JsonNode? n) => n is { } v ? v.GetValue<double>() : null;
    private static string? NS(JsonNode? n) => n is { } v ? v.GetValue<string>() : null;

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void RecruiterSlaView_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var vacancies = input["vacancies"]!.AsArray()
            .Select(v => new RecruiterVacancy(v!["id"]!.GetValue<string>(), v["assignedTo"]!.GetValue<string>(), NS(v["firstName"]), NS(v["lastName"])))
            .ToList();
        var appCounts = input["appCounts"]!.AsArray()
            .Select(c => new RecruiterAppCount(c!["vacancyId"]!.GetValue<string>(), c["count"]!.GetValue<int>()))
            .ToList();
        var accepted = input["accepted"]!.AsArray()
            .Select(o => new RecruiterAcceptedOffer(o!["vacancyId"]!.GetValue<string>(), NL(o["respondedAtMs"]), o["vacancyCreatedAtMs"]!.GetValue<long>()))
            .ToList();
        var active = input["active"]!.AsArray()
            .Select(a => new RecruiterActiveApp(a!["vacancyId"]!.GetValue<string>(), ND(a["slaHours"]), a["appliedAtMs"]!.GetValue<long>(), NL(a["lastMovedAtMs"])))
            .ToList();

        var view = RecruiterSlaViewBuilder.Build(new RecruiterSlaInput(
            input["nowMs"]!.GetValue<long>(), vacancies, appCounts, accepted, active));

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"recruiter-sla wire mismatch for '{name}': {actual.ToJsonString()}");
    }
}
