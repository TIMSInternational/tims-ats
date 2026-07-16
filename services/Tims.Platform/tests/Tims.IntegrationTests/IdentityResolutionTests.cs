using Tims.Application.Identity;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.2: end-to-end (real Postgres) proof that the EF-backed <see cref="IdentityRepository"/>
/// reads a TIMS staff user + its role slugs and that <see cref="PrincipalResolver"/> feeds them
/// through the pure <see cref="StaffContextResolver"/> to the correct <see cref="TenantContext"/>.
/// Read-only over the Prisma-owned tables; no writes, no RLS scope.
/// </summary>
[Collection("Identity")]
public sealed class IdentityResolutionTests(IdentitySchemaFixture fixture)
{
    private PrincipalResolver NewResolver(IdentityDbContext db) => new(new IdentityRepository(db));

    // ---- Assertion 1: active org staff → OrgUser, external role filtered out --------
    [Fact]
    public async Task ActiveOrgStaff_ResolvesToOrgUser_WithExternalRoleFiltered()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));
        var resolver = NewResolver(db);

        var result = await resolver.ResolveStaffAsync(IdentityFixture.ActiveStaffSub, CancellationToken.None);

        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.OrgUser, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.OrgA.ToString(), ctx.OrganizationId);
        Assert.Equal(IdentityFixture.ActiveStaffUserId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "recruiter" }, ctx.Roles); // 'external' dropped by FilterStaffRoleSlugs
        Assert.Null(ctx.ImpersonatedBy);
    }

    // ---- Assertion 2: platform owner → PlatformOwner, roles collapse ----------------
    [Fact]
    public async Task PlatformOwner_ResolvesToPlatformOwner_WithCollapsedRoles()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));
        var resolver = NewResolver(db);

        var result = await resolver.ResolveStaffAsync(IdentityFixture.PlatformOwnerSub, CancellationToken.None);

        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.PlatformOwner, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.PlatformOwnerUserId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "platform_owner" }, ctx.Roles); // recruiter grant collapses away
    }

    // ---- Assertion 3: inactive user → fall back -------------------------------------
    [Fact]
    public async Task InactiveUser_NeedsFallback()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));
        var resolver = NewResolver(db);

        var result = await resolver.ResolveStaffAsync(IdentityFixture.InactiveSub, CancellationToken.None);

        Assert.False(result.Resolved);
        Assert.Null(result.Context);
    }

    // ---- Assertion 4: unknown supabase_user_id → fall back --------------------------
    [Fact]
    public async Task UnknownSupabaseUserId_NeedsFallback()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));
        var resolver = NewResolver(db);

        var result = await resolver.ResolveStaffAsync(IdentityFixture.UnknownSub, CancellationToken.None);

        Assert.False(result.Resolved);
        Assert.Null(result.Context);
    }

    // ---- Assertion 5: repository maps a NULL organization_id (org-less owner) --------
    [Fact]
    public async Task FindBySupabaseUserId_MapsNullOrganizationId()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));
        var repository = new IdentityRepository(db);

        var row = await repository.FindBySupabaseUserIdAsync(IdentityFixture.OrglessOwnerSub, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Null(row.OrganizationId);
        Assert.True(row.IsPlatformOwner);
        Assert.Equal(IdentityFixture.OrglessOwnerUserId.ToString(), row.Id);

        // ...and the org-less owner still resolves (org-less owner → OrganizationId "").
        var result = StaffContextResolver.ResolveStaffContext(row, impersonationTarget: null);
        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.PlatformOwner, ctx.PrincipalType);
        Assert.Equal(string.Empty, ctx.OrganizationId);
    }
}
