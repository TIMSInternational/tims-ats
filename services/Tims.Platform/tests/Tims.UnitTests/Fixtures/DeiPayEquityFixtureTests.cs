using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Dei;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="DeiKernels.BuildPayEquity"/> pay-equity shaping kernel to the shared golden
/// (contracts/dei-fixtures/pay-equity.json) — the SAME cases the TS vitest (tests/dei/pay-equity-fixtures.test.ts)
/// asserts against the REAL @tims/shared buildPayEquity export that dei.service.getPayEquity now delegates to.
/// byGender salaries are ALREADY converted (the impure FX runs in the DEI use case / TS service). Byte-parity for
/// the all-or-nothing min-5 triggers (population / skipped-salaried / per-gender non-positive complement / cohort),
/// the female-vs-male gap%, and the even-count median. A drift on either stack turns its CI red.
/// </summary>
public sealed class DeiPayEquityFixtureTests
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "dei-fixtures", "pay-equity.json")))!
            ["cases"]!.AsArray();

    public static IEnumerable<object[]> PayEquityCases()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(PayEquityCases))]
    public void BuildPayEquity_matches_golden(int index, string name)
    {
        var node = Cases()[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());
        var input = node["input"]!;

        var byGender = input["byGender"]!.AsArray()
            .Select(g => new PayEquityGenderInput(
                g!["gender"]!.GetValue<string>(),
                g["convertedSalaries"]!.Deserialize<List<double>>(ReadOptions)!))
            .ToList();
        var demographic = input["demographicGenderCounts"]!.Deserialize<Dictionary<string, int>>(ReadOptions)!;

        var actual = JsonSerializer.SerializeToNode(
            DeiKernels.BuildPayEquity(byGender, demographic, input["skippedSalaried"]!.GetValue<int>(), input["currency"]!.GetValue<string>()),
            WireOptions)!;

        Assert.True(
            JsonNode.DeepEquals(node["expected"]!, actual),
            $"pay-equity mismatch for '{name}': {actual.ToJsonString()}");
    }
}
