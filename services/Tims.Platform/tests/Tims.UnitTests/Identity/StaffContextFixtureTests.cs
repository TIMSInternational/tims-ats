using Tims.Domain.Identity;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Identity;

public sealed class StaffContextFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record AppUserDto(
        string Id, string SupabaseUserId, string Email, string? OrganizationId,
        bool IsActive, bool IsPlatformOwner, List<string> RoleSlugs);
    private sealed record ExpectedCtx(
        bool Resolved, PrincipalType? PrincipalType, string? OrganizationId, string? UserId,
        List<string>? Roles, string? ImpersonatedBy);
    private sealed record Case(string Name, AppUserDto? AppUser, AppUserDto? Target, ExpectedCtx Expected);

    private static readonly Root Data = Fx.Load<Root>("identity-fixtures", "staff-context.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    private static AppUserRow? Row(AppUserDto? dto) => dto is null
        ? null
        : new AppUserRow(dto.Id, dto.SupabaseUserId, dto.Email, dto.OrganizationId, dto.IsActive, dto.IsPlatformOwner, dto.RoleSlugs);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var result = StaffContextResolver.ResolveStaffContext(Row(c.AppUser), Row(c.Target));

        Assert.Equal(c.Expected.Resolved, result.Resolved);
        if (!c.Expected.Resolved)
        {
            Assert.Null(result.Context);
            return;
        }

        var ctx = result.Context!;
        Assert.Equal(c.Expected.PrincipalType, ctx.PrincipalType);
        Assert.Equal(c.Expected.OrganizationId, ctx.OrganizationId);
        Assert.Equal(c.Expected.UserId, ctx.UserId);
        Assert.Equal(c.Expected.Roles, ctx.Roles);
        Assert.Equal(c.Expected.ImpersonatedBy, ctx.ImpersonatedBy);
    }
}
