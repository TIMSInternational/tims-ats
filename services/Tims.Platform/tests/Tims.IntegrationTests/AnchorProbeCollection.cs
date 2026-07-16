using Microsoft.EntityFrameworkCore;
using Tims.Infrastructure.Access;

namespace Tims.IntegrationTests;

/// <summary>Shares one Postgres container (schema + RLS + seed) across all WP2.5b tests.</summary>
[CollectionDefinition("AnchorProbe")]
public sealed class AnchorProbeCollection : ICollectionFixture<AnchorProbeFixture>;

/// <summary>
/// Minimal <see cref="IDbContextFactory{TContext}"/> for the tests — mints a fresh
/// <see cref="AnchorDbContext"/> per call (what <see cref="ScopedProbe"/> and the DI factory expect).
/// </summary>
public sealed class TestAnchorContextFactory(string connectionString) : IDbContextFactory<AnchorDbContext>
{
    public AnchorDbContext CreateDbContext() => new(AnchorProbeFixture.BuildOptions(connectionString));
}
