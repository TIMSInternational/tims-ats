namespace Tims.IntegrationTests.NineBox;

/// <summary>Shares ONE <see cref="NineBoxWriteFixture"/> (a single container) across the write suites.</summary>
[CollectionDefinition("NineBoxWrite")]
public sealed class NineBoxWriteCollection : ICollectionFixture<NineBoxWriteFixture>;
