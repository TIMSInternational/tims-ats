using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Succession;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the five C# <see cref="SuccessionKernels"/> to the shared goldens (contracts/succession-fixtures/*.json)
/// — the SAME cases the TS vitest (tests/succession/*-fixtures.test.ts) asserts against the REAL @tims/shared
/// exports. Byte-parity for coverage statuses, half-up coverageRate/avgSuccessorsPerRole/gapPercent, first-seen
/// dedup + ranking, exit risk tiers + first-ready_now naming, and the exposed-only auditedCompIds. A drift on
/// either stack turns its CI red.
/// </summary>
public sealed class SuccessionKernelsFixtureTests
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "succession-fixtures", file)))!
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

    public static IEnumerable<object[]> CoverageRows() => RowsOf("competency-coverage.json");

    [Theory]
    [MemberData(nameof(CoverageRows))]
    public void CompetencyCoverage_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            SuccessionKernels.BuildCompetencyCoverage(Deser<List<CoverageRoleInput>>(input["roles"]!)));

    public static IEnumerable<object[]> KpiRows() => RowsOf("succession-kpis.json");

    [Theory]
    [MemberData(nameof(KpiRows))]
    public void SuccessionKpis_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            SuccessionKernels.BuildSuccessionKpis(Deser<SuccessionKpiCounts>(input["counts"]!)));

    public static IEnumerable<object[]> ExitRows() => RowsOf("exit-simulation.json");

    [Theory]
    [MemberData(nameof(ExitRows))]
    public void ExitSimulation_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            SuccessionKernels.BuildExitSimulation(Deser<List<ExitSuccessorInput>>(input["successors"]!)));

    public static IEnumerable<object[]> SuggestedRows() => RowsOf("suggested-successors.json");

    [Theory]
    [MemberData(nameof(SuggestedRows))]
    public void SuggestedSuccessors_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            SuccessionKernels.BuildSuggestedSuccessors(
                Deser<List<SuggestedEvaluationInput>>(input["evaluations"]!),
                Deser<List<string>>(input["existingUserIds"]!)));

    public static IEnumerable<object[]> CompGapRows() => RowsOf("comp-gap.json");

    [Theory]
    [MemberData(nameof(CompGapRows))]
    public void CompGapAlerts_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
            SuccessionKernels.BuildCompGapAlerts(
                Deser<List<CompGapRoleInput>>(input["roles"]!),
                Deser<List<CompGapBandInput>>(input["bands"]!),
                Deser<List<CompGapCompInput>>(input["comps"]!)));
}
