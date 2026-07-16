using Tims.Domain.RateLimiting;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.RateLimiting;

/// <summary>
/// Pins <see cref="RateLimitPolicy.CategoryFor"/> to the shared golden fixture
/// (contracts/ratelimit-fixtures/category.json), the SAME cases the TS vitest suite asserts
/// against the real <c>getRateLimitCategory</c>. A behavior change edits the JSON once; either
/// stack disagreeing turns its CI red.
/// </summary>
public sealed class RateLimitCategoryFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(string Name, string Path, RateLimitRequestType Type, RateLimitCategory Expected);

    private static readonly Root Data = Fx.Load<Root>("ratelimit-fixtures", "category.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, RateLimitPolicy.CategoryFor(c.Path, c.Type));
    }
}
