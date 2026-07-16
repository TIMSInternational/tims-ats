namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>xUnit collection so the Phase-5 Slice 2 write tests share ONE Postgres container.</summary>
[CollectionDefinition("ExternalValidation")]
public sealed class ExternalValidationCollection : ICollectionFixture<ExternalValidationFixture>;
