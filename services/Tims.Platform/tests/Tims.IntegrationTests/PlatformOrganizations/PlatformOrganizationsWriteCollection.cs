namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>Shares one Postgres container (the full write schema + a no-audit_logs DB) across the slice-20 tests.</summary>
[CollectionDefinition("PlatformOrganizationsWrite")]
public sealed class PlatformOrganizationsWriteCollection : ICollectionFixture<PlatformOrganizationsWriteFixture>;
