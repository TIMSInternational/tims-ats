namespace Tims.IntegrationTests.Succession;

/// <summary>Shares ONE <see cref="SuccessionWriteFixture"/> (a single container) across the write suites.</summary>
[CollectionDefinition("SuccessionWrite")]
public sealed class SuccessionWriteCollection : ICollectionFixture<SuccessionWriteFixture>;
