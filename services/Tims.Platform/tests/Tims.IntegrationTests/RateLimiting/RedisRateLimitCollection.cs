namespace Tims.IntegrationTests.RateLimiting;

/// <summary>Shares one Redis container across the WP2.6 limiter tests.</summary>
[CollectionDefinition(Name)]
public sealed class RedisRateLimitCollection : ICollectionFixture<RedisRateLimitFixture>
{
    public const string Name = "redis-ratelimit";
}
