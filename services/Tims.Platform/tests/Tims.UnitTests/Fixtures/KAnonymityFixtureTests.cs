using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

public sealed class KAnonymityFixtureTests
{
    private static readonly KAnonRoot Data = Fx.Load<KAnonRoot>("k-anon-min5.json");

    public static IEnumerable<object[]> SuppressCases() =>
        Fx.Rows(Data.SuppressCases.Select(c => c.Name).ToList());

    public static IEnumerable<object[]> GroupCases() =>
        Fx.Rows(Data.GroupCases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(SuppressCases))]
    public void SuppressBelowMin5_matches_fixture(int index, string name)
    {
        var c = Data.SuppressCases[index];
        Assert.Equal(name, c.Name);

        var actual = KAnonymity.SuppressBelowMin5(c.Count);
        Assert.Equal(c.Expected.Suppressed, actual.Suppressed);
        Assert.Equal(c.Expected.Count, actual.Count);
    }

    [Theory]
    [MemberData(nameof(GroupCases))]
    public void AggregateGroups_matches_fixture(int index, string name)
    {
        var c = Data.GroupCases[index];
        Assert.Equal(name, c.Name);

        var actual = KAnonymity.AggregateGroups(c.Keys);

        Assert.Equal(c.Expected.Count, actual.Count);
        for (var i = 0; i < c.Expected.Count; i++)
        {
            Assert.Equal(c.Expected[i].Key, actual[i].Key);
            Assert.Equal(c.Expected[i].Count, actual[i].Count);
            Assert.Equal(c.Expected[i].Suppressed, actual[i].Suppressed);
        }
    }
}
