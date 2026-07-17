namespace Tims.IntegrationTests.Billing;

/// <summary>xUnit collection so the Phase-5 Slice 3 billing read tests share ONE Postgres container.</summary>
[CollectionDefinition("BillingRead")]
public sealed class BillingReadCollection : ICollectionFixture<BillingReadFixture>;
