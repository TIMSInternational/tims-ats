using Tims.Application.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// Pins <see cref="PermissionCacheKey.Build"/> to the exact TS format
/// (packages/api/src/access/build.ts): <c>tims:access:{orgId}:{sorted roles}:{module}:{action}</c>,
/// roles sorted ascending and comma-joined — so a C# and a TS process share the same Redis entries.
/// A pure test (no container); lives here for the Application project reference.
/// </summary>
public sealed class PermissionCacheKeyTests
{
    [Fact]
    public void Build_ProducesExactFormat_WithSortedRoles()
    {
        var key = PermissionCacheKey.Build(
            "org-123",
            new[] { "recruiter", "hr_admin", "leader" },
            "candidate",
            "read");

        // Roles ascending (hr_admin < leader < recruiter), comma-joined.
        Assert.Equal("tims:access:org-123:hr_admin,leader,recruiter:candidate:read", key);
    }

    [Fact]
    public void Build_SingleRole_NoTrailingCommas()
    {
        var key = PermissionCacheKey.Build("org-1", new[] { "recruiter" }, "performance", "update");
        Assert.Equal("tims:access:org-1:recruiter:performance:update", key);
    }

    [Fact]
    public void Build_IsStable_RegardlessOfInputRoleOrder()
    {
        var a = PermissionCacheKey.Build("o", new[] { "b", "a", "c" }, "m", "x");
        var b = PermissionCacheKey.Build("o", new[] { "c", "b", "a" }, "m", "x");
        Assert.Equal(a, b);
        Assert.Equal("tims:access:o:a,b,c:m:x", a);
    }
}
