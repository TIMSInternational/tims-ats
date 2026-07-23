namespace Tims.IntegrationTests.Dei;

/// <summary>xUnit collection so the Phase-5 Slice 11b DEI Testcontainers fixture starts ONCE for all tests.</summary>
[CollectionDefinition("DeiRead")]
public sealed class DeiReadCollection : ICollectionFixture<DeiReadFixture>;
