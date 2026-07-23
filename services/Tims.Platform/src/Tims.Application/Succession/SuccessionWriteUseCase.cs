using Tims.Domain.Succession;

namespace Tims.Application.Succession;

/// <summary>
/// The succession WRITE use case (Phase-5 Slice-14) — faithful ports of the 5 TS <c>succession</c> mutation bodies.
/// The mutations are thin (a single INSERT / DELETE / UPDATE each), so this use case is a straight pass-through to
/// the repository: NO business logic beyond the data step (matching the inline-<c>prisma.*</c> TS router, which has
/// no service layer). The AUTHORIZATION mechanics that are Api/Infrastructure concerns — addCriticalRole's
/// <c>requireOrgScope</c>, addSuccessor's <c>assertScoped('criticalRole')</c> + <c>assertSubjectInScope(userId)</c>,
/// and remove/updateReadiness/updateBand's <c>assertScoped</c> by-id probes — run in the ENDPOINT BEFORE this use
/// case. The dedup <c>@@unique</c> violation → CONFLICT and the delete/update count-0 → NotFound mapping live in the
/// repository (the atomic DB step) and surface here as the outcome/null the endpoint maps to a status code.
/// </summary>
public sealed class SuccessionWriteUseCase(ISuccessionWriteRepository repository)
{
    private readonly ISuccessionWriteRepository _repository = repository;

    /// <summary>addCriticalRole: INSERT + return the full created row, or null when a provided FK reference
    /// (currentHolderId/companyId/unitId) is not in the caller's org (Codex H2 → 400 at the endpoint).</summary>
    public Task<CriticalRoleRow?> AddCriticalRoleAsync(
        string organizationId, AddCriticalRoleInput input, DateTimeOffset now, CancellationToken cancellationToken) =>
        _repository.AddCriticalRoleAsync(organizationId, input, now, cancellationToken);

    /// <summary>addSuccessor: INSERT (addedById = caller) → Created (full row + nested user) or Conflict (dedup 409).</summary>
    public Task<AddSuccessorResult> AddSuccessorAsync(
        string organizationId, Guid callerId, AddSuccessorInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.AddSuccessorAsync(organizationId, callerId, input, now, cancellationToken);

    /// <summary>removeSuccessor: DELETE → the deleted row, or null (TOCTOU → 404 at the endpoint).</summary>
    public Task<SuccessorScalarRow?> RemoveSuccessorAsync(
        string organizationId, Guid successorId, CancellationToken cancellationToken) =>
        _repository.RemoveSuccessorAsync(organizationId, successorId, cancellationToken);

    /// <summary>updateSuccessorReadiness: UPDATE → the full updated row, or null (TOCTOU → 404 at the endpoint).</summary>
    public Task<SuccessorScalarRow?> UpdateSuccessorReadinessAsync(
        string organizationId, Guid successorId, UpdateSuccessorReadinessInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.UpdateSuccessorReadinessAsync(organizationId, successorId, input, now, cancellationToken);

    /// <summary>updateCriticalRoleBand: UPDATE → the narrowed {id, targetBandLevel}, or null (TOCTOU → 404).</summary>
    public Task<CriticalRoleBandResult?> UpdateCriticalRoleBandAsync(
        string organizationId, Guid criticalRoleId, UpdateCriticalRoleBandInput input, DateTimeOffset now,
        CancellationToken cancellationToken) =>
        _repository.UpdateCriticalRoleBandAsync(organizationId, criticalRoleId, input, now, cancellationToken);
}
