using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="FieldClassification"/> kernel to the shared golden fixture
/// (contracts/access-fixtures/field-classification.json), the SAME cases the TS vitest suite
/// (tests/access/field-classification-fixtures.test.ts) asserts against the REAL <c>fieldsVisibleTo</c>
/// / <c>selectFor</c>. A behavior change (e.g. dropping <c>external</c> from a field's roles) edits the
/// JSON once and turns BOTH stacks' CI red.
/// </summary>
public sealed class FieldClassificationFixtureTests
{
    private static readonly FieldClassificationRoot Data =
        Fx.Load<FieldClassificationRoot>("access-fixtures", "field-classification.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        IReadOnlyList<string> actual = c.Kind switch
        {
            "fieldsVisibleTo" => FieldClassification.FieldsVisibleTo(c.Roles, c.Entity),
            "selectFor" => FieldClassification.SelectFor(c.Roles, c.Entity),
            _ => throw new InvalidOperationException($"unknown case kind: {c.Kind}"),
        };

        // Order-sensitive: registry-declaration order (fieldsVisibleTo), anchors-then-fields (selectFor).
        Assert.Equal(c.Expected, actual);
    }
}
