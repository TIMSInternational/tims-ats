using System.Text.Json.Nodes;
using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// WP2.5a: asserts the C# <see cref="ScopeWhereFor.BuildAsync"/> port against the SAME
/// golden fixtures the TS suite (real scopeWhereFor) asserts — see
/// tests/access/scope-where-fixtures.test.ts. Each case injects a DB-free stub loader
/// returning the fixture's anchor arrays and compares <c>.ToJsonNode()</c> to the fixture's
/// Prisma fragment (object comparison is key-order-insensitive, arrays order-sensitive).
/// </summary>
public sealed class ScopeWhereForFixtureTests
{
    private static readonly ScopeWhereRoot Data = Fx.Load<ScopeWhereRoot>("scope-where.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        Assert.True(ScopedEntities.TryParse(c.Entity, out var entity), $"unknown entity wire: {c.Entity}");
        Assert.True(AccessScopes.TryParse(c.Scope, out var scope), $"unknown scope wire: {c.Scope}");

        IAnchorLoader? anchors = c.Anchors is null ? null : new StubAnchorLoader(c.Anchors);

        if (c.ExpectError is not null)
        {
            Assert.Equal("FORBIDDEN", c.ExpectError);
            await Assert.ThrowsAsync<ScopeAnchorMissingException>(
                () => ScopeWhereFor.BuildAsync(entity, scope, anchors, c.UserId));
            return;
        }

        Assert.NotNull(c.Expected);
        var predicate = await ScopeWhereFor.BuildAsync(entity, scope, anchors, c.UserId);
        var actual = predicate.ToJsonNode();

        Assert.True(
            JsonNode.DeepEquals(actual, c.Expected),
            $"{c.Name}: fragment mismatch\n  expected: {c.Expected!.ToJsonString()}\n  actual:   {actual.ToJsonString()}");
    }

    private sealed class StubAnchorLoader(AnchorArraysDto a) : IAnchorLoader
    {
        public Task<IReadOnlyList<string>> TeamMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(a.TeamMemberIds);
        public Task<IReadOnlyList<string>> UnitIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(a.UnitIds);
        public Task<IReadOnlyList<string>> PanelInterviewIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(a.PanelInterviewIds);
        public Task<IReadOnlyList<string>> LedTeamIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(a.LedTeamIds);
        public Task<IReadOnlyList<string>> UnitMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(a.UnitMemberIds);
    }
}
