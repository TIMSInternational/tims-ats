using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5 service-level parity (real Postgres): drives <see cref="PermissionService.CheckAsync"/>
/// directly against the EF-backed <see cref="PermissionGrantRepository"/> + the fail-soft
/// <see cref="NullPermissionCache"/>, proving the grant fetch + <see cref="AccessKernel"/> decision
/// match <c>buildAccessForUser</c> (build.ts). Read-only over the Prisma-owned RBAC tables.
/// </summary>
public sealed class PermissionServiceTests(PermissionFixture fixture) : IClassFixture<PermissionFixture>
{
    private static readonly Guid SomeUserId = Guid.Parse("f0000000-0000-0000-0000-0000000000aa");

    private PermissionService NewService(IdentityDbContext db) =>
        new(new PermissionGrantRepository(db), new NullPermissionCache());

    private TenantContext OrgUser(params string[] roles) =>
        new(PrincipalType.OrgUser, PermissionFixture.OrgA.ToString(), SomeUserId.ToString(), roles);

    private static IdentityDbContext NewDb(PermissionFixture fixture) =>
        new(IdentityFixture.BuildOptions(fixture.ConnectionString));

    // ---- Seeded grant → allowed at the seeded scope ---------------------------------
    [Fact]
    public async Task SeededGrant_Allowed_AtSeededScope()
    {
        await using var db = NewDb(fixture);
        var decision = await NewService(db)
            .CheckAsync(OrgUser(PermissionFixture.RecruiterSlug), "candidate", "read", CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Organization, decision.Scope);
        Assert.Equal(new[] { "recruiter" }, decision.Roles);
    }

    [Fact]
    public async Task NarrowScopeGrant_Allowed_AtThatScope()
    {
        await using var db = NewDb(fixture);
        var decision = await NewService(db)
            .CheckAsync(OrgUser(PermissionFixture.LeaderSlug), "performance", "read", CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Team, decision.Scope);
    }

    // ---- Role with no matching grant → denied ---------------------------------------
    [Fact]
    public async Task RoleWithoutMatchingGrant_Denied()
    {
        await using var db = NewDb(fixture);
        var decision = await NewService(db)
            .CheckAsync(OrgUser(PermissionFixture.EmployeeSlug), "candidate", "read", CancellationToken.None);

        Assert.False(decision.Allowed);
        Assert.Null(decision.Scope);
    }

    // ---- Multi-role stack → widest scope wins ---------------------------------------
    [Fact]
    public async Task MultiRoleStack_WidestScopeWins()
    {
        await using var db = NewDb(fixture);
        // recruiter grants candidate:read @ organization, leader @ team → organization (widest).
        var decision = await NewService(db).CheckAsync(
            OrgUser(PermissionFixture.LeaderSlug, PermissionFixture.RecruiterSlug),
            "candidate",
            "read",
            CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Organization, decision.Scope);
    }

    // ---- Legacy 'all' scope grant → organization ------------------------------------
    [Fact]
    public async Task LegacyAllScopeGrant_MapsToOrganization()
    {
        await using var db = NewDb(fixture);
        var decision = await NewService(db)
            .CheckAsync(OrgUser(PermissionFixture.LegacySlug), "candidate", "read", CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Organization, decision.Scope);
    }

    // ---- Privileged (platform_owner) → allowed organization, NO seeded grant --------
    [Fact]
    public async Task PlatformOwner_Allowed_Organization_WithoutSeededGrant()
    {
        await using var db = NewDb(fixture);
        var owner = new TenantContext(
            PrincipalType.PlatformOwner,
            PermissionFixture.OrgA.ToString(),
            SomeUserId.ToString(),
            new[] { "platform_owner" });

        // candidate:delete has NO seeded grant at all — privileged short-circuits without a fetch.
        var decision = await NewService(db).CheckAsync(owner, "candidate", "delete", CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Organization, decision.Scope);
        Assert.Equal(new[] { "platform_owner" }, decision.Roles);
    }

    // ---- Privileged (super_admin, not owner) → allowed organization, NO seeded grant -
    [Fact]
    public async Task SuperAdmin_Allowed_Organization_WithoutSeededGrant()
    {
        await using var db = NewDb(fixture);
        var decision = await NewService(db)
            .CheckAsync(OrgUser("super_admin"), "candidate", "delete", CancellationToken.None);

        Assert.True(decision.Allowed);
        Assert.Equal(AccessScope.Organization, decision.Scope);
        Assert.Equal(new[] { "super_admin" }, decision.Roles);
    }

    // ---- Privileged org-less → TenantOrgRequiredException ---------------------------
    [Fact]
    public async Task PlatformOwner_WithoutOrg_Throws()
    {
        await using var db = NewDb(fixture);
        var orglessOwner = new TenantContext(
            PrincipalType.PlatformOwner, string.Empty, SomeUserId.ToString(), new[] { "platform_owner" });

        await Assert.ThrowsAsync<TenantOrgRequiredException>(() =>
            NewService(db).CheckAsync(orglessOwner, "candidate", "read", CancellationToken.None));
    }
}
