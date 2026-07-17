using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.ExternalVendor;
using Tims.Domain.Json;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="ExternalValidationResultV1.Map"/> to the shared golden fixture
/// (contracts/external-fixtures/validation-result-v1.json), the SAME cases the TS vitest suite
/// (tests/external-vendor/validation-result-v1-fixtures.test.ts) asserts against the REAL
/// <c>toExternalValidationResultV1</c>. Proves the (id, status, completedAt) → v1 map is byte-identical:
/// constant <c>schemaVersion 'v1'</c>, value passthrough, and the canonical <c>…fffZ</c> completedAt.
///
/// The DATE is pinned by its SERIALIZED wire form (through the DTO's
/// <see cref="NodeIsoDateTimeOffsetConverter"/>), not merely its <see cref="DateTimeOffset"/> value —
/// exactly as the TS suite asserts <c>.toISOString()</c>. A default STJ writer (<c>+00:00</c>) would fail.
/// </summary>
public sealed class ValidationResultV1FixtureTests
{
    private static readonly ValidationV1Root Data = Fx.Load<ValidationV1Root>("external-fixtures", "validation-result-v1.json");

    private static readonly JsonNode RawCases = JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "external-fixtures", "validation-result-v1.json")))!["cases"]!;

    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var actual = ExternalValidationResultV1.Map(c.Input.Id, c.Input.Status, c.Input.CompletedAt);
        var expected = c.Expected;

        Assert.Equal(expected.SchemaVersion, actual.SchemaVersion);
        Assert.Equal(expected.Id, actual.Id);
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.CompletedAt, actual.CompletedAt);

        // Pin the DATE WIRE FORMAT: serialize through the DTO's Node-ISO converter and assert the STRING
        // equals the fixture's canonical ISO string (…fffZ), byte-for-byte with TS `.toISOString()`.
        var wire = JsonSerializer.SerializeToNode(actual, WireOptions)!.AsObject();
        var expectedRaw = RawCases[index]!["expected"]!.AsObject();
        Assert.Equal(expectedRaw["completedAt"]!.GetValue<string>(), wire["completedAt"]!.GetValue<string>());
    }
}
