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

    /// <summary>
    /// The organization's assessment proctoring settings (<c>assessment_provider_settings</c>), or null when HR never
    /// saved any (every setting off). Read under the tenant scope with an explicit organization filter.
    /// </summary>
    Task<ProctoringSettingsRow?> GetProctoringSettingsAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// Upserts the organization's proctoring settings and appends one <c>audit_logs</c> row
    /// (<c>assessment_provider_settings_updated</c>, the before and after values, no PII) in the same transaction.
    /// Returns the stored row.
    /// </summary>
    Task<ProctoringSettingsRow> SaveProctoringSettingsAsync(
        Guid organizationId, Guid actorId, AssessmentProctoring settings, DateTimeOffset now,
        CancellationToken cancellationToken);

    Task<AssignmentContext> LoadAssignmentContextAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>
    /// In ONE transaction, under the binding lock an unbind takes (shared here; the binding must still be in force, else
    /// <see cref="ReserveOutcome.BindingInactive"/> and nothing is written) and the same per-candidate advisory lock a
    /// consent withdrawal takes: re-checks the withdrawal, then for each instrument returns the open attempt or inserts a
    /// <c>pending_create</c> one, plus one audit row. All instruments or none: when an open attempt carries other terms than requested (accommodation,
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

    /// <summary>
    /// Records, as an audit row (<c>assessment_provider_notice_acknowledged</c>), that the candidate acknowledged the ATS
    /// notice of this version and language before launching the attempt (round 12). Fail-closed: no row, no launch.
    /// </summary>
    Task AuditNoticeAcknowledgedAsync(
        Guid organizationId, Guid candidateId, Guid attemptId, string textVersion, string locale,
        CancellationToken cancellationToken);

    /// <summary>Appends a consent-capture audit row with a caller-chosen id (sent to the provider as host_record_ref).</summary>
    Task AuditConsentCapturedAsync(
        Guid organizationId, Guid auditId, Guid candidateId, Guid attemptId, string purpose, string textVersion,
        string locale, bool recordedAtProvider, CancellationToken cancellationToken);

    /// <summary>
    /// The launch's #312 check INSIDE the candidate lock. ONE transaction takes the attempt lock and then the per-candidate
    /// lock a #312 withdrawal takes (the order result storage uses: subject, attempt, candidate), re-reads the attempt and
    /// the withdrawn-consent predicate, and only then runs <paramref name="launch"/> (the provider call), recording a
    /// successful launch (<c>created</c> to <c>launched</c>, <c>last_launched_at</c>, audit) before it commits. So a
    /// withdrawal committed before this transaction is always seen and nothing is launched, and one that starts during it
    /// waits for the launch to commit and then stages the attempt (launched) for the cascade, which cancels it at the
    /// provider. The provider call runs with both locks held, bounded by the client's per-call timeout. The record is a
    /// conditional write (<c>withdrawal_state IS NULL</c>): a same-email SIBLING's withdrawal, which takes only its own
    /// candidate lock, may stage this attempt during the call; then nothing is recorded and the outcome is
    /// <see cref="LockedLaunchOutcome.ConsentWithdrawn"/> although the provider was called.
    /// </summary>
    Task<LockedLaunch> LaunchUnderCandidateLockAsync(
        Guid organizationId, Guid attemptId, Func<AttemptRow, CancellationToken, Task<ProviderCall<ProviderLaunch>>> launch,
        DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>PRE-TENANT (privileged): the active organization with this public slug, or null. Only the id leaves.</summary>
    Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken);

    /// <summary>
    /// The candidate portal's own attempts: those of the org's ACTIVE candidates whose <c>lower(btrim(email))</c> equals the
    /// verified email's, newest first, at most 50. Empty when that person's #312 recruitment consent is withdrawn (the
    /// sibling predicate covers every candidate row with that email). Under the tenant scope.
    /// </summary>
    Task<IReadOnlyList<AttemptRow>> ListCandidateAttemptsByEmailAsync(
        Guid organizationId, string verifiedEmail, CancellationToken cancellationToken);

    /// <summary>Privileged read of an active organization's public slug (its portal path), or null.</summary>
    Task<string?> GetActiveOrganizationSlugAsync(Guid organizationId, CancellationToken cancellationToken);

    Task MarkExpiredAsync(Guid organizationId, Guid attemptId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Pre-tenant: the org bound to a provider tenant id and whether that binding is still in force, or null. An unbound
    /// (inactive) binding is returned too: it may retain results, and the events that erase or invalidate them
    /// (<see cref="ProviderEventTypes.RetainedDataEvents"/>) must still reach its inbox.
    /// </summary>
    Task<ProviderTenantOwner?> FindOrganizationByProviderTenantAsync(Guid providerTenantId, CancellationToken cancellationToken);

    /// <summary>
    /// Inserts and COMMITS the inbox row, due at once (<c>next_attempt_at</c> = now), or reports what an earlier delivery
    /// of the same event id already did. A redelivery of an event not yet processed or ignored makes it due again.
    /// </summary>
    Task<InboxOutcome> RecordInboxAsync(
        Guid organizationId, ProviderEventEnvelope envelope, int? deliveryAttempt, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// PRE-TENANT (privileged connection): the organizations holding at least one inbox row due now (its
    /// <c>next_attempt_at</c> passed, its lease free or expired), at most <paramref name="max"/>. Only org ids leave.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListOrganizationsWithDueInboxEventsAsync(int max, CancellationToken cancellationToken);

    /// <summary>
    /// Claims, for <paramref name="owner"/>, the org's oldest due inbox row whose lease is free or expired: one
    /// conditional UPDATE with <c>FOR UPDATE SKIP LOCKED</c>, a lease of
    /// <see cref="Domain.Assessments.Providers.ProviderInboxProcessing.LeaseDuration"/> by the database clock. Null when
    /// nothing is due.
    /// </summary>
    Task<ClaimedInboxEvent?> ClaimInboxEventAsync(Guid organizationId, Guid owner, CancellationToken cancellationToken);

    /// <summary>
    /// Records what processing a claimed row did and ends <paramref name="owner"/>'s lease, conditional on the owner (a
    /// lease that expired and was claimed by another worker is left alone). <paramref name="retryAt"/> non-null keeps the
    /// row due at that time; null makes it final.
    /// </summary>
    Task CompleteInboxAsync(
        Guid organizationId, Guid eventId, Guid owner, string status, string? errorCode, DateTimeOffset? retryAt,
        DateTimeOffset now, CancellationToken cancellationToken);

    Task<AttemptRow?> FindAttemptAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken);

    Task<AttemptRow?> FindAttemptByProviderAssignmentAsync(
        Guid organizationId, Guid providerAssignmentId, CancellationToken cancellationToken);

    /// <summary>
    /// Moves an attempt forward on a lifecycle event (never backward, never out of a terminal state). <paramref name="cause"/>
    /// is the event's cause when it has one: <c>completed_by</c> of a completion (<see cref="ProviderCompletionCauses"/>)
    /// or the reason of a void (<see cref="ProviderVoidReasons"/>); an unknown value is not stored. A cause that arrives
    /// after the attempt already reached that state (the poller saw the state first) is still recorded, once.
    /// </summary>
    Task<bool> AdvanceAttemptAsync(
        Guid organizationId, Guid attemptId, string toState, DateTimeOffset? at, DateTimeOffset now,
        CancellationToken cancellationToken, string? cause = null);

    /// <summary>
    /// Upserts a result and updates the attempt, with one audit row. Nothing is written when the stored revision is equal
    /// or newer, or when the attempt is erased or cancelled (checked under the attempt lock that erasure also takes).
    /// </summary>
    Task<bool> StoreResultAsync(
        Guid organizationId, AttemptRow attempt, ParsedProviderResult result, DateTimeOffset now,
        CancellationToken cancellationToken);

    /// <summary>
    /// The provider answered <c>result_not_visible</c> for <paramref name="resultId"/> (the tenant's visibility no longer
    /// lets <c>tenant_hr</c> read it): under the attempt lock, DELETES the ATS's stored copy of that result, clears the
    /// attempt's latest result when it was that one, and moves the attempt to <c>result_ready</c> when it may still move
    /// there (the sitting finished; there is nothing to store or score). Staff reads and FIT stop using the result at
    /// once; the deletion enqueues the candidate's FIT v2 recompute (the provider result trigger fires on DELETE). One
    /// audit row. Returns how many stored rows were removed.
    /// </summary>
    Task<int> HideResultAsync(
        Guid organizationId, AttemptRow attempt, Guid resultId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// DSAR cascade from <c>subject.erased</c>, or from the poller once <c>getSubject</c> confirmed the erasure: deletes the
    /// subject's stored results, marks attempts erased. Idempotent (an erased attempt holds nothing more to delete).
    /// <paramref name="via"/> names the signal in the audit row (<c>poll</c>); null for the webhook.
    /// </summary>
    Task<int> EraseSubjectAsync(
        Guid organizationId, Guid providerSubjectId, DateTimeOffset now, CancellationToken cancellationToken,
        string? via = null);

    Task<IReadOnlyList<ProviderFitRow>> GetFitRowsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);

    /// <summary>Platform-owner write on the privileged connection (bindings are not writable by app_tenant).</summary>
    Task<ProviderBindingRow> UpsertBindingAsync(
        Guid organizationId, Guid providerTenantId, IReadOnlyList<string> instruments, string defaultLocale,
        Guid actorId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>Privileged read of an active organization's display name, or null.</summary>
    Task<string?> GetActiveOrganizationNameAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// Platform owner (round 12): the org's binding, in force or not, with the open work an unbind would strand
    /// (<see cref="ProviderOpenWork"/>). <c>Bound</c> is false when the org was never bound.
    /// </summary>
    Task<ProviderBindingState> GetBindingStateAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// The org's binding whether or not it is in force (null when never bound). DSAR export and erasure resolve the
    /// candidate's provider subject through it, so an unbound org's data can still be exported and erased.
    /// </summary>
    Task<ProviderBindingRow?> GetBindingAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>The org's attempts whose sitting has not finished (<see cref="ProviderAttemptStates.IsCancellable"/>).</summary>
    Task<IReadOnlyList<AttemptRow>> ListCancellableAttemptsAsync(Guid organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// Platform-owner unbind (privileged), in ONE transaction under the binding lock every reserve takes shared: null
    /// when no binding is in force; the open work, with NOTHING changed, when any remains; otherwise the binding is
    /// deactivated with an audit row (<c>assessment_provider_binding_unset</c>) and <see cref="ProviderOpenWork.None"/>
    /// comes back.
    /// </summary>
    Task<ProviderOpenWork?> DeactivateBindingAsync(
        Guid organizationId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>One audit row per DSAR erasure run (<c>assessment_provider_erasure_run</c>): its outcome and counts.</summary>
    Task AuditErasureRunAsync(
        Guid organizationId, Guid candidateId, Guid actorId, string outcome, int subjects, int requested,
        CancellationToken cancellationToken);

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

    /// <summary>
    /// PRE-TENANT (privileged connection): the organizations that hold at least one attempt whose provider-side withdrawal
    /// is not confirmed yet, at most <paramref name="max"/>, the one whose oldest pending attempt is oldest first (so the
    /// deferral of a failing pass rotates organizations as well as attempts). Only organization ids leave this query;
    /// each is then propagated under its own tenant scope.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListOrganizationsWithPendingWithdrawalsAsync(int max, CancellationToken cancellationToken);

    /// <summary>
    /// Claims, for <paramref name="owner"/>, the org's attempts whose provider-side withdrawal is not confirmed yet and
    /// whose withdrawal lease is free or expired, oldest first, at most <paramref name="max"/>: one conditional UPDATE with
    /// <c>FOR UPDATE SKIP LOCKED</c>, a lease of <see cref="Domain.Assessments.Providers.ProviderWithdrawalLeasing.LeaseDuration"/>
    /// by the database clock. Two passes (two instances' sweeps, a sweep and a webhook) never work on one attempt at once.
    /// </summary>
    Task<IReadOnlyList<AttemptRow>> ClaimPendingWithdrawalsAsync(
        Guid organizationId, Guid owner, int max, CancellationToken cancellationToken);

    /// <summary>Ends <paramref name="owner"/>'s withdrawal leases on the given attempts (conditional on the owner).</summary>
    Task ReleaseWithdrawalLeasesAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, Guid owner, CancellationToken cancellationToken);

    /// <summary>
    /// The create fence, ONE PER CREATE: announces, durably and BEFORE anything of the create is sent (the subject, its
    /// enrichment, the lookup and <c>POST /v1/assignments</c>), that THIS create of the <c>pending_create</c> attempt is in
    /// flight, by appending its own token (the database clock, unique per attempt) to <c>create_fences</c>; stale tokens
    /// are pruned at the same time. Returns the token, or null (nothing written) for an attempt already in a #312
    /// withdrawal, erased-requested, or no longer pending: row locking orders it against the withdrawal's staging write.
    /// Only <see cref="EndCreateAsync"/> with the same token removes it, so two overlapping creates of one attempt each
    /// keep the attempt fenced until their OWN answer is recorded (Codex round 11 P1); a create that ends without an
    /// answer leaves its token until it is stale.
    /// </summary>
    Task<DateTimeOffset?> BeginCreateAsync(Guid organizationId, Guid attemptId, CancellationToken cancellationToken);

    /// <summary>
    /// Ends ONE create's fence after its answer was recorded, under the attempt lock: removes <paramref name="fence"/>
    /// when the answer was an <paramref name="assignment"/> the attempt now records (its assignment AND subject: the
    /// create's own subject is then traceable), or, with <paramref name="assignment"/> null, a definitive refusal on an
    /// attempt with no erasure (requested or done). In every other case the token stays until it is stale: such a create
    /// may have made a provider subject the attempt does not name (for example one created after an erasure made the
    /// provider forget the recorded subject's external_ref), and an unanswered token keeps the candidate's subject
    /// resolved by external_ref on every later export or erasure.
    /// </summary>
    Task EndCreateAsync(
        Guid organizationId, Guid attemptId, DateTimeOffset fence, ProviderAssignment? assignment,
        CancellationToken cancellationToken);

    /// <summary>
    /// Records the provider subject a create resolved on an attempt that has none yet (conditional, no other change), so
    /// a #312 cascade reaches that subject's consents even when no assignment is ever recorded.
    /// </summary>
    Task RecordSubjectAsync(Guid organizationId, Guid attemptId, Guid providerSubjectId, CancellationToken cancellationToken);

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
    /// Moves the given attempts that are STILL pending to the back of <see cref="ListPendingWithdrawalsAsync"/>'s order
    /// (their <c>updated_at</c> becomes <paramref name="now"/>), so a pass always reaches attempts it has not tried yet: a
    /// batch that keeps failing can never starve the rest. A completed attempt is left alone (conditional write).
    /// </summary>
    Task DeferPendingWithdrawalsAsync(
        Guid organizationId, IReadOnlyList<Guid> attemptIds, DateTimeOffset now, CancellationToken cancellationToken);

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
    /// <see cref="EndConsentCaptureAsync"/> and <see cref="RecordOptionalConsentDecisionsAsync"/> in ONE transaction under
    /// the attempt lock (the lock a launch holds while it enforces the recorded declines): no other launch can see the
    /// fence cleared while this launch's decisions are not on record yet (Codex r12 P2).
    /// </summary>
    Task EndConsentCaptureAndRecordDecisionsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> granted, IReadOnlyList<string> declined,
        DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// DSAR access (C# path): every provider attempt and stored result of one candidate, with a fail-closed audit row in
    /// the same transaction (it also counts the <paramref name="providerExports"/> the provider returned for the
    /// candidate's subjects, included by the caller). Null when the candidate is not in the org.
    /// </summary>
    Task<ProviderSubjectExport?> ExportCandidateAsync(
        Guid organizationId, Guid candidateId, Guid actorId, int providerExports, DateTimeOffset now,
        CancellationToken cancellationToken);

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

    /// <summary>
    /// PRE-TENANT (privileged connection): the organizations holding at least one attempt the D17 poller could claim now
    /// (<see cref="ClaimPollableAttemptsAsync"/>'s predicate), at most <paramref name="max"/>. Only organization ids leave.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListOrganizationsWithPollableAttemptsAsync(int max, CancellationToken cancellationToken);

    /// <summary>
    /// D17 polling lease. ONE conditional UPDATE claims, for <paramref name="owner"/>, up to <paramref name="max"/> of the
    /// org's stale pollable attempts whose lease is free or expired, locking them with <c>FOR UPDATE SKIP LOCKED</c>: two
    /// pollers (two App Runner instances) never claim the same attempt, and neither waits on the other. The lease lasts
    /// <see cref="Domain.Assessments.Providers.ProviderAttemptPolling.LeaseDuration"/> by the database clock. Returns the
    /// claimed attempts with their binding's provider tenant.
    /// </summary>
    Task<IReadOnlyList<PolledAttempt>> ClaimPollableAttemptsAsync(
        Guid organizationId, Guid owner, int max, CancellationToken cancellationToken);

    /// <summary>
    /// Ends <paramref name="owner"/>'s lease on one attempt and stamps <c>last_polled_at</c> (database clock). Conditional
    /// on the owner: a lease that expired and was claimed by another poller is left alone.
    /// </summary>
    Task ReleasePollLeaseAsync(Guid organizationId, Guid attemptId, Guid owner, CancellationToken cancellationToken);

    /// <summary>
    /// Sets the consent purposes the provider still lacks for this attempt (its <c>missing_consents</c>), as just seen.
    /// Unknown purposes are dropped. A no-op on an attempt that is not open.
    /// </summary>
    Task SetMissingConsentsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> missingConsents, CancellationToken cancellationToken);

    /// <summary>
    /// Records the candidate's decisions on the attempt's OPTIONAL consent purposes
    /// (<see cref="Domain.Assessments.Providers.OptionalConsents"/>): a granted purpose leaves the declined list, a declined
    /// one leaves the granted list. Purposes the instrument does not offer as optional are dropped. One audit row.
    /// </summary>
    Task RecordOptionalConsentDecisionsAsync(
        Guid organizationId, Guid attemptId, IReadOnlyList<string> granted, IReadOnlyList<string> declined,
        CancellationToken cancellationToken);
}

/// <summary>A claimed inbox row: the verified event, how often it was processed already, and when it was received.</summary>
public sealed record ClaimedInboxEvent(ProviderEventEnvelope Envelope, int ProcessingAttempts, DateTimeOffset ReceivedAt);

public enum LockedLaunchOutcome
{
    /// <summary>The checks passed under the locks and the provider was called (<see cref="LockedLaunch.Call"/>).</summary>
    Called,

    /// <summary>
    /// The attempt no longer exists for this organization, or an erasure of its provider subject was requested (before
    /// the locks, or during the call: then nothing is recorded and the URL must not reach the candidate).
    /// </summary>
    NotFound,

    /// <summary>
    /// The candidate's recruitment consent is withdrawn, or the attempt is in the #312 cascade: nothing called; or a
    /// sibling's withdrawal staged the attempt during the call (<see cref="LockedLaunch.Call"/> is then set, and its URL
    /// must not reach the candidate).
    /// </summary>
    ConsentWithdrawn,

    /// <summary>The attempt left the launchable states before the locks were taken: nothing called.</summary>
    NotLaunchable,
}

/// <summary>What <see cref="IAssessmentProviderRepository.LaunchUnderCandidateLockAsync"/> did, and the fresh state.</summary>
public sealed record LockedLaunch(LockedLaunchOutcome Outcome, ProviderCall<ProviderLaunch>? Call, string? State);

/// <summary>An attempt the D17 poller claimed, with the provider tenant its binding maps to.</summary>
public sealed record PolledAttempt(AttemptRow Attempt, Guid ProviderTenantId);

/// <param name="ErasedSubjects">
/// Subjects whose erasure the provider already confirmed (a recorded <c>subject.erased</c>): terminal, never exported,
/// erased or resolved again.
/// </param>
/// <param name="NeedsResolution">
/// Whether the provider's subject for (tenant, candidate id) must still be resolved: some attempt of the candidate is
/// neither erased nor under an accepted erasure request. False once every attempt is: the provider forgets the
/// subject's external_ref when erasure is requested, so resolving it again would CREATE a fresh, empty subject. Also true
/// while any attempt holds an UNANSWERED create (its create fence set, whatever its subject or state): that create may
/// have made a provider subject no attempt names, including one created after an erasure made the provider forget the
/// recorded subject's external_ref.
/// </param>
/// <param name="CreatesInFlight">
/// Whether some attempt of the candidate holds a create announced by
/// <see cref="IAssessmentProviderRepository.BeginCreateAsync"/> that is neither answered nor stale (database clock): it may
/// still create a provider subject, so an erasure that saw it cannot be complete.
/// </param>
public sealed record ProviderCandidateSubjects(
    IReadOnlyList<Guid> Subjects, bool HasAttempts, IReadOnlyList<Guid>? ErasedSubjects = null, bool NeedsResolution = true,
    bool CreatesInFlight = false);

/// <summary>
/// The DSAR access export: the ATS's own provider tables (<see cref="Attempts"/>, <see cref="Results"/>) and what the
/// provider itself holds for each of the candidate's provider subjects (<see cref="ProviderExports"/>).
/// </summary>
public sealed record ProviderSubjectExport(
    IReadOnlyList<ProviderExportAttempt> Attempts, IReadOnlyList<ProviderExportResult> Results)
{
    public IReadOnlyList<ProviderHeldSubjectExport> ProviderExports { get; init; } = [];
}

/// <summary>
/// One provider subject in a DSAR export. <see cref="Status"/>: <c>exported</c> (the provider's own <c>SubjectExport</c>
/// document is <see cref="Export"/>), <c>erased</c> (410: the provider holds nothing any more) or <c>not_found</c> (a 404
/// the provider's subject lookup confirmed).
/// </summary>
public sealed record ProviderHeldSubjectExport(Guid SubjectId, string Status, System.Text.Json.JsonElement? Export);

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
/// <para>The create fences ride along: <see cref="CreateInFlight"/> is true while any create announced by
/// <see cref="IAssessmentProviderRepository.BeginCreateAsync"/> has no recorded answer, <see cref="CreateStale"/> when
/// every such create was announced more than <see cref="Domain.Assessments.Providers.ProviderCreateFence.StaleAfter"/>
/// before the read. A
/// pass reads the fence BEFORE it looks the attempt up by external_ref, so a lookup that comes back empty while a create
/// may still land keeps the attempt pending.</para>
/// </summary>
public sealed record WithdrawalFence(
    Guid AttemptId, int CaptureGeneration, bool CaptureInFlight, bool CaptureStale, bool CreateInFlight = false,
    bool CreateStale = false)
{
    /// <summary>Whether the pass may complete this attempt, provided the generation is unchanged at completion.</summary>
    public bool AllowsCompletion => CaptureAllowsCompletion && CreateAllowsCompletion;

    /// <summary>No consent capture in flight at the read, or only a stale one.</summary>
    public bool CaptureAllowsCompletion => !CaptureInFlight || CaptureStale;

    /// <summary>
    /// No create announced and unanswered at the read, or only stale ones. A pass that then FOUND and recorded the
    /// assignment may try to complete: the database's own condition (no unanswered create left, or only stale ones at
    /// the read) decides, so a create still in flight keeps the attempt pending until its own answer or staleness.
    /// </summary>
    public bool CreateAllowsCompletion => !CreateInFlight || CreateStale;
}

/// <summary>The organization's stored proctoring settings, when they were last changed, and by whom.</summary>
public sealed record ProctoringSettingsRow(AssessmentProctoring Settings, DateTimeOffset UpdatedAt, Guid UpdatedById);

/// <summary>The org a provider tenant is bound to, and whether the binding is in force (false: unbound, results retained).</summary>
public sealed record ProviderTenantOwner(Guid OrganizationId, bool BindingActive);

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

/// <param name="Proctoring">
/// The proctoring block the attempt's assignment will carry (<see cref="AssessmentProctoring.ForAssignment"/>): stored on
/// the attempt when it is inserted and never re-read, so the sitting keeps what it was assigned with. Not part of the
/// terms an open attempt is compared on: a settings change applies to assignments created after it.
/// </param>
public sealed record NewAttempt(
    string Instrument, string Reason, string Locale, decimal TimeMultiplier, IReadOnlyList<string> Aids,
    DateTimeOffset? ExpiresAt, string? AgeBand = null, AssessmentProctoring? Proctoring = null)
{
    /// <summary>
    /// True when an open attempt already carries exactly these terms: the accommodation (time multiplier and aids, as
    /// a set), the locale, the job-relatedness reason and the attested age band. The expiry is not compared: a re-send
    /// may legitimately recompute a relative expiry, and the response echoes the one in force.
    /// </summary>
    public bool SameTermsAs(AttemptRow open)
    {
        ArgumentNullException.ThrowIfNull(open);
        return open.TimeMultiplier == TimeMultiplier
            && string.Equals(open.Locale, Locale, StringComparison.Ordinal)
            && string.Equals(open.AgeBand, AgeBand, StringComparison.Ordinal)
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
    DateTimeOffset? ErasureRequestedAt = null,
    IReadOnlyList<string>? MissingConsents = null,
    string? AgeBand = null,
    Guid? LatestResultId = null,
    IReadOnlyList<string>? GrantedOptionalConsents = null,
    IReadOnlyList<string>? DeclinedOptionalConsents = null,
    int ConsentCapturesInFlight = 0,
    DateTimeOffset? ConsentCaptureStartedAt = null,
    int ResultVisibilityGeneration = 0,
    AssessmentProctoring? Proctoring = null,
    string? CompletedBy = null,
    string? VoidReason = null)
{
    /// <summary>
    /// A consent capture announced by a launch and not answered yet, and not stale at <paramref name="now"/>: the provider
    /// may still store it.
    /// </summary>
    public bool CaptureInFlightAt(DateTimeOffset now) =>
        ConsentCapturesInFlight > 0
        && (ConsentCaptureStartedAt is not { } started || started > now - ProviderCleanup.ConsentCaptureStaleAfter);

    /// <summary>The optional purposes the candidate has neither granted nor declined yet.</summary>
    public IReadOnlyList<string> PendingOptionalConsents => Domain.Assessments.Providers.OptionalConsents.For(Instrument)
        .Where(p => !(GrantedOptionalConsents ?? []).Contains(p) && !(DeclinedOptionalConsents ?? []).Contains(p))
        .ToList();

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
/// <param name="BindingInactive">An unbind committed before the reserve could take the binding lock: nothing was written.</param>
public sealed record ReserveOutcome(
    bool ConsentWithdrawn, IReadOnlyList<AttemptRow> Attempts, AttemptRow? TermsConflict = null, bool BindingInactive = false);

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
