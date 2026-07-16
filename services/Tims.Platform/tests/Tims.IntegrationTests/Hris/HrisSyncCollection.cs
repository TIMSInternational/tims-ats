namespace Tims.IntegrationTests.Hris;

/// <summary>
/// Shares one Postgres container (the hris_* tables + data_access_logs, both under RLS) across the
/// DB-backed sync tests. xUnit runs a collection's tests serially, so each test's
/// <see cref="HrisSyncFixture.ResetAsync"/> gives it a clean slate without a fresh container spin-up.
/// </summary>
[CollectionDefinition("HrisSync")]
public sealed class HrisSyncCollection : ICollectionFixture<HrisSyncFixture>;
