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
        return new TimsAssessmentsClient(new HttpClient(_handler), cache, wrapped, NullLogger<TimsAssessmentsClient>.Instance);
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
        Assert.Contains("scope=catalog%3Aread+assignments%3Awrite+results%3Aread", tokenRequest.Body);
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

        var result = await Client().LaunchAsync(Guid.NewGuid(), CancellationToken.None);

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

    [Fact]
    public async Task A_token_endpoint_failure_is_a_transient_token_failure()
    {
        _handler.Respond(_ => new HttpResponseMessage(HttpStatusCode.BadRequest));

        var result = await Client().ListInstrumentsAsync(CancellationToken.None);

        Assert.Equal(ProviderFailure.TokenUnavailable, result.Failure!.Code);
        Assert.True(result.Failure.Transient);
    }

    [Fact]
    public async Task A_launch_must_name_the_requested_assignment_and_its_token_never_prints()
    {
        var id = Guid.NewGuid();
        var launchJson = $$"""{"assignment_id":"{{id}}","delivery":"native","candidate_token":"{{FakeCandidateToken}}","token_type":"Bearer","expires_at":"2026-11-09T16:00:00Z","api_base_url":"https://assessments.test","hosted_url":null}""";
        _handler.Respond(r => r.RequestUri!.ToString() == TokenUrl ? Token() : Json(HttpStatusCode.OK, launchJson));
        var client = Client();

        var launched = await client.LaunchAsync(id, CancellationToken.None);
        var mismatched = await client.LaunchAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(FakeCandidateToken, launched.Value!.CandidateToken);
        Assert.DoesNotContain(FakeCandidateToken, launched.Value.ToString(), StringComparison.Ordinal);
        Assert.Equal(ProviderFailure.ContractViolation, mismatched.Failure!.Code);
        Assert.Equal("""{"mode":"headless"}""", _handler.Requests.Last(r => r.Uri != TokenUrl).Body);
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
