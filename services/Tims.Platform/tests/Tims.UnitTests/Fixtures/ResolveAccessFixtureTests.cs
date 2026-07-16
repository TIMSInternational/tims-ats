using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class ResolveAccessFixtureTests
{
    private static readonly ResolveRoot Data = Fx.Load<ResolveRoot>("resolve-access.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name); // guards index/name drift

        var decision = AccessResolver.ResolveAccess(
            c.Grants.Select(Fx.ToGrant), c.Module, c.Action);

        Fx.AssertDecision(c.Expected, decision);
    }
}
