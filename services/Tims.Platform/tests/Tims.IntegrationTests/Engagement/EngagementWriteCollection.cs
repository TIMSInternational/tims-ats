namespace Tims.IntegrationTests.Engagement;

/// <summary>Shares ONE <see cref="EngagementWriteFixture"/> (a single container) across the write suites.</summary>
[CollectionDefinition("EngagementWrite")]
public sealed class EngagementWriteCollection : ICollectionFixture<EngagementWriteFixture>;
