using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class BuildAccessFixtureTests
{
    private static readonly BuildRoot Data = Fx.Load<BuildRoot>("build-access.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var principal = new AccessPrincipal(
            c.Principal.Roles, c.Principal.OrganizationId, c.Principal.IsPlatformOwner);
        var grants = c.Grants.Select(Fx.ToGrant).ToList();

        if (c.ExpectThrow == "org_required")
        {
            Assert.Throws<TenantOrgRequiredException>(
                () => AccessKernel.Decide(principal, grants, c.Module, c.Action));
            return;
        }

        Assert.NotNull(c.Expected);
        var decision = AccessKernel.Decide(principal, grants, c.Module, c.Action);
        Fx.AssertDecision(c.Expected!, decision);
    }
}
