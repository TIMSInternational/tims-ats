using Tims.Domain.People;

namespace Tims.Application.People;

public sealed class AssignablePeopleUseCase(IAssignablePeopleRepository repository)
{
    public Task<AssignablePeopleResult> ListAsync(
        Guid organizationId,
        AssignablePurpose purpose,
        string? search,
        int limit,
        CancellationToken cancellationToken) =>
        ListAsync(organizationId, purpose, search, limit, null, cancellationToken)!;

    /// <summary>Returns <c>null</c> when <paramref name="vacancyId"/> is not a non-deleted vacancy of the organization.</summary>
    public async Task<AssignablePeopleResult?> ListAsync(
        Guid organizationId,
        AssignablePurpose purpose,
        string? search,
        int limit,
        Guid? vacancyId,
        CancellationToken cancellationToken)
    {
        // Vacancy-specific scope is only defined for the vacancy approver picker.
        if (vacancyId is not null && purpose != AssignablePurpose.VacancyApprover)
            throw new ArgumentException("vacancyId is only valid for the vacancy approver purpose", nameof(vacancyId));
        if (limit is < 1 or > AssignablePurposes.MaxLimit)
            throw new ArgumentOutOfRangeException(nameof(limit));
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (term is { Length: > AssignablePurposes.MaxSearchLength })
            throw new ArgumentOutOfRangeException(nameof(search));

        var people = await repository.ListAsync(
            organizationId, AssignablePurposes.RuleFor(purpose), term, limit, vacancyId, cancellationToken);
        return people is null ? null : new(people);
    }
}
