using Tims.Domain.Access;
using Tims.Domain.People;

namespace Tims.UnitTests.People;

public sealed class VacancyApproverScopeTests
{
    private static readonly Guid Approver = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Other = Guid.Parse("00000000-0000-0000-0000-0000000000b2");
    private static readonly VacancyScopeAnchors Unanchored = new(Guid.NewGuid(), Guid.NewGuid(), Other, Other);

    [Theory]
    [InlineData(AccessScope.Organization)]
    [InlineData(AccessScope.Company)]
    public void OrgWideScopes_CoverEveryVacancy(AccessScope scope) =>
        Assert.True(VacancyApproverScope.Covers(scope, Approver, Unanchored, false, false));

    [Fact]
    public void Team_CoversOnlyTheLedTeamOrTheAssignee()
    {
        Assert.True(VacancyApproverScope.Covers(AccessScope.Team, Approver, Unanchored, leadsVacancyTeam: true, false));
        Assert.True(VacancyApproverScope.Covers(AccessScope.Team, Approver, Unanchored with { AssignedTo = Approver }, false, false));
        // Creator is an own-scope anchor, not a team one; a unit assignment is not a team anchor either.
        Assert.False(VacancyApproverScope.Covers(AccessScope.Team, Approver, Unanchored with { CreatedBy = Approver }, false, true));
    }

    [Fact]
    public void Unit_CoversOnlyAnAssignedActiveUnit()
    {
        Assert.True(VacancyApproverScope.Covers(AccessScope.Unit, Approver, Unanchored, false, assignedToVacancyUnit: true));
        // Widest-scope-wins: a unit-scoped approver does NOT keep the team arm (team is not a subset of unit).
        Assert.False(VacancyApproverScope.Covers(AccessScope.Unit, Approver, Unanchored with { AssignedTo = Approver }, true, false));
    }

    [Fact]
    public void Own_CoversAssigneeOrCreatorOnly()
    {
        Assert.True(VacancyApproverScope.Covers(AccessScope.Own, Approver, Unanchored with { AssignedTo = Approver }, false, false));
        Assert.True(VacancyApproverScope.Covers(AccessScope.Own, Approver, Unanchored with { CreatedBy = Approver }, false, false));
        Assert.False(VacancyApproverScope.Covers(AccessScope.Own, Approver, Unanchored, true, true));
    }
}
