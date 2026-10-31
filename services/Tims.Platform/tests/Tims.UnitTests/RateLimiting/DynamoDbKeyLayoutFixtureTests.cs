using System.Text.Json;
using Tims.Domain.RateLimiting;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.RateLimiting;

/// <summary>
/// The C# half of the shared DynamoDB item layout (contracts/ratelimit-fixtures/dynamodb.json). The TS
/// suite derives the same partition keys from the same file (tests/ratelimit/dynamodb-contract.test.ts),
/// so a caller hits ONE item — one budget — whichever stack serves the request.
/// </summary>
public sealed class DynamoDbKeyLayoutFixtureTests
{
    private sealed record PkCase(string Category, string Identifier, string Pk);

    private static readonly JsonElement Root = Fx.Load<JsonElement>("ratelimit-fixtures", "dynamodb.json");

    private static IReadOnlyList<PkCase> PartitionKeys() =>
        Root.GetProperty("partitionKeys").Deserialize<List<PkCase>>(Fx.Options)!;

    private static RateLimitCategory Parse(string token) =>
        Enum.GetValues<RateLimitCategory>().Single(c => RateLimits.CategoryToken(c) == token);

    [Fact]
    public void Derives_every_frozen_partition_key()
    {
        var cases = PartitionKeys();
        Assert.True(cases.Count >= 5, "non-vacuity: the fixture must carry partition-key cases");
        foreach (var c in cases)
        {
            Assert.Equal(c.Pk, RateLimits.PartitionKey(Parse(c.Category), c.Identifier));
        }
    }

    [Fact]
    public void Window_attribute_and_ttl_follow_the_frozen_formulas()
    {
        Assert.Equal("w{bucket}", Root.GetProperty("slidingWindow").GetProperty("windowAttributeFormat").GetString());
        Assert.Equal("w29613280", RateLimits.WindowAttribute(29_613_280));
        // ceil((bucket + 2) * windowMs / 1000) + 60, for a 1m and a 5m category.
        Assert.Equal(((29_613_280L + 2) * 60) + 60, RateLimits.ExpiresAtSeconds(RateLimitCategory.Query, 29_613_280));
        Assert.Equal(((5_922_656L + 2) * 300) + 60, RateLimits.ExpiresAtSeconds(RateLimitCategory.Export, 5_922_656));
    }

    [Fact]
    public void Uses_the_frozen_budget_for_every_category()
    {
        // The TS suite asserts the same numbers against LIMITS; a drift would give one caller two budgets.
        var budgets = Root.GetProperty("budgets").EnumerateObject().Where(p => !p.Name.StartsWith('$')).ToList();
        Assert.Equal(Enum.GetValues<RateLimitCategory>().Length, budgets.Count);
        foreach (var budget in budgets)
        {
            var category = Parse(budget.Name);
            Assert.Equal(budget.Value.GetProperty("tokens").GetInt32(), RateLimits.Tokens(category));
            Assert.Equal(budget.Value.GetProperty("windowMs").GetInt64(), RateLimits.WindowMs(category));
        }
    }

    [Fact]
    public void Hashes_utf8_exactly_like_node()
    {
        // From the fixture's non-ASCII case: Node's createHash('sha256').update(s, 'utf8').digest('hex').
        var c = PartitionKeys().Single(x => x.Identifier == "üser-ñ");
        Assert.Equal(c.Pk[(c.Pk.LastIndexOf('#') + 1)..], RateLimits.Sha256Hex("üser-ñ"));
    }
}
