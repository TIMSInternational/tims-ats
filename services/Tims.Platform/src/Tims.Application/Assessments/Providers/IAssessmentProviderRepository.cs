using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// Persistence for the provider connector: the four EF-owned tables (<c>assessment_provider_bindings</c>,
/// <c>assessment_provider_attempts</c>, <c>assessment_provider_results</c>, <c>assessment_provider_webhook_inbox</c>)
/// plus read-only lookups of Prisma-owned rows (candidates, applications, job profiles, recruitment consent).
///
/// <para>Tenancy: every org-scoped method runs under <c>TenantScope</c> (app_tenant + the org GUC, so RLS engages) AND
/// filters <c>organization_id</c> explicitly. The only pre-tenant reads are the two that resolve an org from an
/// unauthenticated-by-org input (a webhook's provider tenant id, a candidate's attempt id); both return just the org
/// and are followed by tenant-scoped reads.</para>
/// </summary>
public interface IAssessmentProviderRepository
{
    Task<ProviderBindingRow?> GetActiveBindingAsync(Guid organizationId, CancellationToken cancellationToken);

    Task<AssignmentContext> LoadAssignmentContextAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>
    /// In ONE transaction, under the same per-candidate advisory lock a consent withdrawal takes: re-checks the
    /// withdrawal, then for each instrument returns the open attempt or inserts a <c>pending_create</c> one, plus one
    /// audit row. All instruments or none: when an open attempt carries other terms than requested (accommodation,
    /// locale or reason), nothing is written and that attempt comes back as <see cref="ReserveOutcome.TermsConflict"/>.
    /// </summary>
    Task<ReserveOutcome> ReserveAttemptsAsync(
        Guid organizationId, Guid actorId, ProviderBindingRow binding, Guid candidateId, Guid vacancyId,
        IReadOnlyList<NewAttempt> attempts, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Attaches the provider's ids to a <c>pending_create</c> attempt and returns the attempt's state afterwards:
    /// <c>created</c>, <c>erased</c> when a <c>subject.erased</c> for that provider subject was already recorded, or
    /// whatever state a concurrent writer left. A <c>cancelled</c> attempt with no provider ids (staff cancelled it while
    /// this create was in flight) gets the ids too, with <see cref="ProviderCleanup.CancelPending"/> as its
    /// <c>last_error_code</c>: a durable record that the provider still holds an unwanted assignment, until
    /// <see cref="MarkProviderCancelledAsync"/> clears it. Nothing else is changed. Null when not found.
    /// </summary>
    Task<string?> MarkCreatedAsync(
        Guid organizationId, Guid attemptId, ProviderAssignment assignment, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// Records a failed provider create. <paramref name="cancel"/> (a definitive refusal: the provider created nothing)
    /// cancels the attempt so it can be re-assigned; otherwise it stays <c>pending_create</c> for a re-send.
    /// </summary>
    Task MarkCreateFailedAsync(
        Guid organizationId, Guid attemptId, string errorCode, bool cancel, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// Staff cancel: under the attempt lock, on a fresh read, moves an attempt that has not finished
    /// (<see cref="ProviderAttemptStates.IsCancellable"/>) to <c>cancelled</c> with its audit row, but ONLY while its
    /// provider assignment is still <paramref name="expectedProviderAssignmentId"/> (the one the caller cancelled at the
    /// provider, or none). Returns the state afterwards: <c>cancelled</c>; a finished or voided state a concurrent writer
    /// set first; or a still-cancellable state when the attempt was mapped to a provider assignment meanwhile (the
    /// caller must cancel that one at the provider and try again). Null when not found.
    /// </summary>
    Task<string?> MarkCancelledAsync(
        Guid organizationId, Guid attemptId, Guid? expectedProviderAssignmentId, Guid actorId, bool cancelledAtProvider,
        DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// The provider confirmed the cancel of a cancelled attempt's orphaned assignment: clears
    /// <see cref="ProviderCleanup.CancelPending"/> under the attempt lock, with an audit row. No-op otherwise.
    /// </summary>
    Task MarkProviderCancelledAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Pre-tenant: the org and candidate of an attempt id, or null. Nothing else crosses the boundary.</summary>
    Task<(Guid OrganizationId, Guid CandidateId)?> FindAttemptOwnerAsync(Guid attemptId, CancellationToken cancellationToken);

    Task<LaunchContext?> LoadLaunchContextAsync(
        Guid organizationId, Guid attemptId, CancellationToken cancellationToken);

    /// <summary>Appends a consent-capture audit row with a caller-chosen id (sent to the provider as host_record_ref).</summary>
    Task AuditConsentCapturedAsync(
        Guid organizationId, Guid auditId, Guid candidateId, Guid attemptId, string purpose, string textVersion,
        string locale, bool recordedAtProvider, CancellationToken cancellationToken);

    Task MarkLaunchedAsync(
        Guid organizationId, Guid attemptId, Guid candidateId, string delivery, DateTimeOffset now,
        CancellationToken cancellationToken);

    Task MarkExpiredAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Pre-tenant: the org bound to a provider tenant id (active bindings only), or null.</summary>
    Task<Guid?> FindOrganizationByProviderTenantAsync(Guid providerTenantId, CancellationToken cancellationToken);

    /// <summary>Inserts the inbox row, or reports what an earlier delivery of the same event id already did.</summary>
    Task<InboxOutcome> RecordInboxAsync(
        Guid organizationId, ProviderEventEnvelope envelope, int? deliveryAttempt, DateTimeOffset now,
        CancellationToken cancellationToken);

    Task CompleteInboxAsync(
        Guid organizationId, Guid eventId, string status, string? errorCode, DateTimeOffset now,
        CancellationToken cancellationToken);

    Task<AttemptRow?> FindAttemptAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken);

    Task<AttemptRow?> FindAttemptByProviderAssignmentAsync(
        Guid organizationId, Guid providerAssignmentId, CancellationToken cancellationToken);

    /// <summary>Moves an attempt forward on a lifecycle event (never backward, never out of a terminal state).</summary>
    Task<bool> AdvanceAttemptAsync(
        Guid organizationId, Guid attemptId, string toState, DateTimeOffset? at, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// Upserts a result and updates the attempt, with one audit row. Nothing is written when the stored revision is equal
    /// or newer, or when the attempt is erased or cancelled (checked under the attempt lock that erasure also takes).
    /// </summary>
    Task<bool> StoreResultAsync(
        Guid organizationId, AttemptRow attempt, ParsedProviderResult result, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>DSAR cascade from <c>subject.erased</c>: deletes the subject's stored results, marks attempts erased.</summary>
    Task<int> EraseSubjectAsync(
        Guid organizationId, Guid providerSubjectId, DateTimeOffset now, CancellationToken cancellationToken);

    Task<IReadOnlyList<ProviderFitRow>> GetFitRowsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>Platform-owner write on the privileged connection (bindings are not writable by app_tenant).</summary>
    Task<ProviderBindingRow> UpsertBindingAsync(
        Guid organizationId, Guid providerTenantId, IReadOnlyList<string> instruments, string defaultLocale,
        Guid actorId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Privileged read of an active organization's display name, or null.</summary>
    Task<string?> GetActiveOrganizationNameAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// #312 to provider (D15). Under the per-candidate lock the withdrawal itself takes, and only when the candidate's
    /// recruitment consent IS withdrawn (directly or through a same-email candidate): every attempt of the candidate not
    /// yet in the cascade gets <c>withdrawal_state = pending</c>; one that has not finished is cancelled, and one mapped
    /// to a provider assignment gets the <see cref="ProviderCleanup.CancelPending"/> marker. One conditional UPDATE
    /// plus its audit row, in one transaction. The same statement runs inside the withdrawal's own transaction; this is
    /// the self-healing path for an attempt that transaction could not see. Returns the number of attempts staged.
    /// </summary>
    Task<int> StageConsentWithdrawalAsync(
        Guid organizationId, Guid candidateId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>The org's attempts whose provider-side withdrawal is not confirmed yet, oldest first, at most <paramref name="max"/>.</summary>
    Task<IReadOnlyList<AttemptRow>> ListPendingWithdrawalsAsync(
        Guid organizationId, int max, CancellationToken cancellationToken);

    /// <summary>
    /// Reads each attempt's consent-capture fence (<see cref="WithdrawalFence"/>). A withdrawal pass reads it BEFORE it
    /// lists the provider's consents, so the fence it later completes with describes every capture that list can miss.
    /// Staleness is judged by the database clock at this read.
    /// </summary>
    Task<IReadOnlyList<WithdrawalFence>> ReadWithdrawalFencesAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, CancellationToken cancellationToken);

    /// <summary>
    /// Conditional write: moves each fenced attempt from <c>pending</c> to <c>done</c> only while it carries no
    /// <see cref="ProviderCleanup.CancelPending"/> marker AND its consent-capture generation still equals the fence's
    /// AND (no capture is in flight, or the in-flight one was already stale when the fence was read). A capture that began
    /// or ended after the fence was read keeps the attempt pending. One audit row. Returns how many moved.
    /// </summary>
    Task<int> MarkWithdrawalDoneAsync(
        Guid organizationId, IReadOnlyList<WithdrawalFence> fences, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// A launch announces a consent capture BEFORE it sends one, durably: one conditional write that bumps the attempt's
    /// capture generation and in-flight count, and refuses (false, nothing written) an attempt already in a #312
    /// withdrawal. Row-level locking orders it against the withdrawal's staging write, so either the staging sees the
    /// announcement or the announcement sees the staging.
    /// </summary>
    Task<bool> BeginConsentCaptureAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// The launch's captures all got the provider's answer: bumps the generation and decrements the in-flight count. Not
    /// called when a capture ended without an answer (a timeout, an outage, a cancellation): the provider may still store
    /// it, so the announcement stays in flight until it is stale (<see cref="ProviderCleanup.ConsentCaptureStaleAfter"/>).
    /// </summary>
    Task EndConsentCaptureAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// DSAR access (C# path): every provider attempt and stored result of one candidate, with a fail-closed audit row in
    /// the same transaction. Null when the candidate is not in the org.
    /// </summary>
    Task<ProviderSubjectExport?> ExportCandidateAsync(
        Guid organizationId, Guid candidateId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// The distinct provider subject ids recorded on one candidate's attempts, and whether any attempt exists at all
    /// (one may have no recorded subject although the provider holds one). Null when the candidate is not in the org.
    /// </summary>
    Task<ProviderCandidateSubjects?> ListProviderSubjectsAsync(
        Guid organizationId, Guid candidateId, CancellationToken cancellationToken);

    /// <summary>
    /// Re-opens the withdrawal cascade of one attempt (<c>done</c> back to <c>pending</c>, conditional): a consent was
    /// recorded at the provider by a launch that raced the withdrawal, after the cascade had withdrawn the others.
    /// </summary>
    Task ReopenWithdrawalAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Records an accepted ATS-initiated erasure of one provider subject on the candidate's attempts that carry it or
    /// no subject at all, with an audit row.
    /// </summary>
    Task MarkErasureRequestedAsync(
        Guid organizationId, Guid candidateId, Guid providerSubjectId, string receiptStatus, Guid actorId, DateTimeOffset now,
        CancellationToken cancellationToken);
}

public sealed record ProviderCandidateSubjects(IReadOnlyList<Guid> Subjects, bool HasAttempts);

public sealed record ProviderSubjectExport(
    IReadOnlyList<ProviderExportAttempt> Attempts, IReadOnlyList<ProviderExportResult> Results);

public sealed record ProviderExportAttempt(
    Guid AttemptId,
    Guid VacancyId,
    string Instrument,
    string State,
    string Locale,
    decimal TimeMultiplier,
    IReadOnlyList<string> Aids,
    string? InstrumentVersion,
    string? ContentVersion,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset CreatedAt,
    string? WithdrawalState,
    DateTimeOffset? ErasureRequestedAt);

public sealed record ProviderExportResult(
    Guid AttemptId,
    Guid ResultId,
    int Revision,
    string Instrument,
    string InstrumentVersion,
    string ValidityStatus,
    IReadOnlyList<string> ValidityReasons,
    string Completion,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    string? ScoresJson,
    DateTimeOffset CompletedAt,
    DateTimeOffset ScoredAt);

/// <summary>Durable cleanup markers kept in an attempt's <c>last_error_code</c>.</summary>
public static class ProviderCleanup
{
    /// <summary>
    /// A cancelled attempt whose provider assignment was created after the cancel (the create was in flight) and is not
    /// yet confirmed cancelled at the provider. Retried by the staff cancel route and by any webhook for that assignment.
    /// </summary>
    public const string CancelPending = "provider_cancel_pending";

    public static bool IsCancelPending(AttemptRow attempt) =>
        attempt is not null && attempt.State == Domain.Assessments.Providers.ProviderAttemptStates.Cancelled
        && attempt.ProviderAssignmentId is not null && attempt.LastErrorCode == CancelPending;

    /// <summary>
    /// After this long, a consent capture announced by a launch and never ended can no longer be in flight at the
    /// provider: one launch sends at most four captures, each bounded by the client's per-call timeout (at most 30 s)
    /// plus a token request, and the provider's own request limit. A withdrawal pass that reads the fence later lists
    /// every consent such a capture could have stored.
    /// </summary>
    public static readonly TimeSpan ConsentCaptureStaleAfter = TimeSpan.FromMinutes(10);
}

/// <summary>
/// One attempt's consent-capture fence, read by a withdrawal pass before it lists the provider's consents.
/// <see cref="CaptureGeneration"/> changes whenever a launch begins or ends a capture; <see cref="CaptureInFlight"/> is
/// true while a begun capture has not ended; <see cref="CaptureStale"/> is true when that in-flight capture began more than
/// <see cref="ProviderCleanup.ConsentCaptureStaleAfter"/> before the read (database clock).
/// </summary>
public sealed record WithdrawalFence(Guid AttemptId, int CaptureGeneration, bool CaptureInFlight, bool CaptureStale)
{
    /// <summary>Whether the pass may complete this attempt, provided the generation is unchanged at completion.</summary>
    public bool AllowsCompletion => !CaptureInFlight || CaptureStale;
}

public sealed record ProviderBindingRow(
    Guid Id, Guid OrganizationId, Guid ProviderTenantId, IReadOnlyList<string> EnabledInstruments, string DefaultLocale);

/// <summary>What assign needs to know about the candidate and the vacancy, read under the tenant scope.</summary>
public sealed record AssignmentContext(
    bool CandidateFound,
    bool VacancyFound,
    bool HasActiveApplication,
    bool ConsentWithdrawn,
    string? FitRequirementsJson,
    string? CandidateFirstName,
    string? CandidateLastName,
    string? CandidateEmail);

public sealed record NewAttempt(
    string Instrument, string Reason, string Locale, decimal TimeMultiplier, IReadOnlyList<string> Aids,
    DateTimeOffset? ExpiresAt)
{
    /// <summary>
    /// True when an open attempt already carries exactly these terms: the accommodation (time multiplier and aids, as
    /// a set), the locale and the job-relatedness reason. The expiry is not compared: a re-send may legitimately
    /// recompute a relative expiry, and the response echoes the one in force.
    /// </summary>
    public bool SameTermsAs(AttemptRow open)
    {
        ArgumentNullException.ThrowIfNull(open);
        return open.TimeMultiplier == TimeMultiplier
            && string.Equals(open.Locale, Locale, StringComparison.Ordinal)
            && string.Equals(open.Reason, Reason, StringComparison.Ordinal)
            && open.Aids.Order(StringComparer.Ordinal).SequenceEqual(Aids.Order(StringComparer.Ordinal), StringComparer.Ordinal);
    }
}

public sealed record AttemptRow(
    Guid Id,
    Guid OrganizationId,
    Guid CandidateId,
    Guid VacancyId,
    string Instrument,
    string State,
    string Reason,
    string Locale,
    decimal TimeMultiplier,
    IReadOnlyList<string> Aids,
    DateTimeOffset? RequestedExpiresAt,
    Guid? ProviderSubjectId,
    Guid? ProviderAssignmentId,
    string? InstrumentVersion,
    string? ContentVersion,
    IReadOnlyList<string> RequiredConsents,
    DateTimeOffset? ExpiresAt,
    string? LastErrorCode,
    bool IsNew,
    string? WithdrawalState = null,
    DateTimeOffset? ErasureRequestedAt = null)
{
    /// <summary>
    /// True once the candidate's #312 withdrawal reached this attempt (D15) or an erasure of its provider subject was
    /// requested: the ATS never fetches or stores a result for it again.
    /// </summary>
    public bool ResultsStopped => WithdrawalState is not null || ErasureRequestedAt is not null;
}

/// <summary>
/// The reserve result. <see cref="TermsConflict"/>: an open attempt for one of the instruments carries other terms than
/// requested; nothing was written (re-sending can never silently drop a corrected accommodation).
/// </summary>
public sealed record ReserveOutcome(bool ConsentWithdrawn, IReadOnlyList<AttemptRow> Attempts, AttemptRow? TermsConflict = null);

/// <summary>The attempt plus the candidate identity a launch is checked against.</summary>
public sealed record LaunchContext(
    AttemptRow Attempt, string? CandidateEmail, bool CandidateActive, bool ConsentWithdrawn,
    string? CandidateFirstName = null, string? CandidateLastName = null);

public sealed record ProviderEventEnvelope(
    Guid EventId, string EventType, DateTimeOffset OccurredAt, Guid ProviderTenantId, string DataJson);

public enum InboxOutcome
{
    /// <summary>First delivery: process it.</summary>
    New,

    /// <summary>An earlier delivery was recorded but not finished (failed or crashed): process it again.</summary>
    Retry,

    /// <summary>Already processed or deliberately ignored: acknowledge without processing.</summary>
    Done,
}

public static class InboxStatuses
{
    public const string Received = "received";
    public const string Processed = "processed";
    public const string Ignored = "ignored";
    public const string Failed = "failed";
}
