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
    Guid[] UnitIds,
    IReadOnlyList<StaffProctoringRoleGrant>? RoleGrants = null)
{
    // A null grant set is retained for existing store-level scope tests. Every
    // HTTP OrgUser request supplies a non-null set loaded afresh from user_roles.
    public bool AllowsOrganizationPolicy => RoleGrants is null
        ? Scope is AccessScope.Company or AccessScope.Organization
        : RoleGrants.Any(grant => (grant.Scope is AccessScope.Company or AccessScope.Organization)
            && grant.CompanyScope is null && grant.UnitScope is null);

    public Expression<Func<ProctoringVacancyRow, bool>> VacancyPredicate()
    {
        if (RoleGrants is null) return BasePredicate(Scope);

        var vacancy = Expression.Parameter(typeof(ProctoringVacancyRow), "vacancy");
        Expression visible = Expression.Constant(false);
        foreach (var grant in RoleGrants)
        {
            var basePredicate = BasePredicate(grant.Scope);
            var scoped = new ParameterReplacement(basePredicate.Parameters[0], vacancy)
                .Visit(basePredicate.Body)!;
            if (grant.CompanyScope is { } companyId)
            {
                scoped = Expression.AndAlso(scoped,
                    Expression.Equal(Expression.Property(vacancy, nameof(ProctoringVacancyRow.CompanyId)),
                        Expression.Convert(Expression.Constant(companyId), typeof(Guid?))));
            }
            if (grant.UnitScope is { } unitId)
            {
                scoped = Expression.AndAlso(scoped,
                    Expression.Equal(Expression.Property(vacancy, nameof(ProctoringVacancyRow.BusinessUnitId)),
                        Expression.Convert(Expression.Constant(unitId), typeof(Guid?))));
            }
            visible = Expression.OrElse(visible, scoped);
        }
        return Expression.Lambda<Func<ProctoringVacancyRow, bool>>(visible, vacancy);
    }

    private Expression<Func<ProctoringVacancyRow, bool>> BasePredicate(AccessScope accessScope) => accessScope switch
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
            vacancy.OrganizationId == OrganizationId && vacancy.DeletedAt == null,
        _ => vacancy => false,
    };

    private sealed class ParameterReplacement(ParameterExpression oldParameter,
        ParameterExpression newParameter) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) =>
            node == oldParameter ? newParameter : base.VisitParameter(node);
    }

    // Same expression is used by the EF query; this evaluator makes scope parity testable
    // without a database or a separate, subtly divergent branch of authorization logic.
    public bool CanAccess(ProctoringAssignmentRow assignment, ProctoringVacancyRow vacancy) =>
        assignment.OrganizationId == OrganizationId
        && assignment.VacancyId == vacancy.Id
        && VacancyPredicate().Compile()(vacancy);
}

public sealed record StaffProctoringRoleGrant(
    AccessScope Scope, Guid? CompanyScope, Guid? UnitScope);
