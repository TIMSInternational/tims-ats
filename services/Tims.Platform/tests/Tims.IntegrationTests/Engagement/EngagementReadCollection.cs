namespace Tims.IntegrationTests.Engagement;

/// <summary>xUnit collection so the Phase-5 Slice 11 engagement Testcontainers fixture starts ONCE for all tests.</summary>
[CollectionDefinition("EngagementRead")]
public sealed class EngagementReadCollection : ICollectionFixture<EngagementReadFixture>;
