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
/// network errors, timeouts, 429, 5xx and 409 <c>idempotency_key_in_use</c> are transient.</item>
/// <item>409 <c>idempotency_key_in_use</c> on a keyed request (the amended contract: an earlier request with the same key
/// and body is still being processed, and nothing was done for this one) is retried ONCE in place with the same key and
/// body when its <c>Retry-After</c> is at most <see cref="MaxInlineRetryAfter"/>; otherwise it is returned as transient
/// with the delay, and the caller retries later with the same key and body.</item>
/// <item>Every response is validated before use; an off-contract response is a non-transient contract violation.</item>
/// <item>Logs carry the operation and HTTP status only — never tokens, secrets, bodies or ids of people.</item>
/// </list>
/// </summary>
public sealed class TimsAssessmentsClient(
    HttpClient http,
    ClientCredentialsTokenCache tokens,
    IOptions<AssessmentProviderOptions> options,
    ILogger<TimsAssessmentsClient> logger,
    TimeProvider timeProvider) : IAssessmentProvider
{
    public const string HttpClientName = "tims-assessments";
    public const int MaxResponseBytes = 262_144;

    /// <summary>
    /// The longest <c>Retry-After</c> an <c>idempotency_key_in_use</c> is waited out in place (once). Longer, the failure
    /// goes back to the caller: a webhook, a launch or an assign must not hold its request that long. A 409 without
    /// <c>Retry-After</c> is waited out for <see cref="DefaultInUseRetryAfter"/>.
    /// </summary>
    public static readonly TimeSpan MaxInlineRetryAfter = TimeSpan.FromSeconds(2);

    public static readonly TimeSpan DefaultInUseRetryAfter = TimeSpan.FromSeconds(1);

    private readonly AssessmentProviderOptions _options = options.Value;

    public bool IsConfigured => _options.IsConfigured;

    public Task<ProviderCall<IReadOnlyList<ProviderCatalogInstrument>>> ListInstrumentsAsync(CancellationToken cancellationToken) =>
        SendAsync<IReadOnlyList<ProviderCatalogInstrument>>(
            HttpMethod.Get, "v1/catalog/instruments", null, null, "list_instruments", ProviderResponses.Catalog,
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
        return SendAsync(HttpMethod.Post, "v1/tenants", body, idempotencyKey, "create_tenant", ProviderResponses.Tenant,
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
        return SendAsync(HttpMethod.Post, "v1/subjects", body, idempotencyKey, "create_subject", ProviderResponses.Subject,
            cancellationToken);
    }

    public Task<ProviderCall<ProviderSubject>> UpdateSubjectAsync(
        Guid subjectId, ProviderSubjectUpdate update, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(update);
        var body = new JsonObject
        {
            ["given_name"] = update.GivenName,
            ["family_name"] = update.FamilyName,
            ["email"] = update.Email,
        };
        return SendAsync(HttpMethod.Patch, $"v1/subjects/{subjectId:D}", body, null, "update_subject",
            root => ProviderResponses.Subject(root) is { } subject && subject.SubjectId == subjectId ? subject : null,
            cancellationToken);
    }

    /// <summary>
    /// <c>DELETE /v1/subjects/{id}</c>. A 404 is returned as such ("no such subject") ONLY when <c>GET /v1/subjects/{id}</c>
    /// confirms it; a 410 there is returned as the subject already erased. A provider that does not serve the erase
    /// route answers its catch-all 404 with the same <c>not_found</c> code, and the erasure use case counts a 404 as
    /// done, so an unconfirmed 404 (the subject is still served, or the check failed) is a transient
    /// <see cref="ProviderFailure.NotFoundUnconfirmed"/> instead: nothing is recorded and the erasure stays retryable.
    /// </summary>
    public async Task<ProviderCall<ProviderErasureReceipt>> EraseSubjectAsync(Guid subjectId, CancellationToken cancellationToken)
    {
        var erased = await SendAsync(HttpMethod.Delete, $"v1/subjects/{subjectId:D}", null, null, "erase_subject",
                root => ProviderResponses.ErasureReceipt(root) is { } receipt && receipt.SubjectId == subjectId ? receipt : null,
                cancellationToken)
            .ConfigureAwait(false);
        if (erased.Ok || erased.Failure!.HttpStatus != 404)
        {
            return erased;
        }

        return ProviderCall<ProviderErasureReceipt>.Fail(
            await ConfirmSubjectGoneAsync(subjectId, "erase_subject", cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// <c>GET /v1/subjects/{id}/consents</c>. The #312 cascade reads a 404 as "the subject holds no consent", so a 404 is
    /// returned as such only when <see cref="ConfirmSubjectGoneAsync"/> confirms it; otherwise it is
    /// <see cref="ProviderFailure.NotFoundUnconfirmed"/>.
    /// </summary>
    public async Task<ProviderCall<IReadOnlyList<ProviderConsentRecord>>> ListConsentsAsync(
        Guid subjectId, CancellationToken cancellationToken)
    {
        var listed = await SendAsync<IReadOnlyList<ProviderConsentRecord>>(HttpMethod.Get,
                $"v1/subjects/{subjectId:D}/consents", null, null, "list_consents", ProviderResponses.ConsentList,
                cancellationToken)
            .ConfigureAwait(false);
        if (listed.Ok || listed.Failure!.HttpStatus != 404)
        {
            return listed;
        }

        return ProviderCall<IReadOnlyList<ProviderConsentRecord>>.Fail(
            await ConfirmSubjectGoneAsync(subjectId, "list_consents", cancellationToken).ConfigureAwait(false));
    }

    /// <summary>
    /// <c>POST /v1/subjects/{id}/consents/{consentId}/withdrawal</c>. The #312 cascade reads a 404 as "nothing left to
    /// withdraw", so a 404 is confirmed by listing the subject's consents (itself confirmed, see
    /// <see cref="ListConsentsAsync"/>): a consent the list no longer holds, or a subject confirmed gone, returns the
    /// 404/410; a consent the list shows as no longer <c>active</c> is returned as the success the route would give;
    /// a consent still active, or a failed list, is <see cref="ProviderFailure.NotFoundUnconfirmed"/>.
    /// </summary>
    public async Task<ProviderCall<ProviderConsentRecord>> WithdrawConsentAsync(
        Guid subjectId, Guid consentId, DateTimeOffset withdrawnAt, CancellationToken cancellationToken)
    {
        var withdrawn = await SendAsync(HttpMethod.Post, $"v1/subjects/{subjectId:D}/consents/{consentId:D}/withdrawal",
                new JsonObject { ["withdrawn_at"] = FormatTimestamp(withdrawnAt) }, null, "withdraw_consent",
                root => ProviderResponses.Consent(root) is { } consent && consent.ConsentId == consentId ? consent : null,
                cancellationToken)
            .ConfigureAwait(false);
        if (withdrawn.Ok || withdrawn.Failure!.HttpStatus != 404)
        {
            return withdrawn;
        }

        var listed = await ListConsentsAsync(subjectId, cancellationToken).ConfigureAwait(false);
        if (!listed.Ok)
        {
            return listed.Failure!.HttpStatus is 404 or 410
                ? ProviderCall<ProviderConsentRecord>.Fail(listed.Failure)
                : Unconfirmed<ProviderConsentRecord>("withdraw_consent");
        }

        var held = listed.Value!.FirstOrDefault(c => c.ConsentId == consentId);
        if (held is null)
        {
            return withdrawn;
        }

        return held.Status == "active"
            ? Unconfirmed<ProviderConsentRecord>("withdraw_consent")
            : ProviderCall<ProviderConsentRecord>.Success(held);
    }

    /// <summary>
    /// The failure to return for a 404 on a subject-scoped route: the 404/410 from <c>GET /v1/subjects/{id}</c> when the
    /// provider confirms the subject is gone, else <see cref="ProviderFailure.NotFoundUnconfirmed"/>.
    /// </summary>
    private async Task<ProviderFailure> ConfirmSubjectGoneAsync(Guid subjectId, string operation, CancellationToken cancellationToken)
    {
        var probe = await SendAsync(HttpMethod.Get, $"v1/subjects/{subjectId:D}", null, null, "get_subject",
                root => ProviderResponses.Subject(root) is { } subject && subject.SubjectId == subjectId ? subject : null,
                cancellationToken)
            .ConfigureAwait(false);
        if (!probe.Ok && probe.Failure!.HttpStatus is 404 or 410)
        {
            return probe.Failure;
        }

        logger.LogWarning("TIMS Assessments {Operation} answered 404 without a confirming lookup", operation);
        return ProviderFailure.Local(ProviderFailure.NotFoundUnconfirmed, transient: true);
    }

    private ProviderCall<T> Unconfirmed<T>(string operation)
        where T : class
    {
        logger.LogWarning("TIMS Assessments {Operation} answered 404 without a confirming lookup", operation);
        return ProviderCall<T>.Fail(ProviderFailure.Local(ProviderFailure.NotFoundUnconfirmed, transient: true));
    }

    public Task<ProviderCall<ProviderAssignmentLookup>> FindAssignmentByExternalRefAsync(
        Guid tenantId, string externalRef, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(externalRef);
        var query = $"v1/assignments?tenant_id={tenantId:D}&external_ref={Uri.EscapeDataString(externalRef)}";
        return SendAsync(HttpMethod.Get, query, null, null, "find_assignment",
            root => ProviderResponses.AssignmentLookup(root, tenantId, externalRef), cancellationToken);
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

        return SendAsync(HttpMethod.Post, "v1/assignments", body, idempotencyKey, "create_assignment",
            ProviderResponses.Assignment, cancellationToken);
    }

    public Task<ProviderCall<ProviderAssignment>> GetAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Get, $"v1/assignments/{assignmentId:D}", null, null, "get_assignment",
            ProviderResponses.Assignment, cancellationToken);

    /// <summary>
    /// <c>POST /v1/assignments/{id}/cancel</c>, which the contract makes idempotent (an already-cancelled assignment
    /// answers 200). Every caller reads a 404 as "the assignment is gone" and clears its cleanup marker, so a 404 is
    /// returned as such ONLY when <c>GET /v1/assignments/{id}</c> confirms it (404 or 410). A provider that does not serve
    /// the cancel route answers its catch-all 404 with the same <c>not_found</c> code: when the GET still finds the
    /// assignment, a <c>cancelled</c> one is returned as the success the route would have given, and anything else (or
    /// a failed GET) is a transient <see cref="ProviderFailure.NotFoundUnconfirmed"/>, so the marker stays and the
    /// cancel is retried.
    /// </summary>
    public async Task<ProviderCall<ProviderAssignment>> CancelAssignmentAsync(Guid assignmentId, CancellationToken cancellationToken)
    {
        var cancelled = await SendAsync(HttpMethod.Post, $"v1/assignments/{assignmentId:D}/cancel", null, null,
                "cancel_assignment",
                root => ProviderResponses.Assignment(root) is { } assignment && assignment.AssignmentId == assignmentId
                    ? assignment
                    : null,
                cancellationToken)
            .ConfigureAwait(false);
        if (cancelled.Ok || cancelled.Failure!.HttpStatus != 404)
        {
            return cancelled;
        }

        var probe = await SendAsync(HttpMethod.Get, $"v1/assignments/{assignmentId:D}", null, null, "get_assignment",
                root => ProviderResponses.Assignment(root) is { } assignment && assignment.AssignmentId == assignmentId
                    ? assignment
                    : null,
                cancellationToken)
            .ConfigureAwait(false);
        if (!probe.Ok && probe.Failure!.HttpStatus is 404 or 410)
        {
            return cancelled;
        }

        if (probe.Ok && string.Equals(probe.Value!.Status, "cancelled", StringComparison.Ordinal))
        {
            return probe;
        }

        logger.LogWarning("TIMS Assessments cancel_assignment answered 404 without a confirming lookup");
        return ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.NotFoundUnconfirmed, transient: true));
    }

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
        return SendAsync(HttpMethod.Post, $"v1/subjects/{subjectId:D}/consents", body, idempotencyKey, "record_consent",
            ProviderResponses.Consent, cancellationToken);
    }

    public Task<ProviderCall<ProviderLaunch>> LaunchAsync(Guid assignmentId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Post, $"v1/assignments/{assignmentId:D}/launch", new JsonObject { ["mode"] = "headless" },
            null, "launch", root => ProviderResponses.Launch(root, assignmentId), cancellationToken);

    public Task<ProviderCall<ParsedProviderResult>> GetResultAsync(Guid resultId, CancellationToken cancellationToken) =>
        SendAsync(HttpMethod.Get, $"v1/results/{resultId:D}?audience=tenant_hr", null, null, "get_result",
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

        // Relative join (D18): a base path such as https://www.timssuite.com/api is kept, never replaced by /v1.
        var uri = new Uri(_options.ResolvedBaseUri, pathAndQuery);
        var unauthorizedRetried = false;
        var inUseRetried = false;
        while (true)
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
            TimeSpan? retryAfter;
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(_options.RequestTimeoutSeconds));
                using var response = await http.SendAsync(request, timeout.Token).ConfigureAwait(false);
                status = response.StatusCode;
                retryAfter = ProviderResponses.RetryAfter(response.Headers.RetryAfter, timeProvider.GetUtcNow());
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

            if (status == HttpStatusCode.Unauthorized)
            {
                if (unauthorizedRetried)
                {
                    return ProviderCall<T>.Fail(new ProviderFailure(401, "unauthorized", false, []));
                }

                unauthorizedRetried = true;
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

            var failure = ProviderResponses.Problem((int)status, text, retryAfter);
            if (failure.Code == ProviderFailure.IdempotencyKeyInUse && idempotencyKey is not null && !inUseRetried
                && (failure.RetryAfter ?? DefaultInUseRetryAfter) <= MaxInlineRetryAfter)
            {
                // The first request with this key is still running and nothing was done for this one: wait it out once,
                // then send the SAME key and body, which then returns the first request's original response.
                inUseRetried = true;
                logger.LogInformation("TIMS Assessments {Operation}: idempotency key in use, retrying once", operation);
                await Task.Delay(failure.RetryAfter ?? DefaultInUseRetryAfter, timeProvider, cancellationToken)
                    .ConfigureAwait(false);
                continue;
            }

            logger.LogWarning("TIMS Assessments {Operation} failed with {Status}", operation, (int)status);
            return ProviderCall<T>.Fail(failure);
        }
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
