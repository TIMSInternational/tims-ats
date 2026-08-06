namespace Tims.IntegrationTests.Monitoring;

/// <summary>xUnit collection so the Phase-5 Q0b slice 1 monitoring read tests share ONE Postgres container.</summary>
[CollectionDefinition("MonitoringRead")]
public sealed class MonitoringReadCollection : ICollectionFixture<MonitoringReadFixture>;
