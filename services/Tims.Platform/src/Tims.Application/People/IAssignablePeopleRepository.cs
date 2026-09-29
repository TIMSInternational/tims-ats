using Tims.Domain.People;

namespace Tims.Application.People;

public interface IAssignablePeopleRepository
{
    /// <summary>
    /// Active, non-deleted users of <paramref name="organizationId"/> (read under TenantScope). When
    /// <paramref name="rule"/> names an eligibility permission, only users holding it through one of
    /// their staff roles in the same organization (or through <c>super_admin</c>) are returned.
    /// </summary>
    Task<IReadOnlyList<AssignablePerson>> ListAsync(
        Guid organizationId,
        AssignablePurposeRule rule,
        string? search,
        int limit,
        CancellationToken cancellationToken);
}
