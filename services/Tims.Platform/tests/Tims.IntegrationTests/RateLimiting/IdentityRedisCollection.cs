namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Combines the seeded identity/api-key Postgres (<see cref="IdentitySchemaFixture"/>) with a live
/// Redis (<see cref="RedisRateLimitFixture"/>) for the LIVE rate-limit-key proof: boot the real host
/// (JWT + DB + Redis) and inspect the EXACT Redis bucket keys it writes for a resolved TIMS
/// principal. A dedicated collection (distinct from "Identity" and "redis-ratelimit") so this pair
/// of containers is shared across the live-key test class without perturbing the other suites.
/// </summary>
[CollectionDefinition(Name)]
public sealed class IdentityRedisCollection
    : ICollectionFixture<IdentitySchemaFixture>, ICollectionFixture<RedisRateLimitFixture>
{
    public const string Name = "identity-redis";
}
