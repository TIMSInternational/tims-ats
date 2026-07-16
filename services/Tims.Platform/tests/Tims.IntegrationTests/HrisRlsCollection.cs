namespace Tims.IntegrationTests;

/// <summary>
/// Shares one Postgres container across the HRIS RLS tests — container startup + migration apply are
/// the expensive parts, done once in <see cref="HrisSchemaFixture"/>.
/// </summary>
[CollectionDefinition("HrisRls")]
public sealed class HrisRlsCollection : ICollectionFixture<HrisSchemaFixture>;
