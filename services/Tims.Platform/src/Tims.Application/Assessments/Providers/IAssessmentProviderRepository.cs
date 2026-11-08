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
    /// whatever state a concurrent writer left (only <c>pending_create</c> is ever changed). Null when not found.
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
    bool IsNew);

/// <summary>
/// The reserve result. <see cref="TermsConflict"/>: an open attempt for one of the instruments carries other terms than
/// requested; nothing was written (re-sending can never silently drop a corrected accommodation).
/// </summary>
public sealed record ReserveOutcome(bool ConsentWithdrawn, IReadOnlyList<AttemptRow> Attempts, AttemptRow? TermsConflict = null);

/// <summary>The attempt plus the candidate identity a launch is checked against.</summary>
public sealed record LaunchContext(
    AttemptRow Attempt, string? CandidateEmail, bool CandidateActive, bool ConsentWithdrawn);

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
