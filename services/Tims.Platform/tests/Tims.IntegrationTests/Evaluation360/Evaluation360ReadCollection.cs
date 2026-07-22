namespace Tims.IntegrationTests.Evaluation360;

/// <summary>xUnit collection so the Phase-5 Slice 7 evaluation360 read tests share ONE Postgres container.</summary>
[CollectionDefinition("Evaluation360Read")]
public sealed class Evaluation360ReadCollection : ICollectionFixture<Evaluation360ReadFixture>;
