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

    /// <summary><c>POST /v1/assignments</c>. A replay with the same key returns the original assignment.</summary>
    Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
        ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken);

    /// <summary>
    /// <c>GET /v1/assignments/{id}</c>. Used to reconcile a webhook for an assignment the ATS created but did not get
    /// to record (a crash between the provider's answer and the commit): its <c>external_ref</c> is the attempt id.
    /// </summary>
    Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken);

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
/// The subject for one candidate. Names and email are sent ONLY when a link-out instrument (PCA) needs them;
/// otherwise the subject is an opaque external ref.
/// </summary>
public sealed record ProviderSubjectRequest(
    Guid TenantId, string ExternalRef, string? GivenName, string? FamilyName, string? Email, string? PreferredLocale);

public sealed record ProviderSubject(Guid SubjectId, string Status);

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
