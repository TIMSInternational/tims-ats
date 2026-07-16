using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class RequireOrgScopeFixtureTests
{
    private static readonly OrgScopeRoot Data = Fx.Load<OrgScopeRoot>("require-org-scope.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        Assert.True(AccessScopes.TryParse(c.Scope, out var scope), $"Unknown scope '{c.Scope}'");
        Assert.Equal(c.Expected, OrgGate.RequireOrgScopeSatisfied(scope));
    }
}
