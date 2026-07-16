using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class Eval360FixtureTests
{
    private static readonly Eval360Root Data = Fx.Load<Eval360Root>("eval360-min3.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var rows = c.Rows
            .Select(r => new Eval360Aggregate.AggregateInputRow(
                r.AssignmentId, r.Relationship, r.CompetencyKey, r.Rating, r.Comment))
            .ToList();

        var actual = Eval360Aggregate.Aggregate360Report(rows);

        Assert.Equal(c.Expected.Count, actual.Count);
        for (var i = 0; i < c.Expected.Count; i++)
        {
            var e = c.Expected[i];
            var a = actual[i];
            Assert.Equal(e.Relationship, a.Relationship);
            Assert.Equal(e.RaterCount, a.RaterCount);

            Assert.Equal(e.Competencies.Count, a.Competencies.Count);
            for (var j = 0; j < e.Competencies.Count; j++)
            {
                Assert.Equal(e.Competencies[j].CompetencyKey, a.Competencies[j].CompetencyKey);
                // averages are doubles seeded from JS Math.round output; compare within epsilon
                Assert.True(Math.Abs(e.Competencies[j].Average - a.Competencies[j].Average) < 1e-9,
                    $"average mismatch for {a.Relationship}/{a.Competencies[j].CompetencyKey}: " +
                    $"expected {e.Competencies[j].Average}, got {a.Competencies[j].Average}");
            }

            Assert.Equal(e.Comments, a.Comments);
        }
    }
}
