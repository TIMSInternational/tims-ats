namespace Tims.IntegrationTests.RateLimiting;

/// <summary>Shares one DynamoDB Local container across the shared rate-limit store tests.</summary>
[CollectionDefinition(Name)]
public sealed class RateLimitStoreCollection : ICollectionFixture<DynamoDbRateLimitFixture>
{
    public const string Name = "ratelimit-store";
}
