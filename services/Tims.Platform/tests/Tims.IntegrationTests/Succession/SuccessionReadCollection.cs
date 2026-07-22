namespace Tims.IntegrationTests.Succession;

/// <summary>xUnit collection so the Phase-5 Slice 8 succession read tests share ONE Postgres container.</summary>
[CollectionDefinition("SuccessionRead")]
public sealed class SuccessionReadCollection : ICollectionFixture<SuccessionReadFixture>;
