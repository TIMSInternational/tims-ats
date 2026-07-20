namespace Tims.IntegrationTests.Reporting;

/// <summary>xUnit collection so the Phase-5 Slice 5 reporting read tests share ONE Postgres container.</summary>
[CollectionDefinition("ReportingRead")]
public sealed class ReportingReadCollection : ICollectionFixture<ReportingReadFixture>;
