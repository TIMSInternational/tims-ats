using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="ExternalScope.ExternalScopeSatisfied"/> to the shared golden fixture
/// (contracts/external-fixtures/validation-submit-scope.json), the SAME cases the TS vitest suite
/// (tests/external-vendor/validation-submit-scope-fixtures.test.ts) asserts against the REAL
/// <c>externalScopeSatisfied</c>. Every case runs with <c>alwaysEnforceScope=true</c> (the vendor WRITE),
/// so the empty-scope case is DENIED — the contrast with the read surface's wildcard.
///
/// BITES: flipping the endpoint's <c>alwaysEnforceScope</c> to false would let an empty-scope key satisfy
/// the write, which the "empty scopes, ENFORCED -> denied" case catches here (and the endpoint auth test
/// catches over the wire).
/// </summary>
public sealed class ValidationSubmitScopeFixtureTests
{
    private static readonly ExternalRoot Data = Fx.Load<ExternalRoot>("external-fixtures", "validation-submit-scope.json");

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
