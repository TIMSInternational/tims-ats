namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Shares one Postgres container across the <c>ListAsync</c> AND <c>GetByIdAsync</c> projection tests
/// (#211). Separate from the slice-20 and slice-21 collections because this fixture creates the eleven
/// tables the READ path needs, which neither of those does — see
/// <see cref="PlatformOrganizationsReadListFixture"/>. Both test classes join THIS collection rather than
/// standing up a second container: the seeds are disjoint by organization id, and a container per class
/// is the slowest possible way to buy nothing.
/// </summary>
[CollectionDefinition("PlatformOrganizationsReadList")]
public sealed class PlatformOrganizationsReadListCollection : ICollectionFixture<PlatformOrganizationsReadListFixture>;
