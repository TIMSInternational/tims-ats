using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The typed /v1 client over a stub HTTP handler (no network, no container): client-credentials token caching,
/// the 401 retry, idempotency keys, problem+json mapping, response validation and the unconfigured fail-closed path.
/// </summary>
public sealed class TimsAssessmentsClientTests
{
    private const string TokenUrl = "https://assessments.test/oauth/token";

    // Deliberately low-entropy: a test value must never look like a real credential to a secret scanner.
    private static readonly string FakeCandidateToken = "test-candidate-token-" + new string('x', 24);

    private readonly ManualClock _clock = new(new DateTimeOffset(2026, 11, 9, 12, 0, 0, TimeSpan.Zero));
    private readonly StubHandler _handler = new();

    private static AssessmentProviderOptions Configured(string secret = "client-secret", string? webhookPrevious = null) => new()
    {
        BaseUrl = "https://assessments.test",
        TokenUrl = TokenUrl,
        ClientId = "tims-ats",
        ClientSecret = secret,
        WebhookSigningSecret = "whsec_current",
        WebhookSigningSecretPrevious = webhookPrevious,
    };

    private TimsAssessmentsClient Client(AssessmentProviderOptions? options = null)
    {
        var wrapped = Options.Create(options ?? Configured());
        var cache = new ClientCredentialsTokenCache(new StubFactory(_handler), wrapped, _clock,
            NullLogger<ClientCredentialsTokenCache>.Instance);
        return new TimsAssessmentsClient(new HttpClient(_handler), cache, wrapped, NullLogger<TimsAssessmentsClient>.Instance,
            _clock);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json, string mediaType = "application/json") =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, mediaType) };

    private static HttpResponseMessage Token(string value = "access-token-1", int expiresIn = 900) =>
        Json(HttpStatusCode.OK, $$"""{"access_token":"{{value}}","token_type":"Bearer","expires_in":{{expiresIn}}}""");

    private static string AssignmentJson(Guid id) => $$"""
        {"assignment_id":"{{id}}","tenant_id":"3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12","subject_id":"7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d",
         "instrument":"lia","instrument_version":"1.0","content_version":"lia-2026.11.1","locale":"es","purpose":"selection",
         "accommodations":{"time_multiplier":1.5,"aids":[]},"status":"created","required_consents":["assessment"],
         "missing_consents":["assessment"],"expires_at":"2026-11-23T14:00:00Z","created_at":"2026-11-09T13:00:00Z",
         "started_at":null,"completed_at":null,"result_id":null,"unknown_future_field":true}
        """;

    private static ProviderAssignmentRequest AssignmentRequest() => new(
        Guid.Parse("3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12"), Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d"), "lia", "es",
        "a0000000-0000-4000-8000-000000000001", "Análisis de datos", 1.5m, ["extended_breaks"], null, "attempt-1");

    [Fact]
    public async Task One_token_serves_several_calls_and_is_requested_with_basic_client_auth()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, """{"data":[]}"""));
        var client = Client();

        Assert.True((await client.ListInstrumentsAsync(CancellationToken.None)).Ok);
        Assert.True((await client.ListInstrumentsAsync(CancellationToken.None)).Ok);

        var tokenRequests = _handler.Requests.Where(r => r.Uri == TokenUrl).ToList();
        var tokenRequest = Assert.Single(tokenRequests);
        Assert.Equal("Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("tims-ats:client-secret")), tokenRequest.Authorization);
        Assert.Contains("grant_type=client_credentials", tokenRequest.Body);
        Assert.Contains("scope=catalog%3Aread+assignments%3Awrite+subjects%3Awrite+results%3Aread", tokenRequest.Body);
        Assert.All(_handler.Requests.Where(r => r.Uri != TokenUrl), r => Assert.Equal("Bearer access-token-1", r.Authorization));
    }

    [Fact]
    public async Task The_token_is_refreshed_a_minute_before_it_expires()
    {
        var issued = 0;
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token("token-" + ++issued, 900) : Json(HttpStatusCode.OK, """{"data":[]}"""));
        var client = Client();

        await client.ListInstrumentsAsync(CancellationToken.None);
        _clock.Advance(TimeSpan.FromSeconds(839));
        await client.ListInstrumentsAsync(CancellationToken.None);
        _clock.Advance(TimeSpan.FromSeconds(2)); // 841 s: inside the 60 s refresh skew of a 900 s token
        await client.ListInstrumentsAsync(CancellationToken.None);

        Assert.Equal(2, issued);
        Assert.Equal("Bearer token-2", _handler.Requests[^1].Authorization);
    }

    [Fact]
    public async Task A_401_drops_the_token_and_retries_exactly_once()
    {
        var issued = 0;
        var calls = 0;
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl
            ? Token("token-" + ++issued)
            : ++calls == 1 ? new HttpResponseMessage(HttpStatusCode.Unauthorized) : Json(HttpStatusCode.OK, """{"data":[]}"""));

        var result = await Client().ListInstrumentsAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(2, issued);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task Two_401s_in_a_row_fail_without_looping()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : new HttpResponseMessage(HttpStatusCode.Unauthorized));

        var result = await Client().ListInstrumentsAsync(CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(401, result.Failure!.HttpStatus);
        Assert.Equal(2, _handler.Requests.Count(r => r.Uri != TokenUrl));
    }

    [Fact]
    public async Task Create_assignment_sends_the_idempotency_key_and_the_contract_body()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.Created, AssignmentJson(id)));

        var result = await Client().CreateAssignmentAsync(AssignmentRequest(), "ats-attempt-1", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(id, result.Value!.AssignmentId);
        Assert.Equal(["assessment"], result.Value.MissingConsents);
        var sent = _handler.Requests.Single(r => r.Uri == "https://assessments.test/v1/assignments");
        Assert.Equal("ats-attempt-1", sent.IdempotencyKey);
        var body = JsonNode.Parse(sent.Body)!;
        Assert.Equal("selection", body["purpose"]!.GetValue<string>());
        Assert.Equal("Análisis de datos", body["vacancy"]!["job_relatedness_reason"]!.GetValue<string>());
        Assert.Equal(1.5m, body["accommodations"]!["time_multiplier"]!.GetValue<decimal>());
        Assert.Null(body["expires_at"]); // omitted, not null
    }

    [Fact]
    public async Task Cancel_posts_no_body_and_no_key_and_must_answer_for_the_requested_assignment()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, AssignmentJson(id)));
        var client = Client();

        var cancelled = await client.CancelAssignmentAsync(id, CancellationToken.None);
        var mismatched = await client.CancelAssignmentAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.True(cancelled.Ok);
        var sent = _handler.Requests.First(r => r.Uri == $"https://assessments.test/v1/assignments/{id}/cancel");
        Assert.Null(sent.IdempotencyKey); // the contract's cancel is idempotent and takes no key
        Assert.Equal(string.Empty, sent.Body);
        Assert.Equal(ProviderFailure.ContractViolation, mismatched.Failure!.Code);
    }

    [Theory]
    [InlineData(""","given_name":"Ana","family_name":"Pérez","email":"ana@example.com" """, true)]
    [InlineData(""","given_name":"Ana","family_name":"Pérez" """, false)]
    [InlineData("", false)]
    public async Task A_subject_reports_whether_the_provider_holds_its_names_and_email(string names, bool expected)
    {
        var json = """{"subject_id":"7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d","tenant_id":"3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12","external_ref":"c1","status":"active","created_at":"2026-11-09T13:00:00Z" """
            + names + "}";
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, json));

        var subject = await Client().EnsureSubjectAsync(
            new ProviderSubjectRequest(Guid.Parse("3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12"), "c1", null, null, null, null),
            "ats-subject-1", CancellationToken.None);

        Assert.Equal(expected, subject.Value!.HasNamesAndEmail);
    }

    [Fact]
    public async Task A_problem_document_surfaces_its_code_and_missing_consents()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl
            ? Token()
            : Json(HttpStatusCode.Conflict,
                """{"type":"https://contracts.timsinternational.com/problems/consent_required","title":"Consent required","status":409,"code":"consent_required","request_id":"r1","missing_consents":["ai_scoring","not_a_purpose"]}""",
                "application/problem+json"));

        var result = await Client().LaunchAsync(Guid.NewGuid(), null, CancellationToken.None);

        Assert.Equal("consent_required", result.Failure!.Code);
        Assert.Equal(["ai_scoring"], result.Failure.MissingConsents);
        Assert.False(result.Failure.Transient);
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, true)]
    [InlineData(HttpStatusCode.TooManyRequests, true)]
    [InlineData(HttpStatusCode.BadGateway, true)]
    [InlineData(HttpStatusCode.UnprocessableEntity, false)]
    public async Task Outages_and_rate_limits_are_transient_refusals_are_not(HttpStatusCode status, bool transient)
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(status, "<html>proxy error</html>", "text/html"));

        var result = await Client().CreateAssignmentAsync(AssignmentRequest(), "k", CancellationToken.None);

        Assert.Equal(transient, result.Failure!.Transient);
    }

    [Fact]
    public async Task An_off_contract_success_body_is_a_contract_violation_not_a_value()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl
            ? Token()
            : Json(HttpStatusCode.OK, """{"assignment_id":"not-a-uuid","instrument":"lia"}"""));

        var result = await Client().CreateAssignmentAsync(AssignmentRequest(), "k", CancellationToken.None);

        Assert.Equal(ProviderFailure.ContractViolation, result.Failure!.Code);
    }

    [Theory]
    [InlineData("REPLACE_ME_OUT_OF_BAND")]
    [InlineData("")]
    public async Task An_unconfigured_or_placeholder_secret_never_reaches_the_network(string secret)
    {
        var client = Client(Configured(secret));

        var result = await client.ListInstrumentsAsync(CancellationToken.None);

        Assert.False(client.IsConfigured);
        Assert.Equal(ProviderFailure.Unconfigured, result.Failure!.Code);
        Assert.Empty(_handler.Requests);
    }

    // Owner default D18: the suite serves /v1 under /api (publicBaseUrl https://www.timssuite.com/api), so the base URL
    // carries a path and every call path is joined RELATIVE to it. An absolute "/v1/…" join dropped the base path and
    // sent every call to https://host/v1/… (a 404).
    [Theory]
    [InlineData("https://suite.test/api", "https://suite.test/api/v1/")]
    [InlineData("https://suite.test/api/", "https://suite.test/api/v1/")]
    [InlineData("https://suite.test/partners/api", "https://suite.test/partners/api/v1/")]
    [InlineData("https://assessments.test", "https://assessments.test/v1/")]
    [InlineData("https://assessments.test/", "https://assessments.test/v1/")]
    public async Task Every_call_path_is_joined_relative_to_the_base_url_and_keeps_its_path(string baseUrl, string prefix)
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, """{"data":[]}"""));
        var options = Configured();
        var client = Client(new AssessmentProviderOptions
        {
            BaseUrl = baseUrl,
            TokenUrl = options.TokenUrl,
            ClientId = options.ClientId,
            ClientSecret = options.ClientSecret,
            WebhookSigningSecret = options.WebhookSigningSecret,
        });

        await client.ListInstrumentsAsync(CancellationToken.None);
        await client.ListConsentsAsync(subject, CancellationToken.None);
        await client.FindAssignmentByExternalRefAsync(Guid.Parse(Tenant), "attempt-1", CancellationToken.None);

        var sent = _handler.Requests.Where(r => r.Uri != TokenUrl).Select(r => r.Uri).ToList();
        Assert.Equal(
            [
                prefix + "catalog/instruments",
                prefix + $"subjects/{subject}/consents",
                prefix + $"assignments?tenant_id={Tenant}&external_ref=attempt-1",
            ],
            sent);
    }

    [Theory]
    [InlineData("https://suite.test/api", true)]
    [InlineData("https://suite.test/api/", true)]
    [InlineData("https://suite.test", true)]
    [InlineData("http://suite.test/api", false)]
    [InlineData("https://suite.test/api?x=1", false)]
    [InlineData("https://suite.test/api#v1", false)]
    [InlineData("https://user:pw@suite.test/api", false)]
    [InlineData("suite.test/api", false)]
    public void A_base_url_is_an_https_origin_or_base_path_without_credentials_query_or_fragment(string baseUrl, bool valid)
    {
        var options = new AssessmentProviderOptions
        {
            BaseUrl = baseUrl,
            TokenUrl = TokenUrl,
            ClientId = "tims-ats",
            ClientSecret = "client-secret",
            WebhookSigningSecret = "whsec_current",
        };

        Assert.Equal(valid, options.IsValid());
        Assert.Equal(valid, options.IsConfigured);
    }

    [Fact]
    public async Task A_token_endpoint_failure_is_a_transient_token_failure()
    {
        _handler.Respond(_ => new HttpResponseMessage(HttpStatusCode.BadRequest));

        var result = await Client().ListInstrumentsAsync(CancellationToken.None);

        Assert.Equal(ProviderFailure.TokenUnavailable, result.Failure!.Code);
        Assert.True(result.Failure.Transient);
    }

    private static string HostedLaunchJson(Guid id, string delivery = "native", string? token = null, string? frameAncestors = null,
        string mode = "hosted", string? hostedUrl = "https://player.test/launch/code-1") =>
        "{\"assignment_id\":\"" + id + "\",\"delivery\":\"" + delivery + "\",\"mode\":\"" + mode + "\","
        + "\"candidate_token\":" + (token is null ? "null" : "\"" + token + "\"") + ","
        + "\"token_type\":" + (token is null ? "null" : "\"Bearer\"") + ","
        + "\"expires_at\":\"2026-11-09T12:05:00Z\",\"api_base_url\":\"https://suite.test/api\","
        + "\"hosted_url\":" + (hostedUrl is null ? "null" : "\"" + hostedUrl + "\"") + ","
        + "\"frame_ancestors\":" + (frameAncestors ?? (delivery == "native" ? "[\"https://ats.test\"]" : "null")) + "}";

    // D16: every launch is mode hosted; the single-use player URL and the frame ancestors come back, never a token, and
    // the launch code in the URL never prints into a log line.
    [Fact]
    public async Task A_hosted_launch_returns_the_player_url_and_its_frame_ancestors_and_the_url_never_prints()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, HostedLaunchJson(id)));
        var client = Client();

        var launched = await client.LaunchAsync(id, null, CancellationToken.None);
        var mismatched = await client.LaunchAsync(Guid.NewGuid(), null, CancellationToken.None);

        Assert.Equal("https://player.test/launch/code-1", launched.Value!.HostedUrl);
        Assert.Equal(["https://ats.test"], launched.Value.FrameAncestors);
        Assert.DoesNotContain("code-1", launched.Value.ToString(), StringComparison.Ordinal);
        Assert.Equal(ProviderFailure.ContractViolation, mismatched.Failure!.Code);
        Assert.Equal("""{"mode":"hosted"}""", _handler.Requests.Last(r => r.Uri != TokenUrl).Body);
    }

    [Fact]
    public async Task A_link_out_launch_has_no_frame_ancestors()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : Json(HttpStatusCode.OK, HostedLaunchJson(id, "link_out", hostedUrl: "https://pca.test/sit/1")));

        var launched = await Client().LaunchAsync(id, null, CancellationToken.None);

        Assert.Equal(("link_out", "https://pca.test/sit/1"), (launched.Value!.Delivery, launched.Value.HostedUrl));
        Assert.Empty(launched.Value.FrameAncestors);
    }

    // A hosted launch must never hand the host a credential for the sitting; anything else off contract is refused too.
    [Theory]
    [InlineData("token")]
    [InlineData("headless")]
    [InlineData("no_url")]
    [InlineData("http_url")]
    [InlineData("wildcard_origin")]
    [InlineData("origin_with_path")]
    [InlineData("missing_ancestors")]
    public async Task An_off_contract_hosted_launch_is_refused(string defect)
    {
        var id = Guid.NewGuid();
        var json = defect switch
        {
            "token" => HostedLaunchJson(id, token: FakeCandidateToken),
            "headless" => HostedLaunchJson(id, mode: "headless"),
            "no_url" => HostedLaunchJson(id, hostedUrl: null),
            "http_url" => HostedLaunchJson(id, hostedUrl: "http://player.test/launch/code-1"),
            "wildcard_origin" => HostedLaunchJson(id, frameAncestors: "[\"https://*.ats.test\"]"),
            "origin_with_path" => HostedLaunchJson(id, frameAncestors: "[\"https://ats.test/portal\"]"),
            _ => HostedLaunchJson(id, frameAncestors: "null"),
        };
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, json));

        var result = await Client().LaunchAsync(id, null, CancellationToken.None);

        Assert.Equal(ProviderFailure.ContractViolation, result.Failure!.Code);
    }

    // The return_url is the configured portal origin plus a plain absolute path; anything else sends none.
    [Theory]
    [InlineData("https://ats.test", "/careers/invu/dashboard", "https://ats.test/careers/invu/dashboard")]
    [InlineData("https://ats.test/", "/careers/invu/dashboard", "https://ats.test/careers/invu/dashboard")]
    [InlineData(null, "/careers/invu/dashboard", null)]
    [InlineData("https://ats.test", null, null)]
    [InlineData("https://ats.test", "//evil.test/x", null)]
    [InlineData("https://ats.test", "/careers/invu/dashboard?next=https://evil.test", null)]
    [InlineData("https://ats.test", "https://evil.test/x", null)]
    public async Task A_hosted_launch_sends_a_return_url_only_on_the_portal_origin(string? portal, string? path, string? expected)
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, HostedLaunchJson(id)));
        var options = Configured();
        var client = Client(new AssessmentProviderOptions
        {
            BaseUrl = options.BaseUrl,
            TokenUrl = options.TokenUrl,
            ClientId = options.ClientId,
            ClientSecret = options.ClientSecret,
            WebhookSigningSecret = options.WebhookSigningSecret,
            PortalBaseUrl = portal,
        });

        await client.LaunchAsync(id, path, CancellationToken.None);

        var body = JsonNode.Parse(_handler.Requests.Last(r => r.Uri != TokenUrl).Body)!.AsObject();
        Assert.Equal("hosted", body["mode"]!.GetValue<string>());
        Assert.Equal(expected, body["return_url"]?.GetValue<string>());
    }

    [Theory]
    [InlineData("https://ats.test", true)]
    [InlineData("https://ats.test:8443/", true)]
    [InlineData("https://ats.test/portal", false)]
    [InlineData("http://ats.test", false)]
    [InlineData("https://ats.test?x=1", false)]
    public void The_portal_base_url_must_be_an_https_origin(string portal, bool valid)
    {
        var options = new AssessmentProviderOptions { PortalBaseUrl = portal };

        Assert.Equal(valid, options.IsValid());
    }

    [Fact]
    public void Webhook_verification_accepts_the_previous_secret_and_ignores_placeholders()
    {
        var body = Encoding.UTF8.GetBytes("{}");
        var now = _clock.GetUtcNow();
        var previous = WebhookSignature.BuildHeader("whsec_previous", now.ToUnixTimeSeconds(), body);
        var placeholder = WebhookSignature.BuildHeader(AssessmentProviderOptions.TerraformPlaceholder, now.ToUnixTimeSeconds(), body);

        Assert.Equal(WebhookSignatureCheck.Valid, Client(Configured(webhookPrevious: "whsec_previous")).VerifyWebhook(previous, body, now));
        Assert.Equal(WebhookSignatureCheck.Mismatch, Client().VerifyWebhook(previous, body, now));
        Assert.Equal(WebhookSignatureCheck.Mismatch,
            Client(Configured(webhookPrevious: AssessmentProviderOptions.TerraformPlaceholder)).VerifyWebhook(placeholder, body, now));
    }

    private sealed record SentRequest(string Uri, string? Authorization, string? IdempotencyKey, string Body);

    // ---- D11 lookup, subject enrichment, consent withdrawal and erasure -------------------------------------------

    private const string Tenant = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12";

    [Fact]
    public async Task A_lookup_by_external_ref_returns_the_one_assignment_or_none_and_never_another_one()
    {
        var id = Guid.NewGuid();
        var found = AssignmentJson(id).Replace("\"result_id\":null", "\"result_id\":null,\"external_ref\":\"attempt-1\"", StringComparison.Ordinal);
        var page = "{\"data\":[" + found + "],\"next_cursor\":null}";
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, page));
        var client = Client();

        var hit = await client.FindAssignmentByExternalRefAsync(Guid.Parse(Tenant), "attempt-1", CancellationToken.None);
        var other = await client.FindAssignmentByExternalRefAsync(Guid.Parse(Tenant), "attempt-2", CancellationToken.None);
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, """{"data":[],"next_cursor":null}"""));
        var none = await client.FindAssignmentByExternalRefAsync(Guid.Parse(Tenant), "attempt-1", CancellationToken.None);

        Assert.Equal(id, hit.Value!.Assignment!.AssignmentId);
        Assert.Equal($"https://assessments.test/v1/assignments?tenant_id={Tenant}&external_ref=attempt-1",
            _handler.Requests.First(r => r.Uri != TokenUrl).Uri);
        Assert.False(other.Ok); // the page named another external_ref: off contract, never taken as ours
        Assert.Equal(ProviderFailure.ContractViolation, other.Failure!.Code);
        Assert.Null(none.Value!.Assignment);
    }

    [Fact]
    public async Task Subject_enrichment_patches_names_and_email_without_an_idempotency_key()
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        HttpMethod? method = null;
        _handler.Respond(r =>
        {
            if (r.RequestUri!.ToString() == TokenUrl)
            {
                return Token();
            }

            method = r.Method;
            return Json(HttpStatusCode.OK, $$"""{"subject_id":"{{subject}}","tenant_id":"{{Tenant}}","external_ref":"c-1","status":"active","given_name":"Ana","family_name":"Pérez","email":"ana@example.com","created_at":"2026-11-09T12:00:00Z"}""");
        });

        var result = await Client().UpdateSubjectAsync(subject, new ProviderSubjectUpdate("Ana", "Pérez", "ana@example.com"), CancellationToken.None);

        Assert.True(result.Value!.HasNamesAndEmail);
        Assert.Equal(HttpMethod.Patch, method);
        var sent = _handler.Requests.Single(r => r.Uri != TokenUrl);
        Assert.Equal($"https://assessments.test/v1/subjects/{subject}", sent.Uri);
        Assert.Null(sent.IdempotencyKey);
        Assert.Equal("Ana", JsonNode.Parse(sent.Body)!["given_name"]!.GetValue<string>());
    }

    [Fact]
    public async Task Erasure_deletes_the_subject_and_a_consent_withdrawal_posts_its_timestamp()
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        var consent = Guid.NewGuid();
        var methods = new List<HttpMethod>();
        _handler.Respond(r =>
        {
            if (r.RequestUri!.ToString() == TokenUrl)
            {
                return Token();
            }

            methods.Add(r.Method);
            return r.Method == HttpMethod.Delete
                ? Json(HttpStatusCode.Accepted, $$"""{"erasure_id":"{{Guid.NewGuid()}}","subject_id":"{{subject}}","status":"accepted","requested_at":"2026-11-09T12:00:00Z"}""")
                : Json(HttpStatusCode.OK, $$"""{"consent_id":"{{consent}}","subject_id":"{{subject}}","tenant_id":"{{Tenant}}","purpose":"assessment","text_version":"v1","locale":"es","status":"withdrawn","granted_at":"2026-11-09T12:00:00Z","recorded_at":"2026-11-09T12:00:00Z","withdrawn_at":"2026-11-09T12:00:00Z","capture_method":"host_ui"}""");
        });
        var client = Client();

        var erased = await client.EraseSubjectAsync(subject, CancellationToken.None);
        var withdrawn = await client.WithdrawConsentAsync(subject, consent, _clock.GetUtcNow(), CancellationToken.None);

        Assert.Equal("accepted", erased.Value!.Status);
        Assert.Equal("withdrawn", withdrawn.Value!.Status);
        Assert.Equal([HttpMethod.Delete, HttpMethod.Post], methods);
        var sent = _handler.Requests.Where(r => r.Uri != TokenUrl).ToList();
        Assert.Equal($"https://assessments.test/v1/subjects/{subject}/consents/{consent}/withdrawal", sent[1].Uri);
        Assert.Equal("2026-11-09T12:00:00Z", JsonNode.Parse(sent[1].Body)!["withdrawn_at"]!.GetValue<string>());
    }

    private static HttpResponseMessage NotFound() =>
        Json(HttpStatusCode.NotFound, """{"type":"about:blank","title":"Not found","status":404,"code":"not_found"}""",
            "application/problem+json");

    // Round-8 cross-repo check: a provider that does not serve POST /v1/assignments/{id}/cancel answers its catch-all
    // 404 not_found, and every caller reads a 404 as "already gone" and clears its cleanup marker. The client confirms a
    // 404 with GET /v1/assignments/{id} before it returns one.
    [Fact]
    public async Task A_cancel_404_is_returned_only_when_the_lookup_confirms_the_assignment_is_gone()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : NotFound());

        var result = await Client().CancelAssignmentAsync(id, CancellationToken.None);

        Assert.Equal(404, result.Failure!.HttpStatus);
        Assert.Equal(
            [$"https://assessments.test/v1/assignments/{id}/cancel", $"https://assessments.test/v1/assignments/{id}"],
            _handler.Requests.Where(r => r.Uri != TokenUrl).Select(r => r.Uri).ToList());
    }

    [Theory]
    [InlineData(HttpStatusCode.OK)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    public async Task A_cancel_404_for_an_assignment_the_provider_still_serves_is_unconfirmed_and_transient(HttpStatusCode lookup)
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.RequestUri!.AbsolutePath.EndsWith("/cancel", StringComparison.Ordinal) ? NotFound()
            : lookup == HttpStatusCode.OK ? Json(HttpStatusCode.OK, AssignmentJson(id))
            : new HttpResponseMessage(lookup));

        var result = await Client().CancelAssignmentAsync(id, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Null(result.Failure!.HttpStatus); // never read as "already gone" by a caller
        Assert.Equal(ProviderFailure.NotFoundUnconfirmed, result.Failure.Code);
        Assert.True(result.Failure.Transient);
    }

    [Fact]
    public async Task A_cancel_404_for_an_assignment_already_cancelled_is_the_success_the_route_would_give()
    {
        var id = Guid.NewGuid();
        var cancelledJson = AssignmentJson(id).Replace("\"status\":\"created\"", "\"status\":\"cancelled\"", StringComparison.Ordinal);
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.RequestUri!.AbsolutePath.EndsWith("/cancel", StringComparison.Ordinal) ? NotFound()
            : Json(HttpStatusCode.OK, cancelledJson));

        var result = await Client().CancelAssignmentAsync(id, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("cancelled", result.Value!.Status);
    }

    [Fact]
    public async Task A_cancel_that_succeeds_or_fails_otherwise_makes_no_lookup()
    {
        var id = Guid.NewGuid();
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK,
            AssignmentJson(id).Replace("\"status\":\"created\"", "\"status\":\"cancelled\"", StringComparison.Ordinal)));
        var client = Client();

        Assert.True((await client.CancelAssignmentAsync(id, CancellationToken.None)).Ok);
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : Json(HttpStatusCode.Conflict, """{"type":"about:blank","title":"Conflict","status":409,"code":"assignment_completed"}""", "application/problem+json"));
        Assert.Equal(409, (await client.CancelAssignmentAsync(id, CancellationToken.None)).Failure!.HttpStatus);

        Assert.DoesNotContain(_handler.Requests, r => r.Uri == $"https://assessments.test/v1/assignments/{id}");
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, 404, null)]
    [InlineData(HttpStatusCode.Gone, 410, null)]
    [InlineData(HttpStatusCode.OK, null, ProviderFailure.NotFoundUnconfirmed)]
    [InlineData(HttpStatusCode.BadGateway, null, ProviderFailure.NotFoundUnconfirmed)]
    public async Task An_erasure_404_is_confirmed_by_the_subject_lookup(HttpStatusCode lookup, int? expectedStatus, string? expectedCode)
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.Method == HttpMethod.Delete ? NotFound()
            : lookup == HttpStatusCode.OK
                ? Json(HttpStatusCode.OK, $$"""{"subject_id":"{{subject}}","tenant_id":"{{Tenant}}","external_ref":"c-1","status":"active","created_at":"2026-11-09T12:00:00Z"}""")
            : lookup == HttpStatusCode.Gone
                ? Json(HttpStatusCode.Gone, """{"type":"about:blank","title":"Gone","status":410,"code":"subject_erased"}""", "application/problem+json")
            : lookup == HttpStatusCode.NotFound ? NotFound()
            : new HttpResponseMessage(lookup));

        var result = await Client().EraseSubjectAsync(subject, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(expectedStatus, result.Failure!.HttpStatus);
        if (expectedCode is not null)
        {
            Assert.Equal(expectedCode, result.Failure.Code);
            Assert.True(result.Failure.Transient);
        }

        Assert.Equal($"https://assessments.test/v1/subjects/{subject}", _handler.Requests.Last(r => r.Uri != TokenUrl).Uri);
    }

    private static string ConsentJson(Guid consent, string status) =>
        $$"""{"consent_id":"{{consent}}","subject_id":"7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d","tenant_id":"{{Tenant}}","purpose":"assessment","text_version":"v1","locale":"es","status":"{{status}}","granted_at":"2026-11-09T12:00:00Z","recorded_at":"2026-11-09T12:00:00Z","withdrawn_at":null,"capture_method":"host_ui"}""";

    // Codex release review, round 1 [P1]: the #312 cascade read a consent-list 404 as "no consent" and a withdrawal
    // 404 as "nothing left", so a provider without those routes left active consents while the attempt was marked done.
    [Theory]
    [InlineData(HttpStatusCode.NotFound, 404, null)]
    [InlineData(HttpStatusCode.Gone, 410, null)]
    [InlineData(HttpStatusCode.OK, null, ProviderFailure.NotFoundUnconfirmed)]
    [InlineData(HttpStatusCode.ServiceUnavailable, null, ProviderFailure.NotFoundUnconfirmed)]
    public async Task A_consent_list_404_is_confirmed_by_the_subject_lookup(HttpStatusCode lookup, int? expectedStatus, string? expectedCode)
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.RequestUri!.AbsolutePath.EndsWith("/consents", StringComparison.Ordinal) ? NotFound()
            : lookup == HttpStatusCode.OK
                ? Json(HttpStatusCode.OK, $$"""{"subject_id":"{{subject}}","tenant_id":"{{Tenant}}","external_ref":"c-1","status":"active","created_at":"2026-11-09T12:00:00Z"}""")
            : lookup == HttpStatusCode.Gone
                ? Json(HttpStatusCode.Gone, """{"type":"about:blank","title":"Gone","status":410,"code":"subject_erased"}""", "application/problem+json")
            : lookup == HttpStatusCode.NotFound ? NotFound()
            : new HttpResponseMessage(lookup));

        var result = await Client().ListConsentsAsync(subject, CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(expectedStatus, result.Failure!.HttpStatus);
        if (expectedCode is not null)
        {
            Assert.Equal(expectedCode, result.Failure.Code);
            Assert.True(result.Failure.Transient);
        }

        Assert.Equal($"https://assessments.test/v1/subjects/{subject}", _handler.Requests.Last(r => r.Uri != TokenUrl).Uri);
    }

    [Theory]
    [InlineData("active", false, null)]       // the route is missing: the consent is still active
    [InlineData("withdrawn", true, null)]     // already withdrawn: the success the route would give
    [InlineData(null, false, 404)]            // the subject no longer holds it: a confirmed 404
    public async Task A_consent_withdrawal_404_is_confirmed_by_listing_the_subjects_consents(string? listedStatus, bool ok, int? status)
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        var consent = Guid.NewGuid();
        var page = listedStatus is null
            ? """{"data":[],"next_cursor":null}"""
            : "{\"data\":[" + ConsentJson(consent, listedStatus) + "],\"next_cursor\":null}";
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.Method == HttpMethod.Post ? NotFound()
            : Json(HttpStatusCode.OK, page));

        var result = await Client().WithdrawConsentAsync(subject, consent, _clock.GetUtcNow(), CancellationToken.None);

        Assert.Equal(ok, result.Ok);
        if (ok)
        {
            Assert.Equal("withdrawn", result.Value!.Status);
        }
        else if (status is null)
        {
            Assert.Null(result.Failure!.HttpStatus);
            Assert.Equal(ProviderFailure.NotFoundUnconfirmed, result.Failure.Code);
        }
        else
        {
            Assert.Equal(status, result.Failure!.HttpStatus);
        }

        Assert.Equal($"https://assessments.test/v1/subjects/{subject}/consents", _handler.Requests.Last(r => r.Uri != TokenUrl).Uri);
    }

    [Fact]
    public async Task A_consent_withdrawal_404_whose_list_is_also_unconfirmed_stays_unconfirmed()
    {
        var subject = Guid.Parse("7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d");
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : r.RequestUri!.AbsolutePath == $"/v1/subjects/{subject}"
                ? Json(HttpStatusCode.OK, $$"""{"subject_id":"{{subject}}","tenant_id":"{{Tenant}}","external_ref":"c-1","status":"active","created_at":"2026-11-09T12:00:00Z"}""")
            : NotFound());

        var result = await Client().WithdrawConsentAsync(subject, Guid.NewGuid(), _clock.GetUtcNow(), CancellationToken.None);

        Assert.Null(result.Failure!.HttpStatus);
        Assert.Equal(ProviderFailure.NotFoundUnconfirmed, result.Failure.Code);
    }

    // The amended contract (Idempotency): a request that arrives while an earlier one with the same Idempotency-Key and
    // body is still being processed is refused with 409 idempotency_key_in_use and Retry-After, and nothing is done for
    // it; a retry with the same key and body after the delay gets the original response.
    private static HttpResponseMessage InUse(string? retryAfter)
    {
        var response = Json(HttpStatusCode.Conflict,
            """{"type":"about:blank","title":"Conflict","status":409,"code":"idempotency_key_in_use"}""", "application/problem+json");
        if (retryAfter is not null)
        {
            response.Headers.TryAddWithoutValidation("Retry-After", retryAfter);
        }

        return response;
    }

    [Theory]
    [InlineData("0")]
    [InlineData(null)] // no Retry-After: waited out for the 1 s default
    public async Task An_idempotency_key_in_use_is_waited_out_once_and_resent_with_the_same_key_and_body(string? retryAfter)
    {
        var id = Guid.NewGuid();
        var posts = 0;
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token()
            : ++posts == 1 ? InUse(retryAfter) : Json(HttpStatusCode.Created, AssignmentJson(id)));

        var result = await Client().CreateAssignmentAsync(AssignmentRequest(), "ats-attempt-1", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(id, result.Value!.AssignmentId);
        var sent = _handler.Requests.Where(r => r.Uri != TokenUrl).ToList();
        Assert.Equal(2, sent.Count);
        Assert.All(sent, r => Assert.Equal("ats-attempt-1", r.IdempotencyKey));
        Assert.Equal(sent[0].Body, sent[1].Body);
    }

    [Fact]
    public async Task An_idempotency_key_in_use_with_a_long_retry_after_is_a_transient_failure_carrying_the_delay()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : InUse("30"));

        var result = await Client().CreateAssignmentAsync(AssignmentRequest(), "ats-attempt-1", CancellationToken.None);

        Assert.False(result.Ok);
        Assert.Equal(409, result.Failure!.HttpStatus);
        Assert.Equal(ProviderFailure.IdempotencyKeyInUse, result.Failure.Code);
        Assert.True(result.Failure.Transient);
        Assert.False(result.Failure.IsDefinitiveRefusal);
        Assert.Equal(TimeSpan.FromSeconds(30), result.Failure.RetryAfter);
        Assert.Single(_handler.Requests, r => r.Uri != TokenUrl);
    }

    [Fact]
    public async Task A_second_idempotency_key_in_use_is_returned_not_retried_again()
    {
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : InUse("0"));

        var result = await Client().EnsureSubjectAsync(
            new ProviderSubjectRequest(Guid.Parse(Tenant), "c-1", null, null, null, null), "subject-key", CancellationToken.None);

        Assert.Equal(ProviderFailure.IdempotencyKeyInUse, result.Failure!.Code);
        Assert.True(result.Failure.Transient);
        Assert.Equal(2, _handler.Requests.Count(r => r.Uri != TokenUrl));
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private Func<HttpRequestMessage, HttpResponseMessage> _respond = _ => new HttpResponseMessage(HttpStatusCode.NotFound);

        public List<SentRequest> Requests { get; } = [];

        public void Respond(Func<HttpRequestMessage, HttpResponseMessage> respond) => _respond = respond;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add(new SentRequest(
                request.RequestUri!.ToString(),
                request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null,
                body));
            return _respond(request);
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan by) => _now += by;
    }
}
