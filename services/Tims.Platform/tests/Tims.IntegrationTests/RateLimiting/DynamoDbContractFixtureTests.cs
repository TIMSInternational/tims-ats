using System.Text.Json;
using Tims.Api.Http;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// The C# store sends EXACTLY the expressions frozen in contracts/ratelimit-fixtures/dynamodb.json — the
/// same strings the TS store is asserted to send (tests/ratelimit/dynamodb-contract.test.ts) — so both
/// stacks apply the identical atomic check to the shared items. (No container needed.)
/// </summary>
public sealed class DynamoDbContractFixtureTests
{
    private static readonly JsonElement Root = JsonDocument.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "ratelimit-fixtures", "dynamodb.json"))).RootElement;

    private static string Get(string section, string name) => Root.GetProperty(section).GetProperty(name).GetString()!;

    [Fact]
    public void Sliding_window_expressions_match_the_contract()
    {
        Assert.Equal(DynamoDbRateLimitStore.UpdateExpression, Get("slidingWindow", "updateExpression"));
        Assert.Equal(Get("slidingWindow", "conditionWithPrevious"), DynamoDbRateLimitStore.SlidingWindowCondition(hasPrevious: true));
        Assert.Equal(Get("slidingWindow", "conditionWithoutPrevious"), DynamoDbRateLimitStore.SlidingWindowCondition(hasPrevious: false));
        Assert.Equal(DynamoDbRateLimitStore.Attempts, Root.GetProperty("slidingWindow").GetProperty("attempts").GetInt32());
        Assert.Equal(DynamoDbRateLimitStore.ContentionRetryMs, Root.GetProperty("slidingWindow").GetProperty("contentionRetryMs").GetInt64());
    }

    [Fact]
    public void Claim_condition_and_relay_prefix_match_the_contract()
    {
        Assert.Equal(DynamoDbRateLimitStore.ClaimCondition, Get("claim", "conditionExpression"));
        var relayPrefix = Root.GetProperty("claim").GetProperty("prefixes").GetProperty("relayNonce").GetString()!;
        Assert.StartsWith(relayPrefix, RelayNonceStore.PartitionKey("n"), StringComparison.Ordinal);
        Assert.Equal("expiresAt", Root.GetProperty("table").GetProperty("ttlAttribute").GetString());
    }
}
