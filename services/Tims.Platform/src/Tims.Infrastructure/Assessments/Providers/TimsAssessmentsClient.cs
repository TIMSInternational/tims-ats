using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// Typed HTTP client for the TIMS Assessments API v1 (<c>tims-assessments.v1.yaml</c>), the
/// <see cref="IAssessmentProvider"/> adapter.
/// <list type="bullet">
/// <item>Auth: a cached client-credentials bearer token (<see cref="ClientCredentialsTokenCache"/>); a 401 drops it and
/// retries once with a fresh token.</item>
/// <item>Every create sends <c>Idempotency-Key</c>; request bodies are built key by key (snake_case, nulls omitted).</item>
/// <item>Errors are RFC 9457 problem documents: the stable <c>code</c> (and <c>missing_consents</c>) is surfaced;
/// network errors, timeouts, 429 and 5xx are transient.</item>
/// <item>Every response is validated before use; an off-contract response is a non-transient contract violation.</item>
/// <item>Logs carry the operation and HTTP status only — never tokens, secrets, bodies or ids of people.</item>
/// </list>
/// </summary>
public sealed class TimsAssessmentsClient(
    HttpClient http,
    ClientCredentialsTokenCache tokens,
    IOptions<AssessmentProviderOptions> options,
    ILogger<TimsAssessmentsClient> logger) : IAssessmentProvider
{
    public const string HttpClientName = "tims-assessments";
    public const int MaxResponseBytes = 262_144;

    private readonly AssessmentProviderOptions _options = options.Value;

    public bool IsConfigured => _options.IsConfigured;

    public Task<ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>> ListInstrumentsAsync(CancellationToken cancellationToken) =>
        SendAsync<IReadOnlyList<ProviderCatalogInstrument>>(
            HttpMethod.Get, "/v1/catalog/instruments", null, null, "list_instruments", ProviderResponses.Catalog,
            cancellationToken);

    public Task<ProviderCall<ProviderTenant>> EnsureTenantAsync(
        ProviderTenantRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var body = new JsonObject
        {
            ["external_org_ref"] = request.ExternalOrgRef,
            ["display_name"] = request.DisplayName,
            ["default_locale"] = request.DefaultLocale,
        };
        return SendAsync(HttpMethod.Post, "/v1/tenants", body, idempotencyKey, "create_tenant", ProviderResponses.Tenant,
            cancellationToken);
    }

    public Task<ProviderCall<ProviderSubject>> EnsureSubjectAsync(
        ProviderSubjectRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var body = new JsonObject
        {
            ["tenant_id"] = request.TenantId.ToString(),
            ["external_ref"] = request.ExternalRef,
        };
        AddIfPresent(body, "given_name", request.GivenName);
        AddIfPresent(body, "family_name", request.FamilyName);
        AddIfPresent(body, "email", request.Email);
        AddIfPresent(body, "preferred_locale", request.PreferredLocale);
        return SendAsync(HttpMethod.Post, "/v1/subjects", body, idempotencyKey, "create_subject", ProviderResponses.Subject,
            cancellationToken);
    }

    public Task<ProviderCall<ProviderAssignment>> CreateAssignmentAsync(
        ProviderAssignmentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var aids = new JsonArray();
        foreach (var aid in request.Aids)
        {
            aids.Add(aid);
        }

        var body = new JsonObject
        {
            ["tenant_id"] = request.TenantId.ToString(),
            ["subject_id"] = request.SubjectId.ToString(),
            ["instrument"] = request.Instrument,
            ["locale"] = request.Locale,
            ["purpose"] = "selection",
            ["vacancy"] = new JsonObject
            {
                ["external_vacancy_ref"] = request.ExternalVacancyRef,
                ["job_relatedness_reason"] = request.JobRelatednessReason,
            },
            ["accommodations"] = new JsonObject
            {
                ["time_multiplier"] = request.TimeMultiplier,
                ["aids"] = aids,
            },
            ["external_ref"] = request.ExternalRef,
        };
        if (request.ExpiresAt is { } expiresAt)
        {
            body["expires_at"] = FormatTimestamp(expiresAt);
        }

        return SendAsync(HttpMethod.Post, "/v1/assignments", body, idempotencyKey, "create_assignment",
            ProviderResponses.Assignment, cancellationToken);
    }

    public Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Get, $"/v1/assignments/{assignmentId:D}", null, null, "get_assignment",
            ProviderResponses.Assignment, cancellationToken);

    public Task<ProviderCall<ProviderConsentRecord>> RecordConsentAsync(
        Guid subjectId, ProviderConsentRequest request, string idempotencyKey, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var body = new JsonObject
        {
            ["purpose"] = request.Purpose,
            ["text_version"] = request.TextVersion,
            ["locale"] = request.Locale,
            ["granted_at"] = FormatTimestamp(request.GrantedAt),
            ["capture_method"] = "host_ui",
            ["host_record_ref"] = request.HostRecordRef,
            ["scope"] = new JsonObject { ["external_vacancy_ref"] = request.ExternalVacancyRef },
        };
        return SendAsync(HttpMethod.Post, $"/v1/subjects/{subjectId:D}/consents", body, idempotencyKey, "record_consent",
            ProviderResponses.Consent, cancellationToken);
    }

    public Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, $"/v1/assignments/{assignmentId:D}/launch", new JsonObject { ["mode"] = "headless" },
            null, "launch", root => ProviderResponses.Launch(root, assignmentId), cancellationToken);

    public Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Get, $"/v1/results/{resultId:D}?audience=tenant_hr", null, null, "get_result",
            root => ProviderResultParser.TryParse(root, out var parsed, out _) ? parsed : null, cancellationToken);

    public WebhookSignatureCheck VerifyWebhook(string? signatureHeader, ReadOnlySpan<byte> rawBody, DateTimeOffset now) =>
        WebhookSignature.Verify(signatureHeader, rawBody, _options.SigningSecrets, now);

    private async Task<ProviderCall<T>> SendAsync<T>(
        HttpMethod method, string pathAndQuery, JsonObject? body, string? idempotencyKey, string operation,
        Func<JsonElement, T?> parse, CancellationToken cancellationToken)
        where T : class
    {
        if (!IsConfigured)
        {
            return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.Unconfigured, transient: false));
        }

        var uri = new Uri(new Uri(_options.BaseUrl!), pathAndQuery);
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var token = await tokens.GetTokenAsync(cancellationToken).ConfigureAwait(false);
            if (token is null)
            {
                return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.TokenUnavailable, transient: true));
            }

            using var request = new HttpRequestMessage(method, uri);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            if (idempotencyKey is not null)
            {
                request.Headers.Add("Idempotency-Key", idempotencyKey);
            }

            if (body is not null)
            {
                request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            }

            HttpStatusCode status;
            string text;
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(_options.RequestTimeoutSeconds));
                using var response = await http.SendAsync(request, timeout.Token).ConfigureAwait(false);
                status = response.StatusCode;
                text = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (HttpRequestException)
            {
                logger.LogWarning("TIMS Assessments {Operation} unreachable", operation);
                return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, transient: true));
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning("TIMS Assessments {Operation} timed out", operation);
                return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, transient: true));
            }

            if (status == HttpStatusCode.Unauthorized && attempt == 0)
            {
                tokens.Invalidate();
                continue;
            }

            if ((int)status is >= 200 and < 300)
            {
                var parsed = TryParse(text, parse);
                if (parsed is null)
                {
                    logger.LogWarning("TIMS Assessments {Operation} returned an off-contract body", operation);
                    return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.ContractViolation, transient: false));
                }

                return ProviderCall<T>.Success(parsed);
            }

            logger.LogWarning("TIMS Assessments {Operation} failed with {Status}", operation, (int)status);
            return ProviderCall<T>.Fail(ProviderResponses.Problem((int)status, text));
        }

        return ProviderCall<T>.Fail(new ProviderFailure(401, "unauthorized", false, []));
    }

    private static T? TryParse<T>(string text, Func<JsonElement, T?> parse)
        where T : class
    {
        try
        {
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 32 });
            return parse(document.RootElement);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static void AddIfPresent(JsonObject body, string key, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            body[key] = value;
        }
    }

    internal static string FormatTimestamp(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
}
