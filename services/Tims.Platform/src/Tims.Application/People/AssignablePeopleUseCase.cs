using Tims.Domain.Identity;
using Tims.Domain.People;

namespace Tims.Application.People;

public sealed class AssignablePeopleUseCase(IAssignablePeopleRepository repository)
{
    public async Task<AssignablePeopleResult> ListAsync(
        Guid organizationId,
        AssignablePurpose purpose,
        string? search,
        int limit,
        CancellationToken cancellationToken)
    {
        if (limit is < 1 or > AssignablePurposes.MaxLimit)
            throw new ArgumentOutOfRangeException(nameof(limit));
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (term is { Length: > AssignablePurposes.MaxSearchLength })
            throw new ArgumentOutOfRangeException(nameof(search));

        var people = await repository.ListAsync(
            organizationId, AssignablePurposes.RuleFor(purpose), term, limit, cancellationToken);
        // Non-staff principals (external API keys, candidates) are never surfaced as a role hint.
        return new(people.Select(person => person with
        {
            RoleSlugs = RoleSlugs.FilterStaffRoleSlugs(person.RoleSlugs.Distinct(StringComparer.Ordinal)),
        }).ToList());
    }
}
