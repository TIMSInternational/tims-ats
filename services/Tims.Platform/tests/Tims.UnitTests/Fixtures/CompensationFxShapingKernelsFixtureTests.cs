using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Compensation;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# FX-derived compensation shaping kernels (<see cref="CompensationKernels.BuildBandDistribution"/> /
/// BuildCompPayEquity / BuildTotalCompBreakdown / BuildCompDashboardKpis / BuildSimulateAdjustment) to the shared
/// goldens (contracts/compensation-fixtures/{band-distribution,pay-equity,total-comp-breakdown,dashboard-kpis,
/// simulate-adjustment}.json) — the SAME cases the TS vitest (tests/compensation/comp-fx-shaping-fixtures.test.ts)
/// asserts against the REAL @tims/shared PURE exports the live router delegates to. Inputs are ALREADY converted
/// (the impure FX runs in the use case). Byte-parity for FIX 1 (positive-unbanded fold), FIX 3 (band-less compa
/// shape), FIX 7 (0-mean → null), the min-5 triggers, round-then-sum, and the floor-index median. A drift on
/// either stack turns its CI red.
/// </summary>
public sealed class CompensationFxShapingKernelsFixtureTests
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
        var actualValue = run(node["input"]!);
        // Serialize the RUNTIME type (matters for simulate: base 7 fields vs derived 13 — FIX 3).
        var actual = JsonSerializer.SerializeToNode(actualValue, actualValue.GetType(), WireOptions)!;
        Assert.True(
            JsonNode.DeepEquals(node["expected"]!, actual),
            $"{file} mismatch for '{name}': {actual.ToJsonString()}");
    }

    // ── band-distribution ────────────────────────────────────────────────────────
    public static IEnumerable<object[]> BandCases() => RowsOf("band-distribution.json");

    [Theory]
    [MemberData(nameof(BandCases))]
    public void BuildBandDistribution_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.BuildBandDistribution(
            input["rows"]!.Deserialize<List<BandDistributionKernelRow>>(ReadOptions)!,
            input["unassignedCount"]!.GetValue<int>(),
            input["nonPositiveBanded"]!.GetValue<int>(),
            input["positiveUnbanded"]!.GetValue<int>()));

    // ── pay-equity ─────────────────────────────────────────────────────────────────
    public static IEnumerable<object[]> PayEquityCases() => RowsOf("pay-equity.json");

    [Theory]
    [MemberData(nameof(PayEquityCases))]
    public void BuildCompPayEquity_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.BuildCompPayEquity(
            input["convertedSalaries"]!.Deserialize<List<double>>(ReadOptions)!,
            input["displayCurrency"]!.GetValue<string>()));

    // ── total-comp-breakdown ─────────────────────────────────────────────────────
    public static IEnumerable<object[]> TotalCompCases() => RowsOf("total-comp-breakdown.json");

    [Theory]
    [MemberData(nameof(TotalCompCases))]
    public void BuildTotalCompBreakdown_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.BuildTotalCompBreakdown(
            input["rowCount"]!.GetValue<int>(),
            input["baseContributors"]!.GetValue<int>(),
            input["variableContributors"]!.GetValue<int>(),
            input["totals"] is { } t ? t.Deserialize<TotalCompTotals>(ReadOptions) : null,
            input["displayCurrency"]!.GetValue<string>()));

    // ── dashboard-kpis ─────────────────────────────────────────────────────────────
    public static IEnumerable<object[]> DashboardCases() => RowsOf("dashboard-kpis.json");

    [Theory]
    [MemberData(nameof(DashboardCases))]
    public void BuildCompDashboardKpis_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input => CompensationKernels.BuildCompDashboardKpis(
            input["compensatedCount"]!.GetValue<int>(),
            input["compaRatioCount"]!.GetValue<int>(),
            input["pendingAdjustments"]!.GetValue<int>(),
            input["activeEmployees"]!.GetValue<int>(),
            input["benefitEnrollmentCounts"]!.Deserialize<List<int>>(ReadOptions)!,
            input["compaRatioAvg"] is { } a ? a.GetValue<double>() : null,
            input["payroll"] is { } p ? p.Deserialize<DashboardPayroll>(ReadOptions) : null,
            input["displayCurrency"]!.GetValue<string>()));

    // ── simulate-adjustment ──────────────────────────────────────────────────────
    public static IEnumerable<object[]> SimulateCases() => RowsOf("simulate-adjustment.json");

    [Theory]
    [MemberData(nameof(SimulateCases))]
    public void BuildSimulateAdjustment_matches_golden(string file, int index, string name) =>
        AssertCase(file, index, name, input =>
        {
            SimulateCompaInput? compa = null;
            if (input["compa"] is { } c)
            {
                SimulateBandInput? band = c["band"] is { } b
                    ? new SimulateBandInput(
                        b["min"]!.GetValue<double>(), b["mid"]!.GetValue<double>(),
                        b["max"]!.GetValue<double>(), b["bandCurrency"]!.GetValue<string>())
                    : null;
                compa = new SimulateCompaInput(
                    c["currentCompaRatio"]!.GetValue<double>(), band, c["proposedSalaryForBand"]!.GetValue<double>());
            }

            return CompensationKernels.BuildSimulateAdjustment(
                input["currentSalary"]!.GetValue<double>(),
                input["currentCurrency"]!.GetValue<string>(),
                input["proposedSalary"]!.GetValue<double>(),
                input["proposedCurrency"]!.GetValue<string>(),
                input["proposedSalaryForComparison"]!.GetValue<double>(),
                compa);
        });
}
