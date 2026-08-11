namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Shares one Postgres container across the slice-21 tests: the full seven-table schema, plus a
/// no-<c>audit_logs</c> database (the fail-closed proof) and a no-<c>notifications</c> database (the
/// notify-propagation proof). Separate from the slice-20 collection because the two fixtures disagree
/// deliberately — see <see cref="PlatformOrganizationsCreateFixture"/>.
/// </summary>
[CollectionDefinition("PlatformOrganizationsCreate")]
public sealed class PlatformOrganizationsCreateCollection : ICollectionFixture<PlatformOrganizationsCreateFixture>;
