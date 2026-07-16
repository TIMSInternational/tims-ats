using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class ExternalScopeFixtureTests
{
    private static readonly ExternalRoot Data = Fx.Load<ExternalRoot>("external-scope.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var actual = ExternalScope.ExternalScopeSatisfied(c.RequiredScope, c.Scopes, c.AlwaysEnforceScope);
        Assert.Equal(c.Expected, actual);
    }
}
