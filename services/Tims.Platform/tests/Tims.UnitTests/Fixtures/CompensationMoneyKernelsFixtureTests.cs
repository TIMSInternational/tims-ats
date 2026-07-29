using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Compensation;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# FX-derived money kernels (<see cref="CompensationKernels.ConvertMoney"/> /
/// <see cref="CompensationKernels.SumMoney"/>) to the shared goldens
/// (contracts/compensation-fixtures/{convert-money,sum-money}.json) — the SAME cases the TS vitest
/// (tests/currency/convert-money-fixtures.test.ts) asserts against the REAL @tims/shared PURE exports
/// (convertMoneyWithRate / sumMoneyWithRates, which the live currency.ts now delegates to). FIXED rates only:
/// the live FX-gateway fetch is NEVER fixtured. Byte-parity for the EPSILON half-up bias (1.005 -> 1.01),
/// round-then-sum, and the `converted` flag. A drift on either stack turns its CI red.
/// </summary>
public sealed class CompensationMoneyKernelsFixtureTests
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

    public static IEnumerable<object[]> ConvertCases() => RowsOf("convert-money.json");

    [Theory]
    [MemberData(nameof(ConvertCases))]
    public void ConvertMoney_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.ConvertMoney(
            input["amount"]!.GetValue<double>(),
            input["from"]!.GetValue<string>(),
            input["to"]!.GetValue<string>(),
            input["rate"]!.GetValue<double>()));

    public static IEnumerable<object[]> SumCases() => RowsOf("sum-money.json");

    [Theory]
    [MemberData(nameof(SumCases))]
    public void SumMoney_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.SumMoney(
            input["rows"]!.Deserialize<List<MoneyRow>>(ReadOptions)!,
            input["to"]!.GetValue<string>()));
}
