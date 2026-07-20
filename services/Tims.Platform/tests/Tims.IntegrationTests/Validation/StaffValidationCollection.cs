namespace Tims.IntegrationTests.Validation;

/// <summary>xUnit collection so the Phase-5 staff-validation-write tests share ONE Postgres container.</summary>
[CollectionDefinition("StaffValidation")]
public sealed class StaffValidationCollection : ICollectionFixture<StaffValidationFixture>;
