namespace Tims.IntegrationTests.Compensation;

/// <summary>Shares ONE <see cref="CompensationWriteFixture"/> (a single container) across the write suites.</summary>
[CollectionDefinition("CompensationWrite")]
public sealed class CompensationWriteCollection : ICollectionFixture<CompensationWriteFixture>;
