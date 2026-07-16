namespace Tims.IntegrationTests;

/// <summary>
/// Shares one Postgres container across all Spike A tests — container startup is
/// the expensive part, and RLS policies/roles are set up once in <see cref="RlsFixture"/>.
/// </summary>
[CollectionDefinition("RLS")]
public sealed class RlsCollection : ICollectionFixture<RlsFixture>;
