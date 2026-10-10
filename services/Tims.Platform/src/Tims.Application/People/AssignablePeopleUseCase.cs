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
        ListAsync(organizationId, purpose, search, limit, null, null, cancellationToken)!;

    /// <summary>
    /// Returns <c>null</c> when <paramref name="vacancy"/> names a vacancy that is not a non-deleted vacancy of the
    /// organization, or one outside the caller's own vacancy scope (the two are indistinguishable by design).
    /// </summary>
    public async Task<AssignablePeopleResult?> ListAsync(
        Guid organizationId,
        AssignablePurpose purpose,
        string? search,
        int limit,
        VacancyApproverFilter? vacancy,
        IReadOnlyCollection<Guid>? subjects,
        CancellationToken cancellationToken)
    {
        // Vacancy-specific scope is only defined for the vacancy approver picker.
        if (vacancy is not null && purpose != AssignablePurpose.VacancyApprover)
            throw new ArgumentException("vacancyId is only valid for the vacancy approver purpose", nameof(vacancy));
        // A subject set only ever narrows a subject-scoped purpose (AssignablePurposes.NeedsSubjectFilter).
        if (subjects is not null && !AssignablePurposes.RuleFor(purpose).SubjectScoped)
            throw new ArgumentException("subjects are only valid for a subject-scoped purpose", nameof(subjects));
        if (limit is < 1 or > AssignablePurposes.MaxLimit)
            throw new ArgumentOutOfRangeException(nameof(limit));
        var term = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (term is { Length: > AssignablePurposes.MaxSearchLength })
            throw new ArgumentOutOfRangeException(nameof(search));

        var people = await repository.ListAsync(
            organizationId, AssignablePurposes.RuleFor(purpose), term, limit, vacancy, subjects, cancellationToken);
        return people is null ? null : new(people);
    }
}
