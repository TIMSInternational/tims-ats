using Tims.Domain.Identity;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Identity;

public sealed class FilterStaffRolesFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(string Name, List<string> Slugs, List<string> Expected);

    private static readonly Root Data = Fx.Load<Root>("identity-fixtures", "filter-staff-roles.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, RoleSlugs.FilterStaffRoleSlugs(c.Slugs));
    }
}
