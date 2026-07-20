using Tims.Domain.Validation;

namespace Tims.Application.Validation;

/// <summary>
/// Write port for the staff pre-employment-validation update. Both operations run UNDER <c>TenantScope</c>
/// (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter
/// (defense-in-depth). The fetch is separate from the update because the endpoint must scope-probe the
/// parent offer (the by-id IDOR probe) BETWEEN them — the router-level fetch → assertScoped → update order.
/// </summary>
public interface IStaffValidationRepository
{
    /// <summary>The validation's parent <c>offerId</c> (for the scope probe), or <c>null</c> when no row
    /// matches (→ NOT_FOUND). Port of the TS fetch-then-probe <c>findFirst({ id, organizationId })</c>.</summary>
    Task<Guid?> FindOfferIdAsync(string organizationId, string validationId, CancellationToken cancellationToken);

    /// <summary>
    /// Applies the partial update (status / completer / completedAt always; result / notes only when the
    /// command carries them) and returns the persisted RAW row, or <c>null</c> if the row vanished between the
    /// probe and the write (a rare race → NOT_FOUND). Sets <c>completed_by_id</c> = the staff user and
    /// <c>completed_by_api_key_id</c> = null (satisfying <c>single_completer_chk</c>); <c>completed_at</c> = now
    /// when completing, else null. Last-write-wins (no status precondition), faithful to the TS.
    /// </summary>
    Task<StaffValidationRow?> UpdateAsync(
        string organizationId,
        string validationId,
        StaffValidationUpdateCommand command,
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
