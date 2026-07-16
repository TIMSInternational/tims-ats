using Tims.Domain.Audit;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Audit;

/// <summary>
/// Pins <see cref="AuditPolicy.AuditRequiredFor"/> to the shared golden fixture
/// (contracts/audit-fixtures/audit-required.json), the SAME cases the TS vitest suite asserts against
/// the real <c>auditRequiredFor</c>. confidential + restricted must be logged; public/internal not.
/// </summary>
public sealed class AuditPolicyFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(string Name, string Entity, bool Expected);

    private static readonly Root Data = Fx.Load<Root>("audit-fixtures", "audit-required.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, AuditPolicy.AuditRequiredFor(c.Entity));
    }
}
