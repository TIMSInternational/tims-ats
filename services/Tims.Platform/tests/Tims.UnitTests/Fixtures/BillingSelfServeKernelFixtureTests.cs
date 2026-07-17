using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Billing;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="BillingSelfServeKernel.BlocksSelfServeCheckout"/> to the shared golden corpus
/// (contracts/billing-fixtures/blocks-self-serve-checkout.json) — the SAME cases the TS vitest suite
/// (tests/billing/billing-service.test.ts) asserts against the REAL <c>blocksSelfServeCheckout</c> export.
/// A divergence on the double-billing guard (a live sub, a paid local plan, cancelled re-subscribe, trial, or
/// a missing row) turns this suite RED (and the TS suite RED too).
/// </summary>
public sealed class BillingSelfServeKernelFixtureTests
{
    private static readonly JsonSerializerOptions ReadCi = new() { PropertyNameCaseInsensitive = true };

    private static JsonNode Root() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "billing-fixtures", "blocks-self-serve-checkout.json")))!;

    public static IEnumerable<object[]> Cases()
    {
        var cases = Root()["cases"]!.AsArray();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void BlocksSelfServeCheckout_matches_golden_fixture(int index, string name)
    {
        var node = Root()["cases"]![index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var inputNode = node["input"];
        var subscription = inputNode is null ? null : inputNode.Deserialize<SelfServeSubscription>(ReadCi);

        Assert.Equal(node["expected"]!.GetValue<bool>(), BillingSelfServeKernel.BlocksSelfServeCheckout(subscription));
    }
}
