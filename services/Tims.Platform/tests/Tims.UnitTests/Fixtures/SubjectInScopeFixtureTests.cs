using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// WP2.5a: asserts the C# <see cref="SubjectInScope.IsSatisfiedAsync"/> port against the
/// SAME golden fixtures the TS suite (real assertSubjectInScope) asserts — see
/// tests/access/subject-in-scope-fixtures.test.ts. expected=true means the write is allowed;
/// expected=false means the caller must reject it (the TS throw; here the pure port returns false).
/// </summary>
public sealed class SubjectInScopeFixtureTests
{
    private static readonly SubjectInScopeRoot Data = Fx.Load<SubjectInScopeRoot>("subject-in-scope.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        Assert.True(AccessScopes.TryParse(c.Scope, out var scope), $"unknown scope wire: {c.Scope}");
        IAnchorLoader? anchors = c.HasAnchors ? new StubAnchorLoader(c.TeamMembers, c.UnitMembers) : null;

        var allowed = await SubjectInScope.IsSatisfiedAsync(scope, anchors, c.UserId, c.TargetUserId);

        Assert.Equal(c.Expected, allowed);
    }

    private sealed class StubAnchorLoader(List<string> teamMembers, List<string> unitMembers) : IAnchorLoader
    {
        public Task<IReadOnlyList<string>> TeamMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(teamMembers);
        public Task<IReadOnlyList<string>> UnitMemberIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(unitMembers);
        public Task<IReadOnlyList<string>> UnitIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
        public Task<IReadOnlyList<string>> PanelInterviewIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
        public Task<IReadOnlyList<string>> LedTeamIdsAsync(CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<string>>(Array.Empty<string>());
    }
}
