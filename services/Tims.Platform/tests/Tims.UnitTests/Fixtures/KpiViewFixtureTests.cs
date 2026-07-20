using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Reporting;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="KpiViewBuilder"/> to the shared golden
/// (contracts/reporting-fixtures/kpi-view.json) — the SAME cases the TS vitest
/// (tests/reporting/kpi-view-fixtures.test.ts) asserts against the REAL
/// <c>buildKpiView</c>. Byte-parity for non-negative-span ttf/tth, respondedAt-null
/// handling, JS half-up rounding of the accept rate + avgDays, and strictly-over
/// lost-by-delay. A drift on either stack turns its CI red.
/// </summary>
public sealed class KpiViewFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "reporting-fixtures", "kpi-view.json")))!["cases"]!.AsArray();

    private static long? NL(JsonNode? n) => n is { } v ? v.GetValue<long>() : null;
    private static double? ND(JsonNode? n) => n is { } v ? v.GetValue<double>() : null;

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++) yield return [i, cases[i]!["name"]!.GetValue<string>()];
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void KpiView_matches_golden_fixture(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var accepted = input["accepted"]!.AsArray()
            .Select(o => new KpiAcceptedOffer(NL(o!["respondedAtMs"]), o["vacancyCreatedAtMs"]!.GetValue<long>(), NL(o["appliedAtMs"])))
            .ToList();
        var rejected = input["rejected"]!.AsArray()
            .Select(r => new KpiRejectedApp(ND(r!["slaHours"]), NL(r["rejectedAtMs"]), r["appliedAtMs"]!.GetValue<long>(), NL(r["lastMovedAtMs"])))
            .ToList();

        var view = KpiViewBuilder.Build(new KpiViewInput(
            input["period"]!.GetValue<string>(),
            accepted,
            input["offersSent"]!.GetValue<int>(),
            input["offersAccepted"]!.GetValue<int>(),
            input["totalApplications"]!.GetValue<int>(),
            rejected));

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        Assert.True(JsonNode.DeepEquals(node["expected"]!, actual), $"kpi wire mismatch for '{name}': {actual.ToJsonString()}");
        Assert.False(actual.AsObject().ContainsKey("schemaVersion"));
    }
}
