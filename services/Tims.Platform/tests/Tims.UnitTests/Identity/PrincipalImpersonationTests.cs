using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.UnitTests.Identity;

public sealed class PrincipalImpersonationTests
{
    private const string Secret = "test-impersonation-secret";
    private static readonly DateTime Now = new(2026, 9, 14, 0, 0, 0, DateTimeKind.Utc);
    private static readonly AppUserRow Owner = new("owner", "sub", "", null, true, true, []);
    private static readonly AppUserRow Target = new("target", "target-sub", "", "org", true, false, ["recruiter"]);
    private static string Cookie(string actor = "owner", long ttl = 3600000) => "tims_impersonation=" +
        ImpersonationCookie.SignImpersonationToken(Secret, actor, "target", new DateTimeOffset(Now).ToUnixTimeMilliseconds(), ttl);

    [Fact]
    public async Task ValidClaimResolvesTargetAndPreservesRealActor()
    {
        var result = await new PrincipalResolver(new Repository(Target)).ResolveStaffAsync("sub", Cookie(), Secret, Now, default);
        Assert.Equal("target", result.Context?.UserId);
        Assert.Equal("owner", result.Context?.ImpersonatedBy);
        Assert.Equal(PrincipalType.OrgUser, result.Context?.PrincipalType);
    }

    [Fact]
    public async Task NoCookiePreservesOwner()
    {
        var result = await new PrincipalResolver(new Repository(Target)).ResolveStaffAsync("sub", default);
        Assert.Equal(PrincipalType.PlatformOwner, result.Context?.PrincipalType);
    }

    [Fact]
    public async Task InvalidClaimsNeverRestoreOwner()
    {
        foreach (var cookie in new[] { Cookie("another-owner"), Cookie(ttl: -1), "tims_impersonation=forged", "tims_impersonation=" })
        {
            var result = await new PrincipalResolver(new Repository(Target)).ResolveStaffAsync("sub", cookie, Secret, Now, default);
            Assert.False(result.Resolved);
        }
        var missingSecret = await new PrincipalResolver(new Repository(Target)).ResolveStaffAsync("sub", Cookie(), null, Now, default);
        Assert.False(missingSecret.Resolved);
        foreach (var target in new AppUserRow?[] { null, Target with { IsActive = false }, Target with { IsPlatformOwner = true }, Target with { OrganizationId = null } })
        {
            var result = await new PrincipalResolver(new Repository(target)).ResolveStaffAsync("sub", Cookie(), Secret, Now, default);
            Assert.False(result.Resolved);
        }
    }

    private sealed class Repository(AppUserRow? target) : IIdentityRepository
    {
        public Task<AppUserRow?> FindBySupabaseUserIdAsync(string id, CancellationToken ct) => Task.FromResult<AppUserRow?>(Owner);
        public Task<AppUserRow?> FindByIdAsync(string id, CancellationToken ct) => Task.FromResult(target);
    }
}
