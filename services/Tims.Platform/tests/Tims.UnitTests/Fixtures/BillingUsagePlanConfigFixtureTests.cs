using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Billing;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# billing usage/plan/config kernels to the shared golden fixtures
/// (contracts/billing-fixtures/{plan-entitlement,usage-view,billing-config}.json) — the SAME cases the TS
/// vitest suite (tests/billing/usage-plan-config-fixtures.test.ts) asserts against the REAL exports
/// (entitledPlan/planLimits, buildUsageView, isBillingConfigured). Byte-parity across stacks for the
/// entitlement kernel (cancelled/missing → trial, unknown → trial), the getUsage envelope (used/limit
/// metrics, always-null storage/apiCalls, canonical …fffZ periods), and the getBillingConfig predicate.
/// A behavior drift on either stack turns its CI red.
/// </summary>
public sealed class BillingUsagePlanConfigFixtureTests
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonNode LoadCases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "billing-fixtures", file)))!["cases"]!;

    private static IEnumerable<object[]> Rows(string file)
    {
        var cases = LoadCases(file).AsArray();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    private static DateTimeOffset? ParseDateOrNull(JsonNode? node) =>
        node is null || node.GetValueKind() == System.Text.Json.JsonValueKind.Null
            ? null
            : DateTimeOffset.Parse(node.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    private static string? StringOrNull(JsonNode? node) =>
        node is null || node.GetValueKind() == System.Text.Json.JsonValueKind.Null ? null : node.GetValue<string>();

    // ---- plan-entitlement.json — entitledPlan + planLimits -----------------------------------------
    public static IEnumerable<object[]> PlanCases() => Rows("plan-entitlement.json");

    [Theory]
    [MemberData(nameof(PlanCases))]
    public void PlanEntitlement_matches_golden_fixture(int index, string name)
    {
        var node = LoadCases("plan-entitlement.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var plan = StringOrNull(node["input"]!["plan"]);
        var status = StringOrNull(node["input"]!["status"]);

        var resolved = PlanEntitlement.EntitledPlan(plan, status);
        Assert.Equal(node["expected"]!["entitledPlan"]!.GetValue<string>(), resolved);

        var limits = JsonSerializer.SerializeToNode(PlanEntitlement.Limits(resolved), WireOptions)!;
        Assert.True(
            JsonNode.DeepEquals(node["expected"]!["limits"]!, limits),
            $"limits mismatch for '{name}': {limits.ToJsonString()}");
    }

    // ---- usage-view.json — buildUsageView envelope -------------------------------------------------
    public static IEnumerable<object[]> UsageCases() => Rows("usage-view.json");

    [Theory]
    [MemberData(nameof(UsageCases))]
    public void UsageView_matches_golden_fixture(int index, string name)
    {
        var node = LoadCases("usage-view.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var view = UsageViewBuilder.Build(
            employees: input["employees"]!.GetValue<int>(),
            vacancies: input["vacancies"]!.GetValue<int>(),
            assessments: input["assessments"]!.GetValue<int>(),
            plan: StringOrNull(input["plan"]),
            status: StringOrNull(input["status"]),
            periodStart: ParseDateOrNull(input["periodStart"]),
            periodEnd: ParseDateOrNull(input["periodEnd"]));

        var actual = JsonSerializer.SerializeToNode(view, WireOptions)!;
        var expected = node["expected"]!;
        Assert.True(JsonNode.DeepEquals(expected, actual), $"usage wire mismatch for '{name}': {actual.ToJsonString()}");

        // storage/apiCalls keys are ALWAYS present with null values (no metering) — pin explicitly.
        Assert.True(actual.AsObject().ContainsKey("storage"));
        Assert.True(actual.AsObject().ContainsKey("apiCalls"));
        // No schemaVersion on the billing wire (INTERNAL staff read = raw view shape).
        Assert.False(actual.AsObject().ContainsKey("schemaVersion"));
    }

    // ---- billing-config.json — isBillingConfigured predicate ---------------------------------------
    public static IEnumerable<object[]> ConfigCases() => Rows("billing-config.json");

    [Theory]
    [MemberData(nameof(ConfigCases))]
    public void BillingConfig_matches_golden_fixture(int index, string name)
    {
        var node = LoadCases("billing-config.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"]!;
        var configured = StripeBillingConfig.IsConfigured(
            StringOrNull(input["secretKey"]),
            StringOrNull(input["priceStarter"]),
            StringOrNull(input["priceProfessional"]));

        Assert.Equal(node["expected"]!.GetValue<bool>(), configured);
    }
}
