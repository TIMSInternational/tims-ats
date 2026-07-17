using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Billing;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# billing wire mappers (<see cref="InvoiceV1Mapper"/> + <see cref="SubscriptionV1Mapper"/>)
/// to the shared golden fixtures (contracts/billing-fixtures/{invoice-v1,subscription-v1}.json), the SAME
/// cases the TS vitest suite (tests/billing/invoice-v1-fixtures.test.ts) asserts against the raw billing
/// router shape. Each case: build the raw row from <c>input</c>, map to v1, serialize the DTO through its
/// own [JsonConverter] date annotations (camelCase), and assert the serialized wire object is DEEP-EQUAL
/// to the fixture's <c>expected</c> — byte-parity across stacks for field set, money-Float numbers, enum
/// strings, canonical …fffZ dates, null handling, AND the subscription omit-vs-include shape.
///
/// A dropped/renamed field, a wrong money token (STJ vs JS double), a +00:00 date, or a present-null
/// subscription where it should be omitted all turn this RED (and the TS suite RED too).
/// </summary>
public sealed class BillingV1FixtureTests
{
    private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonNode LoadCases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "billing-fixtures", file)))!["cases"]!;

    public static IEnumerable<object[]> InvoiceCases() => Rows("invoice-v1.json");

    public static IEnumerable<object[]> SubscriptionCases() => Rows("subscription-v1.json");

    private static IEnumerable<object[]> Rows(string file)
    {
        var cases = LoadCases(file).AsArray();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(InvoiceCases))]
    public void Invoice_matches_golden_fixture(int index, string name)
    {
        var node = LoadCases("invoice-v1.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var shape = node["shape"]!.GetValue<string>();
        var row = node["input"].Deserialize<InvoiceRow>(ReadOptions)!;
        // list -> MapListItem (no subscription property); detail -> MapDetail (subscription always emitted).
        var actual = shape == "list"
            ? JsonSerializer.SerializeToNode(InvoiceV1Mapper.MapListItem(row), WireOptions)!
            : JsonSerializer.SerializeToNode(InvoiceV1Mapper.MapDetail(row), WireOptions)!;
        var expected = node["expected"]!;

        Assert.True(JsonNode.DeepEquals(expected, actual), $"invoice wire mismatch for '{name}': {actual.ToJsonString()}");

        // No schemaVersion on the billing wire (parity: raw Prisma row; re-adding one turns this RED).
        Assert.False(actual.AsObject().ContainsKey("schemaVersion"));

        // Explicit STJ-vs-JS money pin: the amount token in the serialized wire equals the fixture's.
        Assert.Equal(expected["amount"]!.ToJsonString(), actual["amount"]!.ToJsonString());

        // Explicit subscription omit-vs-include pin: list OMITS the key; detail ALWAYS has it (object OR
        // null). Cross-checked against the fixture's own expected key set (DeepEquals covers it too).
        var actualHasSub = actual.AsObject().ContainsKey("subscription");
        Assert.Equal(shape == "detail", actualHasSub);
        Assert.Equal(expected.AsObject().ContainsKey("subscription"), actualHasSub);
    }

    [Theory]
    [MemberData(nameof(SubscriptionCases))]
    public void Subscription_matches_golden_fixture(int index, string name)
    {
        var node = LoadCases("subscription-v1.json")[index]!;
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var row = node["input"].Deserialize<SubscriptionRow>(ReadOptions)!;
        var actual = JsonSerializer.SerializeToNode(SubscriptionV1Mapper.Map(row), WireOptions)!;
        var expected = node["expected"]!;

        Assert.True(JsonNode.DeepEquals(expected, actual), $"subscription wire mismatch for '{name}': {actual.ToJsonString()}");
    }
}
