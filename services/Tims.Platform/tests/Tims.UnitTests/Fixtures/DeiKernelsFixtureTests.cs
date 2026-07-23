using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Dei;
using Xunit;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Golden-parity for the pure DEI kernels (Phase-5 Slice 11b). Asserts DeiKernels against the SAME
/// contracts/dei-fixtures/*.json the REAL @tims/shared exports assert — anti-drift across stacks (min-5 floors,
/// present-key-cardinality empties, the cross-endpoint differencing guard, JS half-up rounding, age-band
/// boundaries, and the inclusion multi-tier suppression + Number()/isNaN answer coercion).
/// </summary>
public sealed class DeiKernelsFixtureTests
{
    private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "dei-fixtures", file)))!["cases"]!.AsArray();

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

    private static List<DistInput> DistInputs(JsonNode? array) =>
        array!.AsArray().Select(n => new DistInput(n!["key"]!.GetValue<string>(), n["count"]!.GetValue<int>())).ToList();

    private static List<int> Ints(JsonNode? array) =>
        array!.AsArray().Select(n => n!.GetValue<int>()).ToList();

    private static List<string> Strings(JsonNode? array) =>
        array!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    private static List<JsonObject> Objects(JsonNode? array) =>
        array!.AsArray().Select(n => n!.AsObject()).ToList();

    [Fact]
    public void Pct() => Run("pct.json", i =>
        DeiKernels.Pct(i["count"]!.GetValue<int>(), i["total"]!.GetValue<int>()));

    [Fact]
    public void Median() => Run("median.json", i =>
        DeiKernels.Median(i["values"]!.AsArray().Select(n => n!.GetValue<double>()).ToList()));

    [Fact]
    public void AgeBand() => Run("age-band.json", i =>
        DeiKernels.AgeBand(
            DateTime.Parse(i["dob"]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.None),
            DateTime.Parse(i["now"]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.None)));

    [Fact]
    public void BuildDistribution() => Run("build-distribution.json", i =>
        DeiKernels.BuildDistribution(DistInputs(i["groups"]), i["total"]!.GetValue<int>(), Ints(i["extraBuckets"])));

    [Fact]
    public void LeadershipDiversity() => Run("leadership-diversity.json", i =>
        DeiKernels.LeadershipDiversity(Strings(i["leaderGenders"])));

    [Fact]
    public void DeiDashboardKpis() => Run("dashboard-kpis.json", i =>
        DeiKernels.DeiDashboardKpis(new DashboardKpisInput(
            i["totalEmployees"]!.GetValue<int>(),
            i["withDemographics"]!.GetValue<int>(),
            DistInputs(i["genders"]),
            DistInputs(i["nationalities"]),
            i["nullNationalityCount"]!.GetValue<int>(),
            i["nullDobCount"]!.GetValue<int>(),
            DistInputs(i["ethnicities"]),
            Strings(i["leaderGenders"]))));

    [Fact]
    public void InclusionIndex() => Run("inclusion-index.json", i =>
        DeiKernels.InclusionIndex(
            Objects(i["questions"]),
            i["responses"]!.AsArray().Select(n => n!["answers"]!.AsObject()).ToList()));
}
