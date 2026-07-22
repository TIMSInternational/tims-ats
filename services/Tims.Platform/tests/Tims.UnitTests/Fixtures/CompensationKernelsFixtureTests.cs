using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Compensation;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the two C# <see cref="CompensationKernels"/> to the shared goldens
/// (contracts/compensation-fixtures/*.json) — the SAME cases the TS vitest (tests/compensation/*-fixtures.test.ts)
/// asserts against the REAL @tims/shared exports. Byte-parity for the compa-ratio 6-bucket min-5 distribution
/// (positive-salary bucketing, contributor-count avg floor JS half-up, all-or-nothing empty distribution,
/// totalEmployees == positiveCount, 0-population non-suppressed empty) and the benefits-utilization half-up /
/// no-users / NO-min-5 rules. A drift on either stack turns its CI red.
/// </summary>
public sealed class CompensationKernelsFixtureTests
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "compensation-fixtures", file)))!
            ["cases"]!.AsArray();

    private static IEnumerable<object[]> RowsOf(string file)
    {
        var cases = Cases(file);
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [file, i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    private static void AssertCase(string file, int index, string name, Func<JsonNode, object> run)
    {
        var node = Cases(file)[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());
        var actual = JsonSerializer.SerializeToNode(run(node["input"]!), WireOptions)!;
        Assert.True(
            JsonNode.DeepEquals(node["expected"]!, actual),
            $"{file} mismatch for '{name}': {actual.ToJsonString()}");
    }

    private static T Deser<T>(JsonNode node) => node.Deserialize<T>(ReadOptions)!;

    public static IEnumerable<object[]> CompaRatioRows() => RowsOf("compa-ratio-distribution.json");

    [Theory]
    [MemberData(nameof(CompaRatioRows))]
    public void CompaRatioDistribution_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            CompensationKernels.BuildCompaRatioDistribution(Deser<List<CompaRatioRow>>(input["rows"]!)));

    public static IEnumerable<object[]> BenefitsRows() => RowsOf("benefits-utilization.json");

    [Theory]
    [MemberData(nameof(BenefitsRows))]
    public void BenefitsUtilization_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            CompensationKernels.BuildBenefitsUtilization(
                Deser<List<BenefitPlanInput>>(input["plans"]!),
                input["totalUsers"]!.GetValue<int>()));
}
