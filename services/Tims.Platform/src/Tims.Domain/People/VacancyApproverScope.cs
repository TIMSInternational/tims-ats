using Tims.Domain.Access;

namespace Tims.Domain.People;

/// <summary>The anchor columns of one (in-tenant, non-deleted) vacancy that approver scope is decided on.</summary>
public sealed record VacancyScopeAnchors(Guid? TeamId, Guid? BusinessUnitId, Guid? AssignedTo, Guid? CreatedBy);

/// <summary>
/// <c>?vacancyId</c> on the vacancy approver picker: the vacancy to narrow the list to, and the CALLER with the
/// scope of the picker permission they were authorized on (vacancy:update). The caller's own scope must cover
/// the vacancy — the check <c>vacancy.submitForApproval</c> runs on the caller before anything else
/// (<c>assertScoped('vacancy', id, ctx.access, …)</c>) — otherwise the vacancy is treated as not found, so an
/// in-tenant id outside the caller's scope is indistinguishable from an unknown one (no existence oracle).
/// </summary>
public sealed record VacancyApproverFilter(Guid VacancyId, Guid CallerUserId, AccessScope CallerScope);

/// <summary>
/// Pure port of "would <c>assertScoped('vacancy', id, approverAccess, approverId)</c> pass" — the check
/// <c>vacancy.submitForApproval</c> runs per approver (packages/api/src/routers/vacancy/approvals.ts) —
/// evaluated against ONE vacancy with the approver's already-resolved widest <c>vacancy:approve</c> scope
/// (<see cref="AccessKernel.Decide"/>) and the approver's anchors for that vacancy:
/// <list type="bullet">
///   <item><description>organization/company → every vacancy (scopeWhereFor returns <c>{}</c>).</description></item>
///   <item><description>team → vacancy.teamId ∈ ledTeamIds (active teams the approver leads) OR assignedTo = approver.</description></item>
///   <item><description>unit → vacancy.businessUnitId ∈ unitIds (approver's user_business_units whose unit is active).</description></item>
///   <item><description>own → assignedTo = approver OR createdBy = approver.</description></item>
/// </list>
/// </summary>
public static class VacancyApproverScope
{
    /// <param name="leadsVacancyTeam">The vacancy has a team, that team is active, in the org, and led by the approver.</param>
    /// <param name="assignedToVacancyUnit">The vacancy has a unit, it is active, and the approver is assigned to it.</param>
    public static bool Covers(
        AccessScope scope,
        Guid approverId,
        VacancyScopeAnchors vacancy,
        bool leadsVacancyTeam,
        bool assignedToVacancyUnit) => scope switch
        {
            AccessScope.Organization or AccessScope.Company => true,
            AccessScope.Team => leadsVacancyTeam || vacancy.AssignedTo == approverId,
            AccessScope.Unit => assignedToVacancyUnit,
            AccessScope.Own => vacancy.AssignedTo == approverId || vacancy.CreatedBy == approverId,
            _ => false,
        };
}
