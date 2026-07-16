using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class WidestScopeFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(string Name, List<string> Scopes, string Expected);

    private static readonly Root Data = Fx.Load<Root>("widest-scope.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var scopes = c.Scopes.Select(s =>
        {
            Assert.True(AccessScopes.TryParse(s, out var scope), $"Unknown scope '{s}'");
            return scope;
        });

        Assert.Equal(c.Expected, AccessScopes.WidestScope(scopes).ToWire());
    }
}
