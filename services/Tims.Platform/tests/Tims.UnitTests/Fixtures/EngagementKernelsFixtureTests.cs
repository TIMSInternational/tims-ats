using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Engagement;
using Xunit;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Golden-parity for the pure engagement kernels (Phase-5 Slice 11). Asserts EngagementKernels against the SAME
/// contracts/engagement-fixtures/*.json the REAL @tims/shared exports assert — anti-drift across stacks (min-5
/// floors, all-or-nothing suppression, the cross-endpoint differencing guard, JS half-up rounding, and the
/// filter(Boolean)/Number()/parseInt answer coercion the kernels reproduce).
/// </summary>
public sealed class EngagementKernelsFixtureTests
{
    private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "engagement-fixtures", file)))!["cases"]!.AsArray();

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

    private static List<JsonObject> Objects(JsonNode? array) =>
        array!.AsArray().Select(n => n!.AsObject()).ToList();

    // survey-results / climate: `responses` is [{ answers: {...} }] — the kernels take the answers objects.
    private static List<JsonObject> ResponseAnswers(JsonNode input) =>
        input["responses"]!.AsArray().Select(n => n!["answers"]!.AsObject()).ToList();

    [Fact]
    public void ComputeEnps() => Run("compute-enps.json", i =>
        EngagementKernels.ComputeEnps(Objects(i["responseAnswers"]), i["period"]!.GetValue<string>()));

    [Fact]
    public void SummarizeSurveyResults() => Run("survey-results.json", i =>
        EngagementKernels.SummarizeSurveyResults(Objects(i["questions"]), ResponseAnswers(i)));

    [Fact]
    public void BuildClimateHeatmap() => Run("climate-heatmap.json", i =>
        EngagementKernels.BuildClimateHeatmap(Objects(i["questions"]), ResponseAnswers(i)));

    [Fact]
    public void BuildResultsByArea() => Run("results-by-area.json", i =>
    {
        var rows = i["rows"]!.AsArray().Select(n =>
        {
            var areaNode = n!["areaKey"];
            var areaKey = areaNode is null || areaNode.GetValueKind() == JsonValueKind.Null
                ? null
                : areaNode.GetValue<string>();
            return new AreaResultRow(areaKey, n["answers"]!.AsObject());
        }).ToList();
        return EngagementKernels.BuildResultsByArea(rows);
    });

    [Fact]
    public void BuildEngagementKpis() => Run("engagement-kpis.json", i =>
        EngagementKernels.BuildEngagementKpis(
            i["activeSurveys"]!.GetValue<int>(),
            i["totalResponses"]!.GetValue<int>(),
            i["perSurveyCounts"]!.AsArray().Select(n => n!.GetValue<int>()).ToList(),
            i["actionPlansOpen"]!.GetValue<int>()));
}
