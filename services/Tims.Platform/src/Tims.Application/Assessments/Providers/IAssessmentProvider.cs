using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// The provider port (assessment-integration design §7.C AS-5, adapted to the headless direction): every instrument is
/// a REMOTE provider behind the TIMS Assessments API v1 (<c>TIMSInternational/tims-interop</c>,
/// <c>contracts/openapi/tims-assessments.v1.yaml</c>). The ATS never holds items, keys, timing or scoring: it binds a
/// tenant, creates subjects and assignments, records consents, launches, reads typed results and verifies webhooks.
///
/// <para>Every call returns a <see cref="ProviderCall{T}"/> instead of throwing for provider-side outcomes, so the use
/// cases decide explicitly what a refusal, a conflict and an outage each mean. Implementations never log tokens,
/// secrets, request bodies or result payloads.</para>
/// </summary>
public interface IAssessmentProvider
{
    /// <summary>False when the client credentials, the base URL or the webhook secret are unset or placeholders.</summary>
    bool IsConfigured { get; }

    /// <summary><c>GET /v1/catalog/instruments</c> (<c>catalog:read</c>).</summary>
    Task<ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>> ListInstrumentsAsync(CancellationToken cancellationToken);

    /// <summary><c>POST /v1/tenants</c> (<c>assignments:write</c>). Idempotent on the organization.</summary>
    Task<ProviderCall<ProviderTenant>> EnsureTenantAsync(
        ProviderTenantRequest request, string idempotencyKey, CancellationToken cancellationToken);

    /// <summary><c>POST /v1/subjects</c>. Idempotent on (tenant, external_ref = the ATS candidate id).</summary>
    Task<ProviderCall<ProviderSubject>> EnsureSubjectAsync(
        ProviderSubjectRequest request, string idempotencyKey, CancellationToken cancellationToken);

    /// <summary>
    /// <c>PATCH /v1/subjects/{subject_id}</c> (<c>subjects:write</c>): sets the names and email a link-out instrument needs
    /// on a subject that was created without them. Merge semantics, idempotent; the contract's recovery path for
    /// <c>subject_data_required</c>.
    /// </summary>
    Task<ProviderCall<ProviderSubject>> UpdateSubjectAsync(
        Guid subjectId, ProviderSubjectUpdate update, CancellationToken cancellationToken);

    /// <summary>
    /// <c>DELETE /v1/subjects/{subject_id}</c>: starts the provider's asynchronous erasure of everything it holds for the
    /// subject (DSAR). A 410 means the subject is already erased or erasure-pending.
    /// </summary>
    Task<ProviderCall<ProviderErasureReceipt>> EraseSubjectAsync(Guid subjectId, CancellationToken cancellationToken);

    /// <summary><c>GET /v1/subjects/{subject_id}/consents</c>: the subject's consent records.</summary>
    Task<ProviderCall<IReadOnlyList<ProviderConsentRecord>>> ListConsentsAsync(Guid subjectId, CancellationToken cancellationToken);

    /// <summary><c>POST /v1/subjects/{subject_id}/consents/{consent_id}/withdrawal</c>. Idempotent at the provider.</summary>
    Task<ProviderCall<ProviderConsentRecord>> WithdrawConsentAsync(
        Guid subjectId, Guid consentId, DateTimeOffset withdrawnAt, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /v1/assignments?tenant_id=&amp;external_ref=</c>: the tenant's one assignment with this external ref, or none.
    /// The provider keeps (tenant, external_ref) unique permanently, so this is how an ambiguous create is recovered
    /// (owner default D11, 2026-11-08) without ever sending a second create.
    /// </summary>
    Task<ProviderCall<ProviderAssignmentLookup>> FindAssignmentByExternalRefAsync(
        Guid tenantId, string externalRef, CancellationToken cancellationToken);

    /// <summary><c>POST /v1/assignments</c>. A replay with the same key returns the original assignment.</summary>
    Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
        ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /v1/assignments/{id}</c>. Used to reconcile a webhook for an assignment the ATS created but did not get
    /// to record (a crash between the provider's answer and the commit): its <c>external_ref</c> is the attempt id.
    /// </summary>
    Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>POST /v1/assignments/{id}/cancel</c>. Idempotent at the provider: voids an in-progress session
    /// (<c>administrative_void</c>) and releases the reserved use if no session started; 409 once the assignment has
    /// completed.
    /// </summary>
    Task<ProviderCall<ProviderAssignment>> CancelAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken);

    /// <summary><c>POST /v1/subjects/{subject_id}/consents</c>: one consent purpose.</summary>
    Task<ProviderCall<ProviderConsentRecord>> RecordConsentAsync(
        Guid subjectId, ProviderConsentRequest request, string idempotencyKey, CancellationToken cancellationToken);

    /// <summary><c>POST /v1/assignments/{id}/launch</c> with <c>mode: headless</c>.</summary>
    Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, CancellationToken cancellationToken);

    /// <summary><c>GET /v1/results/{id}?audience=tenant_hr</c>, parsed and validated.</summary>
    Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken);

    /// <summary>Verifies <c>TIMS-Signature</c> over the raw body with the configured signing secret(s).</summary>
    WebhookSignatureCheck VerifyWebhook(string? signatureHeader, ReadOnlySpan<byte> rawBody, DateTimeOffset now);
}

/// <summary>The outcome of one provider call: a value, or a failure the caller must handle.</summary>
public sealed class ProviderCall<T>
    where T : class
{
    private ProviderCall(T? value, ProviderFailure? failure)
    {
        Value = value;
        Failure = failure;
    }

    public T? Value { get; }

    public ProviderFailure? Failure { get; }

    public bool Ok => Failure is null;

    public static ProviderCall<T> Success(T value) => new(value ?? throw new ArgumentNullException(nameof(value)), null);

    public static ProviderCall<T> Fail(ProviderFailure failure) =>
        new(null, failure ?? throw new ArgumentNullException(nameof(failure)));
}

/// <summary>
/// A provider failure. <see cref="Code"/> is the contract's problem <c>code</c> when the provider answered with one
/// (<c>consent_required</c>, <c>vacancy_version_mismatch</c>, …), else one of the local codes below.
/// <see cref="Transient"/> is true for outages, 429 and 5xx: retrying the same idempotent call is safe and useful.
/// </summary>
public sealed record ProviderFailure(int? HttpStatus, string Code, bool Transient, IReadOnlyList<string> MissingConsents)
{
    public const string Unconfigured = "provider_unconfigured";
    public const string Unavailable = "provider_unavailable";
    public const string ContractViolation = "provider_contract_violation";
    public const string TokenUnavailable = "provider_token_unavailable";

    /// <summary>
    /// A cancel or an erasure answered 404, but the provider's own lookup did not confirm that the resource is gone (it
    /// still serves it, or the lookup failed). A provider that does not serve the route answers the same 404
    /// <c>not_found</c>, so this is never read as "already gone". Transient: retry later.
    /// </summary>
    public const string NotFoundUnconfirmed = "provider_not_found_unconfirmed";

    /// <summary>
    /// A link-out instrument (PCA) needs the subject's names and email. The provider answers it on a link-out launch;
    /// the ATS raises it locally, BEFORE an assignment is created, only when the provider's subject lacks them AND the
    /// candidate record has no usable names or email to add with <c>PATCH /v1/subjects/{id}</c>.
    /// </summary>
    public const string SubjectDataRequired = "subject_data_required";

    // Contract codes (tims-assessments.v1.yaml, Errors) that refuse a create OUTRIGHT: the provider validated the
    // request and created nothing. Deliberately absent: idempotency_key_in_use (another request with this key is still
    // creating it), idempotency_key_reused (an earlier body under this key may have created it), and any code this
    // connector does not know (the contract may add codes in a minor version).
    private static readonly string[] RefusalCodes =
    [
        "invalid_request", "insufficient_scope", "forbidden", "not_found", "vacancy_version_mismatch", "subject_erased",
        "validation_failed", "locale_not_supported", "instrument_version_not_available",
        "instrument_not_offered_for_selection", "accommodation_not_supported", SubjectDataRequired,
    ];

    /// <summary>
    /// True only when this failure PROVES the provider created nothing, so a <c>pending_create</c> attempt may be
    /// cancelled and a corrected request start over. Everything else may mean the provider has, or is still creating,
    /// the resource: an outage, a timeout, 429, 5xx, an in-flight duplicate (409 <c>idempotency_key_in_use</c>), an
    /// off-contract 2xx, an unknown code. Those keep the attempt pending, and a re-send replays the same idempotency key
    /// instead of orphaning a provider assignment.
    /// </summary>
    public bool IsDefinitiveRefusal =>
        HttpStatus is >= 400 and < 500
            ? RefusalCodes.Contains(Code, StringComparer.Ordinal)
            : HttpStatus is null && Code == SubjectDataRequired;

    public static ProviderFailure Local(string code, bool transient) => new(null, code, transient, []);
}

public sealed record ProviderCatalogVersion(
    string InstrumentVersion,
    string Status,
    string Delivery,
    bool SelectionAllowed,
    IReadOnlyList<string> Locales,
    IReadOnlyList<string> RequiredConsents);

public sealed record ProviderCatalogInstrument(string Instrument, IReadOnlyList<ProviderCatalogVersion> Versions)
{
    /// <summary>Offered for hiring: some GA or beta version allows purpose <c>selection</c>.</summary>
    public bool OfferedForSelection =>
        Versions.Any(v => v.SelectionAllowed && v.Status is "ga" or "beta");
}

public sealed record ProviderTenantRequest(string ExternalOrgRef, string DisplayName, string DefaultLocale);

public sealed record ProviderTenant(Guid TenantId, string ExternalOrgRef, string Status);

/// <summary>
/// The subject for one candidate. Names and email are sent ONLY when the org's binding enables a link-out instrument
/// (PCA), whose provider sitting needs them; otherwise the subject is an opaque external ref. A subject created
/// without them (before the org enabled PCA) is enriched with <c>PATCH /v1/subjects/{id}</c> when a PCA needs them.
/// </summary>
public sealed record ProviderSubjectRequest(
    Guid TenantId, string ExternalRef, string? GivenName, string? FamilyName, string? Email, string? PreferredLocale);

/// <summary>
/// A subject as the provider holds it. <see cref="HasNamesAndEmail"/>: the given name, family name and email are all
/// on record (what a link-out launch needs). An existing subject comes back UNCHANGED whatever the request sent.
/// </summary>
public sealed record ProviderSubject(Guid SubjectId, string Status, bool HasNamesAndEmail = false);

/// <summary>
/// One assignment, always purpose <c>selection</c> with the vacancy and the job-relatedness reason. Accommodations
/// carry the adjustment only (multiplier + aids), never its reason.
/// </summary>
public sealed record ProviderAssignmentRequest(
    Guid TenantId,
    Guid SubjectId,
    string Instrument,
    string Locale,
    string ExternalVacancyRef,
    string JobRelatednessReason,
    decimal TimeMultiplier,
    IReadOnlyList<string> Aids,
    DateTimeOffset? ExpiresAt,
    string ExternalRef);

public sealed record ProviderAssignment(
    Guid AssignmentId,
    Guid TenantId,
    Guid SubjectId,
    string Instrument,
    string InstrumentVersion,
    string ContentVersion,
    string Status,
    IReadOnlyList<string> RequiredConsents,
    IReadOnlyList<string> MissingConsents,
    DateTimeOffset ExpiresAt,
    string? ExternalRef = null);

public sealed record ProviderConsentRequest(
    string Purpose, string TextVersion, string Locale, DateTimeOffset GrantedAt, string HostRecordRef,
    string ExternalVacancyRef);

public sealed record ProviderConsentRecord(Guid ConsentId, string Purpose, string Status);

/// <summary>The names and email a link-out instrument needs, set on an existing subject (merge semantics).</summary>
public sealed record ProviderSubjectUpdate(string GivenName, string FamilyName, string Email);

/// <summary>The provider's receipt for an erasure request (<c>accepted</c>, <c>in_progress</c> or <c>completed</c>).</summary>
public sealed record ProviderErasureReceipt(Guid SubjectId, string Status);

/// <summary>The answer to a lookup by external ref: the one assignment, or none (an empty page).</summary>
public sealed class ProviderAssignmentLookup(ProviderAssignment? assignment)
{
    public ProviderAssignment? Assignment { get; } = assignment;
}

/// <summary>
/// A launch. Deliberately a class with a redacting <see cref="ToString"/>: a record would print the candidate token
/// into any log line that formats it. The token goes only into the candidate's own response body.
/// </summary>
public sealed class ProviderLaunch(
    string delivery, string? candidateToken, DateTimeOffset expiresAt, string apiBaseUrl, string? hostedUrl)
{
    public string Delivery { get; } = delivery;

    public string? CandidateToken { get; } = candidateToken;

    public DateTimeOffset ExpiresAt { get; } = expiresAt;

    public string ApiBaseUrl { get; } = apiBaseUrl;

    public string? HostedUrl { get; } = hostedUrl;

    public override string ToString() => $"ProviderLaunch {{ Delivery = {Delivery}, CandidateToken = [redacted] }}";
}
