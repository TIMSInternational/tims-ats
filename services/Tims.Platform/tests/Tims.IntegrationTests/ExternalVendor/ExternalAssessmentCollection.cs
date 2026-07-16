namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>xUnit collection so the Phase-5 Slice 1 read tests share ONE Postgres container.</summary>
[CollectionDefinition("ExternalAssessment")]
public sealed class ExternalAssessmentCollection : ICollectionFixture<ExternalAssessmentFixture>;
