namespace Tims.IntegrationTests.Compensation;

/// <summary>xUnit collection so the Phase-5 Slice 9 compensation read tests share ONE Postgres container.</summary>
[CollectionDefinition("CompensationRead")]
public sealed class CompensationReadCollection : ICollectionFixture<CompensationReadFixture>;
