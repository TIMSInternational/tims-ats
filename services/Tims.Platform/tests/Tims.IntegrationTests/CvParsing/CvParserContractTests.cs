using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Infrastructure.CvParsing;

namespace Tims.IntegrationTests.CvParsing;

/// <summary>
/// The .NET parser must accept/reject exactly what the TypeScript Zod contract
/// does and persist the same <c>parsed_data</c>. The fixture file is generated
/// from the TS schema and asserted by <c>tests/ai/cv-parser-contract.test.ts</c>.
/// </summary>
public sealed class CvParserContractTests
{
    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var name in Cases().Keys) data.Add(name);
        return data;
    }

    private static Dictionary<string, JsonObject> Cases()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "cv-parser-fixtures", "cases.json");
        var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        return root["cases"]!.AsArray().Select(node => node!.AsObject())
            .ToDictionary(node => node["name"]!.GetValue<string>());
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Matches_the_typescript_contract(string name)
    {
        var contract = Cases()[name];
        var accepted = CvParsedResult.TryParse(contract["modelText"]!.GetValue<string>(), out var result);
        Assert.Equal(contract["valid"]!.GetValue<bool>(), accepted);
        if (!accepted) return;

        var expected = contract["parsedData"]!;
        AssertJsonEqual(expected, JsonNode.Parse(result!.ParsedJson));
        AssertJsonEqual(expected["education"], JsonNode.Parse(result.EducationJson));
        AssertJsonEqual(expected["languages"], JsonNode.Parse(result.LanguagesJson));
    }

    [Fact]
    public void Fixture_file_exercises_both_outcomes()
    {
        var cases = Cases().Values.ToList();
        Assert.True(cases.Count(c => c["valid"]!.GetValue<bool>()) >= 5);
        Assert.True(cases.Count(c => !c["valid"]!.GetValue<bool>()) >= 5);
    }

    private static void AssertJsonEqual(JsonNode? expected, JsonNode? actual) =>
        Assert.True(JsonNode.DeepEquals(expected, actual),
            $"expected {expected?.ToJsonString()} but got {actual?.ToJsonString()}");
}
