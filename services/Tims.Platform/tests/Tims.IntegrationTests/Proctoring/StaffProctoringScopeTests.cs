using Microsoft.EntityFrameworkCore;
using Tims.Domain.Access;
using Tims.Api.Proctoring;
using Tims.Infrastructure.Proctoring;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>Characterizes the TS assessmentAssignment → vacancy scope rule used by staff review.</summary>
public sealed class StaffProctoringScopeTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly Guid OtherOrg = Guid.NewGuid();
    private static readonly Guid User = Guid.NewGuid();
    private static readonly Guid Team = Guid.NewGuid();
    private static readonly Guid Unit = Guid.NewGuid();
    private static readonly Guid VacancyId = Guid.NewGuid();

    [Theory]
    [InlineData(AccessScope.Own, true, false, false)]
    [InlineData(AccessScope.Team, false, true, false)]
    [InlineData(AccessScope.Unit, false, false, true)]
    [InlineData(AccessScope.Company, false, false, false)]
    [InlineData(AccessScope.Organization, false, false, false)]
    public void AssignmentVisibility_UsesVacancyAnchors(
        AccessScope accessScope, bool owned, bool inTeam, bool inUnit)
    {
        var scope = NewScope(accessScope);
        var vacancy = NewVacancy();
        vacancy.AssignedTo = owned ? User : null;
        vacancy.CreatedBy = owned ? User : Guid.NewGuid();
        vacancy.TeamId = inTeam ? Team : null;
        vacancy.BusinessUnitId = inUnit ? Unit : null;

        Assert.True(scope.CanAccess(NewAssignment(), vacancy));
        if (accessScope is AccessScope.Company or AccessScope.Organization) return;

        vacancy.AssignedTo = null;
        vacancy.CreatedBy = Guid.NewGuid();
        vacancy.TeamId = null;
        vacancy.BusinessUnitId = null;
        Assert.False(scope.CanAccess(NewAssignment(), vacancy));
    }

    [Fact]
    public void TeamScope_IncludesDirectlyAssignedVacancyOutsideLedTeams()
    {
        var vacancy = NewVacancy();
        vacancy.AssignedTo = User;
        Assert.True(NewScope(AccessScope.Team).CanAccess(NewAssignment(), vacancy));
    }

    [Fact]
    public void NarrowScopes_RejectDeletedVacancy_EvenWhenAnchorMatches()
    {
        foreach (var accessScope in new[] { AccessScope.Own, AccessScope.Team, AccessScope.Unit })
        {
            var vacancy = NewVacancy();
            vacancy.AssignedTo = User;
            vacancy.CreatedBy = User;
            vacancy.TeamId = Team;
            vacancy.BusinessUnitId = Unit;
            vacancy.DeletedAt = DateTime.UtcNow;
            Assert.False(NewScope(accessScope).CanAccess(NewAssignment(), vacancy));
        }
    }

    [Fact]
    public void EveryScope_RejectsCrossTenantAssignmentAndVacancy()
    {
        foreach (var accessScope in Enum.GetValues<AccessScope>())
        {
            var scope = NewScope(accessScope);
            var vacancy = NewVacancy();
            vacancy.AssignedTo = User;
            vacancy.CreatedBy = User;
            vacancy.TeamId = Team;
            vacancy.BusinessUnitId = Unit;

            var otherAssignment = NewAssignment();
            otherAssignment.OrganizationId = OtherOrg;
            Assert.False(scope.CanAccess(otherAssignment, vacancy));

            vacancy.OrganizationId = OtherOrg;
            Assert.False(scope.CanAccess(NewAssignment(), vacancy));
        }
    }

    [Fact]
    public void ScopeCannotUseUnrelatedVacancyAsAnchor()
    {
        var vacancy = NewVacancy();
        vacancy.Id = Guid.NewGuid();
        vacancy.AssignedTo = User;
        Assert.False(NewScope(AccessScope.Own).CanAccess(NewAssignment(), vacancy));
    }

    [Theory]
    [InlineData(AccessScope.Own, false)]
    [InlineData(AccessScope.Team, false)]
    [InlineData(AccessScope.Unit, false)]
    [InlineData(AccessScope.Company, true)]
    [InlineData(AccessScope.Organization, true)]
    public void OrgWidePolicyRequiresCompanyOrOrganizationScope(AccessScope scope, bool allowed) =>
        Assert.Equal(allowed, StaffProctoringEndpoints.CanSetOrgPolicy(scope));

    [Theory]
    [InlineData(AccessScope.Own)]
    [InlineData(AccessScope.Team)]
    [InlineData(AccessScope.Unit)]
    [InlineData(AccessScope.Company)]
    [InlineData(AccessScope.Organization)]
    public void VacancyScopeExpression_TranslatesToTenantFilteredPostgresSql(AccessScope accessScope)
    {
        var options = new DbContextOptionsBuilder<ProctoringDbContext>()
            .UseNpgsql("Host=localhost;Database=translation_only;Username=translation_only")
            .Options;
        using var db = new ProctoringDbContext(options);
        var scope = NewScope(accessScope);
        var visibleVacancyIds = db.Vacancies.Where(scope.VacancyPredicate())
            .Select(vacancy => vacancy.Id);
        var query = db.Assignments.Where(assignment =>
            assignment.OrganizationId == Org
            && visibleVacancyIds.Contains(assignment.VacancyId));

        var sql = query.ToQueryString();
        Assert.Contains("organization_id", sql, StringComparison.Ordinal);
        Assert.Contains("vacancies", sql, StringComparison.Ordinal);
        Assert.Contains("assessment_assignments", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void NeedsAttention_OnlyAfterThreeMinutesWithoutHeartbeat()
    {
        var now = new DateTime(2026, 9, 24, 12, 0, 0, DateTimeKind.Unspecified);
        var assignment = NewAssignment();
        assignment.Status = "in_progress";
        var session = new ProctoringSessionRow
        {
            StartedAt = now.AddMinutes(-10), LastHeartbeatAt = now.AddMinutes(-3),
        };
        Assert.False(StaffProctoringStore.NeedsAttention(session, assignment, now));

        session.LastHeartbeatAt = now.AddMinutes(-3).AddTicks(-1);
        Assert.True(StaffProctoringStore.NeedsAttention(session, assignment, now));

        session.EndedAt = now;
        Assert.False(StaffProctoringStore.NeedsAttention(session, assignment, now));
        session.EndedAt = null;
        assignment.Status = "completed";
        Assert.False(StaffProctoringStore.NeedsAttention(session, assignment, now));
    }

    [Fact]
    public void StaleSessionDoesNotBypassAssignmentScope()
    {
        var now = new DateTime(2026, 9, 24, 12, 0, 0, DateTimeKind.Unspecified);
        var assignment = NewAssignment();
        assignment.Status = "in_progress";
        var session = new ProctoringSessionRow { StartedAt = now.AddMinutes(-4) };
        var vacancy = NewVacancy();
        vacancy.AssignedTo = Guid.NewGuid();

        Assert.True(StaffProctoringStore.NeedsAttention(session, assignment, now));
        Assert.False(NewScope(AccessScope.Own).CanAccess(assignment, vacancy));
        vacancy.AssignedTo = User;
        Assert.True(NewScope(AccessScope.Own).CanAccess(assignment, vacancy));
    }

    private static StaffProctoringScope NewScope(AccessScope accessScope) =>
        new(Org, User, accessScope, [Team], [Unit]);

    private static ProctoringAssignmentRow NewAssignment() =>
        new() { Id = Guid.NewGuid(), OrganizationId = Org, VacancyId = VacancyId };

    private static ProctoringVacancyRow NewVacancy() =>
        new() { Id = VacancyId, OrganizationId = Org, CreatedBy = Guid.NewGuid() };
}
