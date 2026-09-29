using Tims.Domain.People;

namespace Tims.Application.People;

public interface IAssignablePeopleRepository
{
    /// <summary>
    /// Active, non-deleted users of <paramref name="organizationId"/> (read under TenantScope). When
    /// <paramref name="rule"/> names an eligibility permission, only users holding it through one of
    /// their ACTIVE staff roles in the same organization (or through an active <c>super_admin</c> role) are returned.
    /// </summary>
    /// <remarks>
    /// With <paramref name="vacancyId"/>, only approvers whose resolved <c>vacancy:approve</c> scope covers that
    /// vacancy are returned (see <see cref="VacancyApproverScope"/>); returns <c>null</c> when the vacancy is
    /// not a non-deleted vacancy of the organization.
    /// </remarks>
    Task<IReadOnlyList<AssignablePerson>?> ListAsync(
        Guid organizationId,
        AssignablePurposeRule rule,
        string? search,
        int limit,
        Guid? vacancyId,
        CancellationToken cancellationToken);
}
