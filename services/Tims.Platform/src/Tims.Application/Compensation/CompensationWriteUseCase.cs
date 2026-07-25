using Tims.Application.Audit;
using Tims.Domain.Audit;
using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>
/// The compensation WRITE use case (Phase-5 Slice-12) — faithful ports of the TS <c>createAdjustment</c> +
/// <c>approveAdjustment</c> mutation bodies. createAdjustment does the <c>normalizeCurrencyCode</c> fallback
/// (input → subject comp currency → USD) then INSERTs; it echoes ONLY {id, status} and does NO audit (nothing
/// restricted is returned). approveAdjustment loads the pending row (null ⇒ NOT_FOUND), then does the FAIL-CLOSED
/// audit BEFORE the mutation (reading new_salary is a restricted-field read → an audit-write failure aborts
/// pre-mutation), then the atomic conditional transaction (CONFLICT on a lost race).
///
/// The endpoint owns the two authorization mechanics that are Api/Infrastructure concerns — createAdjustment's
/// <c>assertSubjectInScope</c> on the target userId and approveAdjustment's <c>assertScoped('salaryAdjustment')</c>
/// by-id probe — running them BEFORE calling this use case.
/// </summary>
public sealed class CompensationWriteUseCase(ICompensationWriteRepository repository, IDataAccessAuditor auditor)
{
    private const string SalaryAdjustmentEntity = "salaryAdjustment";
    private const string PendingStatus = "pending";
    private const string ApprovedStatus = "approved";
    private const string RejectedStatus = "rejected";

    private readonly ICompensationWriteRepository _repository = repository;
    private readonly IDataAccessAuditor _auditor = auditor;

    /// <summary>
    /// createAdjustment: currency fallback + INSERT. Returns ONLY {id, status:'pending'} (§21), or <c>null</c>
    /// when the target user is NOT a member of the caller's org — the H1 backstop the endpoint maps to 403
    /// (assertSubjectInScope no-ops for organization/company scope, so a cross-tenant userId must be rejected here).
    /// </summary>
    public async Task<CreateAdjustmentResult?> CreateAdjustmentAsync(
        string organizationId, Guid callerId, CreateAdjustmentCommand command, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // H1: the target userId must belong to the caller's org (assertSubjectInScope enforces SCOPE, not org
        // membership, for org/company-scoped callers). A cross-org subject ⇒ null ⇒ 403, no INSERT.
        var subjectInOrg = await _repository
            .SubjectExistsInOrgAsync(organizationId, command.UserId, cancellationToken)
            .ConfigureAwait(false);
        if (!subjectInOrg)
        {
            return null;
        }

        // currency = normalizeCurrencyCode(input.currency, currentComp?.currency ?? 'USD').
        var subjectCurrency = await _repository
            .GetSubjectCompensationCurrencyAsync(organizationId, command.UserId, cancellationToken)
            .ConfigureAwait(false);
        var currency = CurrencyCodes.NormalizeCurrencyCode(
            command.Currency, subjectCurrency ?? CurrencyCodes.DefaultCurrency);

        var id = await _repository
            .InsertAdjustmentAsync(organizationId, callerId, command, currency, now, cancellationToken)
            .ConfigureAwait(false);

        return new CreateAdjustmentResult(id, PendingStatus);
    }

    /// <summary>
    /// approveAdjustment: load pending (null ⇒ NotFound) → fail-closed audit BEFORE the mutation → the atomic
    /// conditional transaction (Conflict on a lost race, else Applied). <paramref name="auditActorId"/> is the
    /// resolved audit actor (the real owner under impersonation); <paramref name="callerId"/> is written as
    /// approvedById.
    /// </summary>
    public async Task<ApproveAdjustmentResult> ApproveAsync(
        string organizationId,
        Guid adjustmentId,
        Guid callerId,
        string auditActorId,
        bool approved,
        string? ipAddress,
        string? userAgent,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var row = await _repository
            .LoadPendingAdjustmentAsync(organizationId, adjustmentId, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            return new ApproveAdjustmentResult(ApproveOutcome.NotFound, null);
        }

        // §21: reading new_salary (restricted) to propagate it mandates a FAIL-CLOSED audit BEFORE the update —
        // an audit-write failure throws AuditWriteFailedException here, so the mutation never runs.
        await _auditor.LogAsync(
            new DataAccessEvent(
                organizationId, auditActorId, SalaryAdjustmentEntity, adjustmentId.ToString(),
                AuditAction.Update, ipAddress, userAgent),
            failClosed: true,
            cancellationToken).ConfigureAwait(false);

        var newStatus = approved ? ApprovedStatus : RejectedStatus;
        var outcome = await _repository
            .ApproveAsync(
                organizationId, adjustmentId, callerId, newStatus, approved,
                row.UserId, row.NewSalary, row.Currency, now, cancellationToken)
            .ConfigureAwait(false);

        return new ApproveAdjustmentResult(outcome, outcome == ApproveOutcome.Applied ? newStatus : null);
    }
}
