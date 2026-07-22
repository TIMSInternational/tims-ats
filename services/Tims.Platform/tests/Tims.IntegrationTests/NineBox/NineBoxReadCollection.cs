namespace Tims.IntegrationTests.NineBox;

/// <summary>xUnit collection so the Phase-5 Slice 10 nine-box read tests share ONE Postgres container.</summary>
[CollectionDefinition("NineBoxRead")]
public sealed class NineBoxReadCollection : ICollectionFixture<NineBoxReadFixture>;
