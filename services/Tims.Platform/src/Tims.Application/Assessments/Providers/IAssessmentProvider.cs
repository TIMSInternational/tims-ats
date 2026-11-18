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

    /// <summary>
    /// <c>GET /v1/catalog/consent-templates/{purpose}?locale=</c> (<c>catalog:read</c>): the counsel-reviewed text the host
    /// shows before recording a consent with the returned <c>text_version</c>. Plain-text blocks only (never markup).
    /// </summary>
    Task<ProviderCall<ProviderConsentTemplate>> GetConsentTemplateAsync(
        string purpose, string locale, CancellationToken cancellationToken);

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
    /// <c>GET /v1/subjects/{subject_id}</c> (<c>getSubject</c>): the subject as the provider holds it. An erased or
    /// erasure-pending subject answers 410 <c>subject_erased</c>. The poller uses it to confirm an erasure whose
    /// <c>subject.erased</c> delivery never arrived.
    /// </summary>
    Task<ProviderCall<ProviderSubject>> GetSubjectAsync(Guid subjectId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>DELETE /v1/subjects/{subject_id}</c>: starts the provider's asynchronous erasure of everything it holds for the
    /// subject (DSAR). A 410 means the subject is already erased or erasure-pending.
    /// </summary>
    Task<ProviderCall<ProviderErasureReceipt>> EraseSubjectAsync(Guid subjectId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /v1/subjects/{subject_id}/export</c> (DSAR access): everything the PROVIDER holds about the subject (consents,
    /// assignments, sessions, results rendered for <c>tenant_hr</c>, media as short-lived links, its access log). Called
    /// with a token for <c>subjects:export</c> ALONE. A 404 is returned as such only when <c>GET /v1/subjects/{id}</c>
    /// confirms it (else <see cref="ProviderFailure.NotFoundUnconfirmed"/>); 410 means the subject is erased.
    /// </summary>
    Task<ProviderCall<ProviderHeldExport>> ExportSubjectAsync(Guid subjectId, CancellationToken cancellationToken);

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

    /// <summary>
    /// <c>POST /v1/assignments/{id}/launch</c> with <c>mode: hosted</c> (owner default D16: release 1 runs every native
    /// instrument in the TIMS hosted player, and the ATS links to its <c>hosted_url</c>; link-out instruments return the
    /// provider's URL whatever the mode). No candidate token is ever requested or accepted. <paramref name="returnPath"/>
    /// (a portal path such as <c>/careers/{slug}/dashboard</c>) becomes the launch's <c>return_url</c> on the configured
    /// portal origin, which must be one of the partner client's registered origins; null, or no portal origin
    /// configured, sends none.
    /// </summary>
    Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, string? returnPath, CancellationToken cancellationToken);

    /// <summary><c>GET /v1/results/{id}?audience=tenant_hr</c>, parsed and validated.</summary>
    Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken);

    /// <summary>
    /// The provider report variants the result's <c>tenant_hr</c> projection lists (<c>reports[]</c>, those offered as
    /// PDF), from <c>GET /v1/results/{id}?audience=tenant_hr</c>; empty when it lists none (every native instrument, or a
    /// projection below <c>full</c>). A body for another result id is off contract.
    /// </summary>
    Task<ProviderCall<IReadOnlyList<ProviderReportOption>>> ListResultReportsAsync(Guid resultId, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /v1/results/{id}/report?format=pdf&amp;audience=tenant_hr</c> (with <c>variant</c> for a provider report),
    /// with a token for <c>reports:read</c> alone: a partner client without that grant loses only this call. The body must
    /// be an <c>application/pdf</c> starting with <c>%PDF-</c>, within the client's report size cap.
    /// </summary>
    Task<ProviderCall<ProviderReportFile>> GetResultReportPdfAsync(
        Guid resultId, string? variant, string locale, CancellationToken cancellationToken);

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
/// <see cref="Transient"/> is true for outages, 429, 5xx and 409 <see cref="IdempotencyKeyInUse"/>: retrying the same
/// idempotent call (same key, same body) is safe and useful. <see cref="RetryAfter"/> is the provider's
/// <c>Retry-After</c>, when it sent one.
/// </summary>
public sealed record ProviderFailure(int? HttpStatus, string Code, bool Transient, IReadOnlyList<string> MissingConsents)
{
    public const string Unconfigured = "provider_unconfigured";

    /// <summary>
    /// 409 (contract, Idempotency): an earlier request with the same <c>Idempotency-Key</c> and body is still being
    /// processed, so nothing was done for this one. Retry with the same key and body after <c>Retry-After</c>: once the
    /// first request has finished, the retry gets its original response. Transient, and never a refusal: the first
    /// request may still create the resource (or store the consent).
    /// </summary>
    public const string IdempotencyKeyInUse = "idempotency_key_in_use";

    /// <summary>The provider's <c>Retry-After</c> (429, 503, 409 <see cref="IdempotencyKeyInUse"/>), when present.</summary>
    public TimeSpan? RetryAfter { get; init; }
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

    /// <summary>
    /// Local: an attempt carries no attested age band, which the contract requires on every create
    /// (<c>age_attestation</c>). Raised before anything is sent, so it proves nothing was created.
    /// </summary>
    public const string AgeAttestationRequired = "age_attestation_required";

    // Contract codes (tims-assessments.v1.yaml, Errors) that refuse a create OUTRIGHT: the provider validated the
    // request and created nothing. Deliberately absent: idempotency_key_in_use (a 409 contract code since the amended
    // contract: another request with this key is still creating it), idempotency_key_reused (an earlier body under this
    // key may have created it), and any code this connector does not know (the contract may add codes in a minor
    // version).
    private static readonly string[] RefusalCodes =
    [
        "invalid_request", "insufficient_scope", "forbidden", "not_found", "vacancy_version_mismatch", "subject_erased",
        "validation_failed", "locale_not_supported", "instrument_version_not_available",
        "instrument_not_offered_for_selection", "accommodation_not_supported", SubjectDataRequired, "age_band_not_supported",
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
            : HttpStatus is null && Code is SubjectDataRequired or AgeAttestationRequired;

    /// <summary>
    /// True only when this failure of a consent capture (<c>recordConsent</c>) PROVES the provider will not store that
    /// consent after this answer: the provider (or a gateway in front of it) refused the request outright with a 4xx, so
    /// nothing of it is still being processed there. Everything else may still be stored AFTER the answer, so the
    /// launch's capture fence must stay in flight (until stale) rather than end: no HTTP answer (a timeout, an outage, a
    /// lost connection, a cancellation, a 2xx whose body broke the contract), any 5xx (a gateway's 502/503/504 while the
    /// provider may still be processing the request behind it, Codex ATS r13 P1), and 409
    /// <see cref="IdempotencyKeyInUse"/> (the first request with this key is still running).
    /// </summary>
    public bool SettlesConsentCapture =>
        HttpStatus is >= 400 and < 500 && Code != IdempotencyKeyInUse;

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

    /// <summary>
    /// The version a new assignment must NAME so the provider serves one open for hiring, or null to name none. The
    /// provider picks its first GA version when none is named and serves a beta only when named (contract
    /// <c>createAssignment</c>): so null when that default allows selection, else the first GA version that does, else
    /// the first beta that does. Without it, an instrument offered only as a beta was refused on its first assignment
    /// (<c>instrument_version_not_available</c>) although the catalog offered it.
    /// </summary>
    public string? VersionToName
    {
        get
        {
            if (Versions.FirstOrDefault(v => v.Status == "ga") is { SelectionAllowed: true })
            {
                return null;
            }

            var open = Versions.Where(v => v.SelectionAllowed && v.Status is "ga" or "beta").ToList();
            return (open.FirstOrDefault(v => v.Status == "ga") ?? open.FirstOrDefault())?.InstrumentVersion;
        }
    }
}

/// <summary>
/// A consent template (<c>ConsentTemplate</c>): the purpose, the <c>text_version</c> a consent is recorded against, and
/// the text as plain blocks (<c>RichTextBlock</c>: paragraph, heading, list, callout), which the portal renders as text.
/// </summary>
public sealed record ProviderConsentTemplate(
    string Purpose, string TextVersion, string Locale, string Title, IReadOnlyList<ConsentTextBlock> Blocks,
    IReadOnlyList<string> Disclosures);

/// <summary>One plain-text block: <c>paragraph</c>/<c>callout</c> (text), <c>heading</c> (text, level), <c>list</c> (items).</summary>
public sealed record ConsentTextBlock(
    string Type, string? Text, int? Level = null, bool? Ordered = null, IReadOnlyList<string>? Items = null, string? Tone = null);

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
/// carry the adjustment only (multiplier + aids), never its reason. <see cref="AgeBand"/> is the attested band sent as
/// <c>age_attestation</c> (required by the amended contract), never an age or a date of birth.
/// <see cref="InstrumentVersion"/> is the version the vacancy is already pinned to (design §6.3: every candidate of a
/// vacancy sits the same version), sent as <c>instrument_version</c>. A vacancy's first assignment names one only when
/// the provider would not serve it by default (<see cref="ProviderCatalogInstrument.VersionToName"/>), else null.
/// <see cref="Proctoring"/> is the block stored on the attempt when it was reserved (the org's settings then), sent as
/// <c>proctoring</c>; null sends none (the instrument's default policy) and is always null for a link-out instrument.
/// Because it comes from the attempt row, every re-send of a create carries the same block, so a settings change can
/// never turn an idempotent retry into a 409 <c>external_ref_conflict</c>. <see cref="JobCode"/> (PCA only) is the
/// vacancy's TIMS position code, sent as <c>vacancy.job_code</c>, also from the attempt row for the same reason (the
/// Idempotency-Key is bound to the body); null sends none.
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
    string ExternalRef,
    string AgeBand,
    string? InstrumentVersion = null,
    AssessmentProctoring? Proctoring = null,
    string? JobCode = null);

/// <summary>
/// An assignment as the provider holds it. <see cref="ResultId"/> and the sitting timestamps are what the D17 poller
/// reads to advance an attempt without a webhook (null until they happen, or when an older provider omits them).
/// <see cref="VoidReason"/> is the contract's <c>void_reason</c> when the provider sent a known one.
/// </summary>
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
    string? ExternalRef = null,
    Guid? ResultId = null,
    DateTimeOffset? StartedAt = null,
    DateTimeOffset? CompletedAt = null,
    DateTimeOffset? VoidedAt = null,
    string? VoidReason = null);

public sealed record ProviderConsentRequest(
    string Purpose, string TextVersion, string Locale, DateTimeOffset GrantedAt, string HostRecordRef,
    string ExternalVacancyRef);

/// <param name="ExternalVacancyRef">
/// The consent's <c>scope.external_vacancy_ref</c>: the one vacancy it covers, or null for an unscoped consent (which covers
/// every vacancy). The provider counts a consent toward an assignment only when it is unscoped or scoped to that
/// assignment's vacancy.
/// </param>
public sealed record ProviderConsentRecord(Guid ConsentId, string Purpose, string Status, string? ExternalVacancyRef = null)
{
    /// <summary>Whether the provider counts this consent toward an assignment of <paramref name="externalVacancyRef"/>.</summary>
    public bool Covers(string externalVacancyRef) =>
        ExternalVacancyRef is null || string.Equals(ExternalVacancyRef, externalVacancyRef, StringComparison.Ordinal);
}

/// <summary>The names and email a link-out instrument needs, set on an existing subject (merge semantics).</summary>
public sealed record ProviderSubjectUpdate(string GivenName, string FamilyName, string Email);

/// <summary>
/// The provider's DSAR export of one subject (<c>SubjectExport</c>), checked for shape and kept as the provider's own JSON.
/// It holds personal data and short-lived media links meant for the data subject only, so <see cref="ToString"/> redacts.
/// </summary>
public sealed class ProviderHeldExport(Guid subjectId, string json)
{
    public Guid SubjectId { get; } = subjectId;

    public string Json { get; } = json;

    public override string ToString() => $"ProviderHeldExport {{ SubjectId = {SubjectId}, Json = [redacted] }}";
}

/// <summary>The provider's receipt for an erasure request (<c>accepted</c>, <c>in_progress</c> or <c>completed</c>).</summary>
public sealed record ProviderErasureReceipt(Guid SubjectId, string Status);

/// <summary>The answer to a lookup by external ref: the one assignment, or none (an empty page).</summary>
public sealed class ProviderAssignmentLookup(ProviderAssignment? assignment)
{
    public ProviderAssignment? Assignment { get; } = assignment;
}

/// <summary>
/// A hosted launch (D16). <see cref="HostedUrl"/> is the TIMS hosted player's URL (native) or the provider's
/// questionnaire URL (link-out). A native player URL carries a single-use launch code, which is a bearer credential until
/// it is spent or expires (<see cref="ExpiresAt"/>, at most 300 s): it goes only into the candidate's own response body,
/// is never stored or logged, so this is a class with a redacting <see cref="ToString"/>. <see cref="FrameAncestors"/>
/// lists the registered origins allowed to frame a native player; it is empty for a link-out (never framed).
/// </summary>
public sealed class ProviderLaunch(
    string delivery, DateTimeOffset expiresAt, string hostedUrl, IReadOnlyList<string> frameAncestors)
{
    public string Delivery { get; } = delivery;

    public DateTimeOffset ExpiresAt { get; } = expiresAt;

    public string HostedUrl { get; } = hostedUrl;

    public IReadOnlyList<string> FrameAncestors { get; } = frameAncestors;

    public override string ToString() => $"ProviderLaunch {{ Delivery = {Delivery}, HostedUrl = [redacted] }}";
}
