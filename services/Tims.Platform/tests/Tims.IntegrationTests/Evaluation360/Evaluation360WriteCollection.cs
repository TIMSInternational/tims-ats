namespace Tims.IntegrationTests.Evaluation360;

/// <summary>Shares ONE <see cref="Evaluation360WriteFixture"/> (a single container) across the write suites.</summary>
[CollectionDefinition("Evaluation360Write")]
public sealed class Evaluation360WriteCollection : ICollectionFixture<Evaluation360WriteFixture>;
