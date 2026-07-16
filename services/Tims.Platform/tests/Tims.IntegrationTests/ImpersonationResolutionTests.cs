using Tims.Application.Identity;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.4 end-to-end (real Postgres): a platform owner presenting a VALID HMAC impersonation cookie
/// resolves — via <see cref="PrincipalResolver"/> + the EF <see cref="IdentityRepository"/> +
/// <see cref="ImpersonationCookie"/> + the pure <see cref="StaffContextResolver"/> — to the TARGET's
/// org and (filtered) roles with <c>ImpersonatedBy</c> set, while every fail-closed path
/// (forged/expired cookie, non-owner caller, owner-target) yields the caller's OWN context.
///
/// Reuses <see cref="IdentityFixture"/>: PlatformOwner is the impersonator, ActiveStaff is the valid
/// target (active, org, non-owner), and OrglessOwner is "another owner" (a rejected target).
/// </summary>
public sealed class ImpersonationResolutionTests(IdentityFixture fixture) : IClassFixture<IdentityFixture>
{
    private const string Secret = "integration-impersonation-secret";
    private static readonly DateTime Now = new(2026, 7, 16, 12, 0, 0, DateTimeKind.Utc);
    private static readonly long NowUnixMs = new DateTimeOffset(Now).ToUnixTimeMilliseconds();

    private PrincipalResolver NewResolver(IdentityDbContext db) => new(new IdentityRepository(db));

    private static string Cookie(string token) => $"{ImpersonationCookie.CookieName}={token}";

    // ---- Assertion 1: owner + valid cookie → resolves to the TARGET, ImpersonatedBy = owner ----
    [Fact]
    public async Task Owner_WithValidCookie_ResolvesToTarget()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.PlatformOwnerUserId.ToString(), IdentityFixture.ActiveStaffUserId.ToString(), NowUnixMs);

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.PlatformOwnerSub, Cookie(token), Secret, Now, CancellationToken.None);

        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.OrgUser, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.OrgA.ToString(), ctx.OrganizationId);
        Assert.Equal(IdentityFixture.ActiveStaffUserId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "recruiter" }, ctx.Roles); // 'external' filtered out
        Assert.Equal(IdentityFixture.PlatformOwnerUserId.ToString(), ctx.ImpersonatedBy);
    }

    // ---- Assertion 2a: owner + FORGED cookie → owner's own PlatformOwner context -----
    [Fact]
    public async Task Owner_WithForgedCookie_ResolvesToOwnOwnerContext()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.PlatformOwnerUserId.ToString(), IdentityFixture.ActiveStaffUserId.ToString(), NowUnixMs);
        var forged = token[..^1] + (token[^1] == 'A' ? 'B' : 'A'); // flip last sig char

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.PlatformOwnerSub, Cookie(forged), Secret, Now, CancellationToken.None);

        AssertOwnerOwnContext(result);
    }

    // ---- Assertion 2b: owner + EXPIRED cookie → owner's own PlatformOwner context ----
    [Fact]
    public async Task Owner_WithExpiredCookie_ResolvesToOwnOwnerContext()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        // Signed two hours ago with the default 1h TTL → already expired at Now.
        var signedAt = NowUnixMs - (2 * ImpersonationCookie.DefaultTtlMs);
        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.PlatformOwnerUserId.ToString(), IdentityFixture.ActiveStaffUserId.ToString(), signedAt);

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.PlatformOwnerSub, Cookie(token), Secret, Now, CancellationToken.None);

        AssertOwnerOwnContext(result);
    }

    // ---- Assertion 2c: owner, secret UNSET → impersonation unavailable, own context --
    [Fact]
    public async Task Owner_WithValidCookieButNoSecret_ResolvesToOwnOwnerContext()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.PlatformOwnerUserId.ToString(), IdentityFixture.ActiveStaffUserId.ToString(), NowUnixMs);

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.PlatformOwnerSub, Cookie(token), impersonationSecret: null, Now, CancellationToken.None);

        AssertOwnerOwnContext(result);
    }

    // ---- Assertion 3: NON-owner + valid cookie → that user's own context (target ignored) ----
    [Fact]
    public async Task NonOwner_WithValidCookie_ResolvesToOwnContext_TargetIgnored()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        // A cookie that would impersonate the org-less owner — must be IGNORED for a non-owner caller.
        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.ActiveStaffUserId.ToString(), IdentityFixture.OrglessOwnerUserId.ToString(), NowUnixMs);

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.ActiveStaffSub, Cookie(token), Secret, Now, CancellationToken.None);

        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.OrgUser, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.ActiveStaffUserId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "recruiter" }, ctx.Roles);
        Assert.Null(ctx.ImpersonatedBy);
    }

    // ---- Assertion 4: owner impersonating ANOTHER OWNER → rejected, owner's own context ----
    [Fact]
    public async Task Owner_ImpersonatingAnotherOwner_ResolvesToOwnOwnerContext()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        // Target is the org-less owner — StaffContextResolver rejects an owner target (not-owner rule).
        var token = ImpersonationCookie.SignImpersonationToken(
            Secret, IdentityFixture.PlatformOwnerUserId.ToString(), IdentityFixture.OrglessOwnerUserId.ToString(), NowUnixMs);

        var result = await resolver.ResolveStaffAsync(
            IdentityFixture.PlatformOwnerSub, Cookie(token), Secret, Now, CancellationToken.None);

        AssertOwnerOwnContext(result);
    }

    // ---- No-cookie overload still resolves the owner's own context -------------------
    [Fact]
    public async Task NoCookieOverload_ResolvesOwnerOwnContext()
    {
        await using var db = new IdentityDbContext(IdentityFixture.BuildOptions(fixture.ConnectionString));
        var resolver = NewResolver(db);

        var result = await resolver.ResolveStaffAsync(IdentityFixture.PlatformOwnerSub, CancellationToken.None);

        AssertOwnerOwnContext(result);
    }

    private static void AssertOwnerOwnContext(StaffResolution result)
    {
        Assert.True(result.Resolved);
        var ctx = Assert.IsType<TenantContext>(result.Context);
        Assert.Equal(PrincipalType.PlatformOwner, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.PlatformOwnerUserId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "platform_owner" }, ctx.Roles);
        Assert.Null(ctx.ImpersonatedBy);
    }
}
