using Tims.Application.Audit;
using Tims.Domain.Audit;
using Tims.Domain.ExternalVendor;

namespace Tims.Application.ExternalVendor;

/// <summary>
/// The external-vendor validation SUBMIT use case — infra-free orchestration (drives the repository port
/// + <see cref="IDataAccessAuditor"/> only). A faithful port of <c>externalValidationService.submitResult</c>
/// (packages/api/src/services/external-validation.service.ts):
///
///   read-gate (null → NOT_FOUND) → atomic pending-only write (count == 0 → CONFLICT)
///     → fail-SOFT audit → map v1.
///
/// INV-6 fail-SOFT audit: the write is COMMITTED and is the source of truth, so a lost audit row must NOT
/// abort a successful vendor submission (CONTRAST the Slice-1 read surface's fail-CLOSED export audit).
/// The audit is therefore <c>failClosed:false</c> and awaited AFTER the write; a throw inside it is
/// swallowed by <see cref="DataAccessAuditWriter"/>, so this use case still returns the v1.
/// </summary>
public sealed class ExternalValidationSubmitUseCase(
    IExternalValidationRepository repository,
    IDataAccessAuditor auditor,
    TimeProvider? timeProvider = null)
{
    private const string ValidationEntity = "preemploymentValidation";

    private readonly IExternalValidationRepository _repository = repository;
    private readonly IDataAccessAuditor _auditor = auditor;

    // Defaults to the system clock when unregistered; a test injects a fixed sub-ms instant to prove the
    // ms-truncation (persisted == returned == JS `new Date()` precision) bites.
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    public async Task<ExternalValidationResultV1> SubmitAsync(
        ExternalValidationSubmitPrincipal principal,
        string validationId,
        ExternalValidationSubmitCommand command,
        CancellationToken cancellationToken)
    {
        // INV-3 read gate: a validation not visible in the caller's org (missing / cross-org) → NOT_FOUND.
        var existingStatus = await _repository
            .GetStatusForSubmitAsync(principal.OrganizationId, validationId, cancellationToken)
            .ConfigureAwait(false);
        if (existingStatus is null)
        {
            throw new ExternalValidationNotFoundException();
        }

        // Single completion instant, used BOTH for the DB columns and the returned v1 (parity with the TS
        // `const completedAt = new Date()` that is written and echoed). Truncate to whole milliseconds ONCE
        // at the source: TimeProvider (like DateTimeOffset.UtcNow) carries sub-ms ticks, but the Prisma
        // `timestamp(3)` column stores only ms — so without this the persisted value (rounded) could differ
        // from the returned value (raw/truncated), and neither would match JS `new Date()` (ms precision).
        var now = TruncateToMilliseconds(_timeProvider.GetUtcNow());

        // INV-4 atomic pending-only write: count 0 → the row is gone / not this org / already finalized.
        var affected = await _repository
            .SubmitResultAsync(principal.OrganizationId, validationId, principal.ApiKeyId, command, now, cancellationToken)
            .ConfigureAwait(false);
        if (affected == 0)
        {
            throw new ExternalValidationConflictException();
        }

        // INV-6 fail-SOFT audit: a lost audit row must not roll back the committed write.
        await _auditor.LogAsync(
            new DataAccessEvent(
                principal.OrganizationId,
                principal.ApiKeyId,
                ValidationEntity,
                validationId,
                AuditAction.Update,
                principal.IpAddress,
                principal.UserAgent),
            failClosed: false,
            cancellationToken).ConfigureAwait(false);

        return ExternalValidationResultV1.Map(validationId, command.Status, now);
    }

    /// <summary>Drops sub-millisecond ticks so the instant matches the <c>timestamp(3)</c> column + JS Date.</summary>
    private static DateTimeOffset TruncateToMilliseconds(DateTimeOffset value) =>
        new(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), value.Offset);
}
