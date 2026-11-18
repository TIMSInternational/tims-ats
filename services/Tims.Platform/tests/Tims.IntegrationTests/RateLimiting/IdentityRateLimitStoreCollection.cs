namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Combines the seeded identity/api-key Postgres (<see cref="IdentitySchemaFixture"/>) with a live
/// DynamoDB Local (<see cref="DynamoDbRateLimitFixture"/>) for the LIVE rate-limit-key proof: boot the real
/// host (JWT + DB + shared store) and inspect the EXACT items it writes for a resolved TIMS principal. A
/// dedicated collection so this pair of containers is shared across the live-key test class without
/// perturbing the other suites.
/// </summary>
[CollectionDefinition(Name)]
public sealed class IdentityRateLimitStoreCollection
    : ICollectionFixture<IdentitySchemaFixture>, ICollectionFixture<DynamoDbRateLimitFixture>
{
    public const string Name = "identity-ratelimit-store";
}
