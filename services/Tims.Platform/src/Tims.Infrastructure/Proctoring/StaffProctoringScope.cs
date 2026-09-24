using System.Linq.Expressions;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// The assessment-assignment scope is anchored through its vacancy, matching the TS
/// scopeWhereFor('assessmentAssignment') rule. A deleted or cross-tenant vacancy never grants access.
/// </summary>
public sealed record StaffProctoringScope(
    Guid OrganizationId,
    Guid UserId,
    AccessScope Scope,
    Guid[] LedTeamIds,
    Guid[] UnitIds)
{
    public Expression<Func<ProctoringVacancyRow, bool>> VacancyPredicate() => Scope switch
    {
        AccessScope.Own => vacancy =>
            vacancy.OrganizationId == OrganizationId && vacancy.DeletedAt == null
            && (vacancy.AssignedTo == UserId || vacancy.CreatedBy == UserId),
        AccessScope.Team => vacancy =>
            vacancy.OrganizationId == OrganizationId && vacancy.DeletedAt == null
            && ((vacancy.TeamId.HasValue && LedTeamIds.Contains(vacancy.TeamId.Value))
                || vacancy.AssignedTo == UserId),
        AccessScope.Unit => vacancy =>
            vacancy.OrganizationId == OrganizationId && vacancy.DeletedAt == null
            && vacancy.BusinessUnitId.HasValue && UnitIds.Contains(vacancy.BusinessUnitId.Value),
        AccessScope.Company or AccessScope.Organization => vacancy =>
            vacancy.OrganizationId == OrganizationId,
        _ => vacancy => false,
    };

    // Same expression is used by the EF query; this evaluator makes scope parity testable
    // without a database or a separate, subtly divergent branch of authorization logic.
    public bool CanAccess(ProctoringAssignmentRow assignment, ProctoringVacancyRow vacancy) =>
        assignment.OrganizationId == OrganizationId
        && assignment.VacancyId == vacancy.Id
        && VacancyPredicate().Compile()(vacancy);
}
