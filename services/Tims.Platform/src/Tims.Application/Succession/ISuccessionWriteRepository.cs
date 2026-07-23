using Tims.Domain.Succession;

namespace Tims.Application.Succession;

/// <summary>
/// Write port for the Phase-5 Slice-14 succession WRITE surface — a faithful port of the data steps of the 5 TS
/// <c>succession</c> mutations (addCriticalRole / addSuccessor / removeSuccessor / updateSuccessorReadiness /
/// updateCriticalRoleBand). Every method runs UNDER <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS)
/// with an EXPLICIT <c>organizationId</c> filter/value (defense-in-depth). This is an <c>efcoreStranglerWrite</c>
/// coexistence writer on <c>critical_roles</c> + <c>successors</c> — Prisma keeps the DDL and TS stays the sole
/// ACTIVE writer until the deploy-gated cutover.
/// </summary>
public interface ISuccessionWriteRepository
{
    /// <summary>addCriticalRole: INSERT a critical_roles row (organizationId = caller, targetBandLevel = null);
    /// returns the FULL created row (no Prisma <c>select</c>), or <c>null</c> when a PROVIDED optional FK reference
    /// (<c>currentHolderId</c>/<c>companyId</c>/<c>unitId</c>) is NOT a member of the caller's org (Codex H2 → 400 at
    /// the endpoint). Cross-org FK references are validated under TenantScope (RLS-filtered lookups) BEFORE the INSERT.</summary>
    Task<CriticalRoleRow?> AddCriticalRoleAsync(
        string organizationId, AddCriticalRoleInput input, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// addSuccessor: INSERT a successors row (organizationId = caller, addedById = caller). The
    /// <c>@@unique([criticalRoleId, userId])</c> violation (23505) → <see cref="AddSuccessorOutcome.Conflict"/>
    /// (the documented port improvement over the TS 500), atomic (no duplicate row). On success returns the full
    /// row + the projected nested <c>user</c> (id/firstName/lastName/avatar).
    /// </summary>
    Task<AddSuccessorResult> AddSuccessorAsync(
        string organizationId, Guid callerId, AddSuccessorInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>removeSuccessor: DELETE the successors row {id, organizationId}; returns the deleted row, or null
    /// when the row vanished between the probe and the delete (TOCTOU → 404 at the caller).</summary>
    Task<SuccessorScalarRow?> RemoveSuccessorAsync(
        string organizationId, Guid successorId, CancellationToken cancellationToken);

    /// <summary>updateSuccessorReadiness: UPDATE successors {id, organizationId} SET readiness (+ developmentPlan
    /// only when provided, + updatedAt); returns the full updated row, or null when the row vanished (TOCTOU → 404).</summary>
    Task<SuccessorScalarRow?> UpdateSuccessorReadinessAsync(
        string organizationId, Guid successorId, UpdateSuccessorReadinessInput input, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>updateCriticalRoleBand: UPDATE critical_roles {id, organizationId} SET targetBandLevel (+ updatedAt);
    /// returns the narrowed <c>{ id, targetBandLevel }</c>, or null when the row vanished (TOCTOU → 404).</summary>
    Task<CriticalRoleBandResult?> UpdateCriticalRoleBandAsync(
        string organizationId, Guid criticalRoleId, UpdateCriticalRoleBandInput input, DateTimeOffset now,
        CancellationToken cancellationToken);
}
