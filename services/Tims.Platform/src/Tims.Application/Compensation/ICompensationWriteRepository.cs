using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>
/// Write port for the Phase-5 Slice-12 compensation WRITE surface — a faithful port of the data steps of the TS
/// <c>createAdjustment</c> + <c>approveAdjustment</c> mutations. Every method runs UNDER <c>TenantScope</c>
/// (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth).
/// This is an <c>efcoreStranglerWrite</c> coexistence writer on <c>salary_adjustments</c> +
/// <c>employee_compensations</c> — Prisma keeps the DDL and TS stays the sole ACTIVE writer until cutover.
/// </summary>
public interface ICompensationWriteRepository
{
    /// <summary>
    /// createAdjustment step 1: the subject's <c>employee_compensations.currency</c> (findFirst {userId,org}
    /// select currency), or null when the subject has no comp row. Feeds the <c>normalizeCurrencyCode</c> fallback.
    /// </summary>
    Task<string?> GetSubjectCompensationCurrencyAsync(
        string organizationId, Guid subjectUserId, CancellationToken cancellationToken);

    /// <summary>
    /// createAdjustment step 2: INSERT the pending salary_adjustments row (requestedById = caller, status =
    /// 'pending'); returns the client-generated id. <paramref name="currency"/> is the already-normalized code.
    /// </summary>
    Task<string> InsertAdjustmentAsync(
        string organizationId,
        Guid callerId,
        CreateAdjustmentCommand command,
        string currency,
        DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// approveAdjustment step 1: findFirst salary_adjustments {id, org, status:'pending'} select
    /// {userId, newSalary, currency}; null ⇒ NOT_FOUND at the caller.
    /// </summary>
    Task<PendingAdjustmentRow?> LoadPendingAdjustmentAsync(
        string organizationId, Guid adjustmentId, CancellationToken cancellationToken);

    /// <summary>
    /// approveAdjustment step 2 (the $transaction): the conditional status transition
    /// (updateMany {id,org,status:'pending'} → count 0 ⇒ CONFLICT) AND, when approved, the
    /// employee_compensations propagation ({userId,org} set currentSalary/currency) — both in ONE EF transaction
    /// under TenantScope (commit/roll-back together). Returns <see cref="ApproveOutcome.Applied"/> or
    /// <see cref="ApproveOutcome.Conflict"/>.
    /// </summary>
    Task<ApproveOutcome> ApproveAsync(
        string organizationId,
        Guid adjustmentId,
        Guid callerId,
        string newStatus,
        bool applyCompensation,
        Guid subjectUserId,
        double newSalary,
        string currency,
        DateTimeOffset now,
        CancellationToken cancellationToken);
}
