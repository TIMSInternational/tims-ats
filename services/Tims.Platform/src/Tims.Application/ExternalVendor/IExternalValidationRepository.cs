using Tims.Domain.ExternalVendor;

namespace Tims.Application.ExternalVendor;

/// <summary>
/// Write port for the external-vendor validation surface (Sprint 1.6 <c>submitValidationResult</c>). Both
/// methods run — in the infrastructure implementation — UNDER <c>TenantScope</c> (SET LOCAL ROLE
/// app_tenant + org GUC) so Postgres RLS isolates the org, with an EXPLICIT <c>organizationId</c> filter
/// (defense-in-depth, INV-7).
/// </summary>
public interface IExternalValidationRepository
{
    /// <summary>
    /// The read gate (INV-3): the status of the validation with this id IN the caller's org, or
    /// <c>null</c> when no such row is visible (missing / cross-org → RLS + org filter → null). Mirrors the
    /// TS <c>findFirst({ id, organizationId }) select { id, status }</c>.
    /// </summary>
    Task<string?> GetStatusForSubmitAsync(string organizationId, string validationId, CancellationToken cancellationToken);

    /// <summary>
    /// The ATOMIC pending-only write (INV-4 TOCTOU guard): a single <c>UPDATE … WHERE id = … AND
    /// organization_id = … AND status = 'pending'</c> that sets the result, status, notes, and vendor
    /// provenance (<c>completed_by_api_key_id</c> set, <c>completed_by_id</c> null — INV-5). Returns the
    /// affected-row count; <c>0</c> means the row is gone / not this org / already finalized (caller →
    /// CONFLICT). NEVER a read-then-write on the status.
    /// </summary>
    Task<int> SubmitResultAsync(
        string organizationId,
        string validationId,
        string apiKeyId,
        ExternalValidationSubmitCommand command,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
