using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.NineBox;
using Xunit;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Golden-parity for the pure nine-box kernels (Phase-5 Slice 10). Asserts NineBoxKernels against the
/// SAME contracts/ninebox-fixtures/*.json the REAL @tims/shared exports assert — anti-drift across stacks
/// (band thresholds, quadrant-plan Spanish content, half-up benchStrength ratio, distribution counts).
/// </summary>
public sealed class NineBoxKernelsFixtureTests
{
    private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "ninebox-fixtures", file)))!["cases"]!.AsArray();

    private static void Run(string file, Func<JsonNode, object> kernel)
    {
        foreach (var c in Cases(file))
        {
            var actual = JsonSerializer.SerializeToNode(kernel(c!["input"]!), Wire)!;
            Assert.True(
                JsonNode.DeepEquals(c["expected"], actual),
                $"{file}: {c["name"]} — expected {c["expected"]!.ToJsonString()} got {actual.ToJsonString()}");
        }
    }

    private static List<string> Quadrants(JsonNode input) =>
        input["quadrants"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    private sealed record GridItem(string Id, string Quadrant);

    [Fact]
    public void SimulateBands() => Run("simulate-bands.json", i =>
        NineBoxKernels.SimulateBands(i["pot"]!.GetValue<double>(), i["perf"]!.GetValue<double>()));

    [Fact]
    public void ResolveQuadrantPlan() => Run("quadrant-plan.json", i =>
        NineBoxKernels.ResolveQuadrantPlan(i["quadrant"]!.GetValue<string>()));

    [Fact]
    public void BuildBenchStrength() => Run("bench-strength.json", i =>
        NineBoxKernels.BuildBenchStrength(Quadrants(i)));

    [Fact]
    public void BuildQuadrantDistribution() => Run("quadrant-distribution.json", i =>
        NineBoxKernels.BuildQuadrantDistribution(Quadrants(i)));

    [Fact]
    public void GridPlacement() => Run("grid-placement.json", i =>
    {
        var items = i["items"]!.AsArray()
            .Select(n => new GridItem(n!["id"]!.GetValue<string>(), n["quadrant"]!.GetValue<string>()))
            .ToList();
        return NineBoxKernels.GridPlacement(items, item => item.Quadrant);
    });

    [Fact]
    public void ComputeMovements() => Run("movements.json", i =>
    {
        var evaluations = i["evaluations"]!.AsArray()
            .Select(n => new MovementEvalInput(
                n!["userId"]!.GetValue<string>(),
                n["firstName"]!.GetValue<string>(),
                n["lastName"]!.GetValue<string>(),
                n["period"]!.GetValue<string>(),
                n["quadrant"]!.GetValue<string>()))
            .ToList();
        return NineBoxKernels.ComputeMovements(evaluations);
    });
}
