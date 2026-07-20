using Tims.Domain.Validation;

namespace Tims.Application.Validation;

/// <summary>
/// The staff <c>updateValidation</c> use case — a faithful port of the TS mutation's data steps. The
/// endpoint orchestrates fetch → assertScoped('offer') → update (the scope probe is an Api/Infrastructure
/// concern), so this use case exposes the two data operations the endpoint sequences around the probe.
/// </summary>
public sealed class StaffValidationUpdateUseCase(IStaffValidationRepository repository)
{
    private readonly IStaffValidationRepository _repository = repository;

    /// <summary>The validation's parent offer id (for the scope probe), or null → NOT_FOUND.</summary>
    public Task<Guid?> FindOfferIdAsync(string organizationId, string validationId, CancellationToken cancellationToken) =>
        _repository.FindOfferIdAsync(organizationId, validationId, cancellationToken);

    /// <summary>Applies the partial update and returns the persisted raw row (null if it vanished → NOT_FOUND).</summary>
    public Task<StaffValidationRow?> UpdateAsync(
        string organizationId,
        string validationId,
        StaffValidationUpdateCommand command,
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.UpdateAsync(organizationId, validationId, command, userId, now, cancellationToken);
}
