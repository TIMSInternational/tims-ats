using Tims.Domain.Audit;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Audit;

/// <summary>
/// Pins <see cref="DataClassification.Of"/> to the shared golden fixture
/// (contracts/audit-fixtures/classification.json), the SAME cases the TS vitest suite asserts against
/// the real <c>dataClassOf</c>. A behavior change edits the JSON once; either stack disagreeing turns
/// its CI red.
/// </summary>
public sealed class DataClassificationFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(string Name, string Entity, DataClass Expected);

    private static readonly Root Data = Fx.Load<Root>("audit-fixtures", "classification.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, DataClassification.Of(c.Entity));
    }
}
