namespace Tims.Infrastructure.Assessments.Providers;

// EF-OWNED rows (timestamptz columns: DateTime values are always Kind=Utc).

public sealed class ProviderBindingEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Provider { get; set; } = string.Empty;

    public Guid ProviderTenantId { get; set; }

    public string[] EnabledInstruments { get; set; } = [];

    public string DefaultLocale { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class ProviderAttemptEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid BindingId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public string Instrument { get; set; } = string.Empty;

    public string State { get; set; } = string.Empty;

    public string Purpose { get; set; } = string.Empty;

    public string JobRelatednessReason { get; set; } = string.Empty;

    public string Locale { get; set; } = string.Empty;

    public decimal TimeMultiplier { get; set; }

    public string[] Aids { get; set; } = [];

    public DateTime? RequestedExpiresAt { get; set; }

    public Guid? ProviderSubjectId { get; set; }

    public Guid? ProviderAssignmentId { get; set; }

    public string? InstrumentVersion { get; set; }

    public string? ContentVersion { get; set; }

    public string[] RequiredConsents { get; set; } = [];

    public DateTime? ExpiresAt { get; set; }

    public DateTime? StartedAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    public DateTime? LastLaunchedAt { get; set; }

    public Guid? LatestResultId { get; set; }

    /// <summary>
    /// Bumped by every hide (a <c>result_not_visible</c> answer, Codex r12 P1). A result fetched under an older value
    /// is never stored: a fetch that began before the tenant hid the result cannot bring its scores back.
    /// </summary>
    public int ResultVisibilityGeneration { get; set; }

    public string? LastErrorCode { get; set; }

    /// <summary>D15: <c>pending</c> from the #312 withdrawal's own transaction until the provider confirms, then <c>done</c>.</summary>
    public string? WithdrawalState { get; set; }

    /// <summary>When an ATS-initiated erasure (<c>DELETE /v1/subjects/{id}</c>) of the attempt's subject was accepted.</summary>
    public DateTime? ProviderErasureRequestedAt { get; set; }

    /// <summary>Bumped when a launch begins or ends a consent capture (the withdrawal pass's completion fence).</summary>
    public int ConsentCaptureGeneration { get; set; }

    /// <summary>Consent captures begun by launches and not yet ended with the provider's answer.</summary>
    public int ConsentCapturesInFlight { get; set; }

    /// <summary>When the latest in-flight consent capture began (database clock); null when none is in flight.</summary>
    public DateTime? ConsentCaptureStartedAt { get; set; }

    /// <summary>
    /// The consent purposes the provider still lacks for this assignment (its <c>missing_consents</c>), as last seen: at
    /// create, on a poll, on a launch's <c>consent_required</c>, and minus each purpose a launch recorded. What the
    /// candidate portal shows as "consent needed".
    /// </summary>
    public string[] MissingConsents { get; set; } = [];

    /// <summary>
    /// D17 polling lease: the poller instance that claimed this attempt and until when (database clock). A claim is one
    /// conditional UPDATE (lease free or expired, <c>FOR UPDATE SKIP LOCKED</c>), so two instances never poll one attempt
    /// at once. Both null when unclaimed.
    /// </summary>
    public Guid? PollLeaseOwner { get; set; }

    public DateTime? PollLeaseUntil { get; set; }

    /// <summary>When the poller last finished with this attempt (database clock); null when never polled.</summary>
    public DateTime? LastPolledAt { get; set; }

    /// <summary>The age band HR attested at assignment (<c>18_plus</c> or <c>16_17</c>), sent as <c>age_attestation</c>.</summary>
    public string? AgeBand { get; set; }

    /// <summary>
    /// SUPERSEDED by <see cref="CreateFences"/> (round 12) and no longer written or read: one shared timestamp let the
    /// first of two overlapping creates clear the fence while the second was still in flight. Kept (and copied into
    /// <see cref="CreateFences"/> by the migration) only so a rolling deploy never meets a missing column.
    /// </summary>
    public DateTime? CreateStartedAt { get; set; }

    /// <summary>
    /// The create fences, ONE PER CREATE: each create of this attempt appends its own token (the database clock when it
    /// was announced, unique per attempt) BEFORE anything is sent, and only that create's recorded answer removes it. A
    /// create that ends without an answer leaves its token until it is stale
    /// (<see cref="Domain.Assessments.Providers.ProviderCreateFence.StaleAfter"/>); stale tokens are pruned when the next
    /// create is announced. A #312 withdrawal or an erasure waits while any token is live.
    /// </summary>
    public DateTime[] CreateFences { get; set; } = [];

    /// <summary>The #312 cascade's lease: the pass that claimed this attempt, and until when (database clock).</summary>
    public Guid? WithdrawalLeaseOwner { get; set; }

    public DateTime? WithdrawalLeaseUntil { get; set; }

    /// <summary>OPTIONAL consent purposes the candidate granted (recorded at the provider) for this attempt.</summary>
    public string[] GrantedOptionalConsents { get; set; } = [];

    /// <summary>OPTIONAL consent purposes the candidate declined for this attempt (English: no speaking section).</summary>
    public string[] DeclinedOptionalConsents { get; set; } = [];

    public Guid AssignedById { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class ProviderResultEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid AttemptId { get; set; }

    public Guid ProviderResultId { get; set; }

    public int ResultRevision { get; set; }

    public string ResultSchema { get; set; } = string.Empty;

    public string Instrument { get; set; } = string.Empty;

    public string InstrumentVersion { get; set; } = string.Empty;

    public string ContentVersion { get; set; } = string.Empty;

    public string ContentSha256 { get; set; } = string.Empty;

    public string? NormVersion { get; set; }

    public string ScoringVersion { get; set; } = string.Empty;

    public string ScoringMethod { get; set; } = string.Empty;

    public string Purpose { get; set; } = string.Empty;

    public string ValidityStatus { get; set; } = string.Empty;

    public string[] ValidityReasons { get; set; } = [];

    public bool RequiresHumanReview { get; set; }

    public string Completion { get; set; } = string.Empty;

    public double? GlobalPercentile { get; set; }

    public string? Cefr { get; set; }

    public int? Level { get; set; }

    public decimal TimeMultiplierApplied { get; set; }

    public string RenderedFor { get; set; } = string.Empty;

    public string RenderedLevel { get; set; } = string.Empty;

    public string? Scores { get; set; }

    public DateTime CompletedAt { get; set; }

    public DateTime ScoredAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class ProviderWebhookInboxEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid EventId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public int EventVersion { get; set; }

    public Guid ProviderTenantId { get; set; }

    public DateTime OccurredAt { get; set; }

    public int? DeliveryAttempt { get; set; }

    public string Status { get; set; } = string.Empty;

    public int ProcessingAttempts { get; set; }

    public string? LastErrorCode { get; set; }

    public string Data { get; set; } = "{}";

    public DateTime ReceivedAt { get; set; }

    public DateTime? ProcessedAt { get; set; }

    /// <summary>When the inbox worker should (re)process this row; null once it is final (processed, ignored, given up).</summary>
    public DateTime? NextAttemptAt { get; set; }

    /// <summary>The inbox worker's lease: the worker that claimed this row, and until when (database clock).</summary>
    public Guid? LeaseOwner { get; set; }

    public DateTime? LeaseUntil { get; set; }
}

// Prisma-OWNED rows mapped read-only (ExcludeFromMigrations).

public sealed class ProviderCandidateRef
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime? DeletedAt { get; set; }
}

public sealed class ProviderApplicationRef
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public string Status { get; set; } = string.Empty;
}

public sealed class ProviderVacancyRef
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public DateTime? DeletedAt { get; set; }
}

public sealed class ProviderJobProfileRef
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid VacancyId { get; set; }

    public string? FitRequirements { get; set; }
}

public sealed class ProviderDataConsentRef
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid SubjectUserId { get; set; }

    public string ConsentType { get; set; } = string.Empty;

    public DateTime? WithdrawnAt { get; set; }
}

public sealed class ProviderOrganizationRef
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public DateTime? DeletedAt { get; set; }
}
