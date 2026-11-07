using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>AS-5 inbound webhooks: signature first, replay window, header binding, de-duplication, then apply.</summary>
public sealed class ProviderWebhookUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 38, 10, TimeSpan.Zero);
    private const string TenantId = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12";

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private static (byte[] Body, Guid EventId) Envelope(string type, JsonObject data, Guid? eventId = null)
    {
        var id = eventId ?? Guid.NewGuid();
        var envelope = new JsonObject
        {
            ["event_id"] = id.ToString(),
            ["event_type"] = type,
            ["event_version"] = 1,
            ["occurred_at"] = "2026-11-09T14:38:06Z",
            ["producer"] = "tims-assessments",
            ["tenant_id"] = TenantId,
            ["data"] = data,
        };
        return (Encoding.UTF8.GetBytes(envelope.ToJsonString()), id);
    }

    private Task<WebhookResult> Deliver(byte[] body, Guid eventId, string type, long? signedAt = null, string? signature = null) =>
        new ProviderWebhookUseCase(_repository, _provider).HandleAsync(
            body,
            signature ?? WebhookSignature.BuildHeader(FakeProvider.Secret, signedAt ?? Now.ToUnixTimeSeconds(), body),
            eventId.ToString(), type, 1, Now, CancellationToken.None);

    private AttemptRow Attempt() => _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);

    private static JsonObject ResultReadyData(AttemptRow attempt, Guid resultId) => new()
    {
        ["result_id"] = resultId.ToString(),
        ["result_revision"] = 1,
        ["result_schema"] = "LiaResultV1",
        ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
        ["subject_id"] = "7a2b9c3d-1e4f-4a5b-8c6d-9e0f1a2b3c4d",
        ["instrument"] = "lia",
        ["validity_status"] = "valid",
        ["content_version"] = "content-1",
        ["norm_version"] = "norms-1",
        ["published_at"] = "2026-11-09T14:38:05Z",
    };

    private ParsedProviderResult FetchedResult(AttemptRow attempt, Guid resultId, Action<JsonObject>? change = null)
    {
        var json = ProviderResultParserTests.Result("lia", "LiaResultV1", ProviderResultParserTests.LiaScores("full", 46.2),
            ProviderResultParserTests.Summary());
        json["result_id"] = resultId.ToString();
        json["assignment_id"] = attempt.ProviderAssignmentId.ToString();
        json["vacancy"]!["external_vacancy_ref"] = attempt.VacancyId.ToString();
        change?.Invoke(json);
        return ProviderResultParserTests.Parse(json);
    }

    [Fact]
    public async Task A_signed_result_ready_fetches_the_tenant_hr_result_and_stores_it_once()
    {
        var attempt = Attempt();
        var resultId = Guid.NewGuid();
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(FetchedResult(attempt, id));
        var (body, eventId) = Envelope("result.ready", ResultReadyData(attempt, resultId));

        var first = await Deliver(body, eventId, "result.ready");
        var redelivery = await Deliver(body, eventId, "result.ready");

        Assert.Equal(WebhookOutcome.Accepted, first.Outcome);
        Assert.Equal(WebhookOutcome.Duplicate, redelivery.Outcome); // at-least-once: de-duplicated on the event id
        Assert.Equal(46.2, Assert.Single(_repository.StoredResults).GlobalPercentile);
        Assert.Equal(["result"], _provider.Calls);
        Assert.Equal(InboxStatuses.Processed, _repository.Inbox[eventId]);
    }

    [Fact]
    public async Task A_replay_outside_the_window_is_rejected_before_anything_is_read_or_written()
    {
        var attempt = Attempt();
        var (body, eventId) = Envelope("session.voided", new JsonObject { ["assignment_id"] = attempt.ProviderAssignmentId.ToString() });

        var result = await Deliver(body, eventId, "session.voided", signedAt: Now.ToUnixTimeSeconds() - 301);

        Assert.Equal(WebhookOutcome.Rejected, result.Outcome);
        Assert.Equal("signature_outsidereplaywindow", result.Reason);
        Assert.Empty(_repository.Inbox);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task A_bad_signature_is_rejected_and_never_parsed()
    {
        var (body, eventId) = Envelope("subject.erased", new JsonObject { ["subject_id"] = Guid.NewGuid().ToString() });
        var forged = WebhookSignature.BuildHeader("not-the-secret", Now.ToUnixTimeSeconds(), body);

        var result = await Deliver(body, eventId, "subject.erased", signature: forged);

        Assert.Equal(WebhookOutcome.Rejected, result.Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task Headers_that_disagree_with_the_signed_body_are_rejected()
    {
        var (body, _) = Envelope("subject.erased", new JsonObject { ["subject_id"] = Guid.NewGuid().ToString() });

        var wrongId = await Deliver(body, Guid.NewGuid(), "subject.erased");
        var wrongType = await new ProviderWebhookUseCase(_repository, _provider).HandleAsync(
            body, WebhookSignature.BuildHeader(FakeProvider.Secret, Now.ToUnixTimeSeconds(), body),
            JsonDocument.Parse(body).RootElement.GetProperty("event_id").GetString(), "result.ready", 1, Now, CancellationToken.None);

        Assert.Equal(WebhookOutcome.Rejected, wrongId.Outcome);
        Assert.Equal(WebhookOutcome.Rejected, wrongType.Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task An_unbound_tenant_and_an_unknown_event_type_are_acknowledged_and_ignored()
    {
        var (body, eventId) = Envelope("assignment.paused", new JsonObject());
        Assert.Equal(WebhookOutcome.Ignored, (await Deliver(body, eventId, "assignment.paused")).Outcome);

        _repository.OrganizationForTenant = null;
        var (erased, erasedId) = Envelope("subject.erased", new JsonObject { ["subject_id"] = Guid.NewGuid().ToString() });
        Assert.Equal(WebhookOutcome.Ignored, (await Deliver(erased, erasedId, "subject.erased")).Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task A_result_for_another_tenant_vacancy_or_assignment_is_not_stored()
    {
        var attempt = Attempt();
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(
            FetchedResult(attempt, id, json => json["vacancy"]!["external_vacancy_ref"] = "some-other-vacancy"));
        var (body, eventId) = Envelope("result.ready", ResultReadyData(attempt, Guid.NewGuid()));

        var result = await Deliver(body, eventId, "result.ready");

        Assert.Equal(WebhookOutcome.Accepted, result.Outcome);
        Assert.Equal("result_mismatch", result.Reason);
        Assert.Empty(_repository.StoredResults);
        Assert.Equal(InboxStatuses.Failed, _repository.Inbox[eventId]);
    }

    [Fact]
    public async Task A_provider_outage_while_fetching_answers_503_and_the_redelivery_is_processed()
    {
        var attempt = Attempt();
        var (body, eventId) = Envelope("result.ready", ResultReadyData(attempt, Guid.NewGuid()));

        var first = await Deliver(body, eventId, "result.ready"); // the fake's default GetResult is an outage
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(FetchedResult(attempt, id));
        var retry = await Deliver(body, eventId, "result.ready");

        Assert.Equal(WebhookOutcome.RetryLater, first.Outcome);
        Assert.Equal(WebhookOutcome.Accepted, retry.Outcome);
        Assert.Single(_repository.StoredResults);
    }

    [Fact]
    public async Task An_event_for_an_assignment_created_just_before_a_crash_is_reconciled_not_lost()
    {
        // The provider created the assignment, then the ATS crashed before storing its id: the attempt is still
        // pending_create. The provider's copy names the attempt in external_ref, so the mapping is restored.
        var reserved = await _repository.ReserveAttemptsAsync(FakeRepository.Org, Guid.NewGuid(), _repository.Binding!,
            FakeRepository.Candidate, FakeRepository.Vacancy, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)],
            Now, CancellationToken.None);
        var pending = Assert.Single(reserved.Attempts);
        var providerAssignment = Guid.NewGuid();
        _provider.OnGetAssignment = id => ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            id, _provider.TenantId, _provider.SubjectId, "lia", "1.0", "content-1", "expired", ["assessment"], [],
            Now, pending.Id.ToString()));
        var (body, eventId) = Envelope("assignment.expired", new JsonObject { ["assignment_id"] = providerAssignment.ToString() });

        var result = await Deliver(body, eventId, "assignment.expired");

        Assert.Equal(WebhookOutcome.Accepted, result.Outcome);
        Assert.Equal(["reserve", "created", "advance:expired"], _repository.Writes);
        Assert.Equal(providerAssignment, _repository.Attempts.Single().ProviderAssignmentId);
    }

    [Fact]
    public async Task A_provider_outage_during_reconciliation_keeps_the_event_retryable()
    {
        _provider.OnGetAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        var (body, eventId) = Envelope("assignment.expired", new JsonObject { ["assignment_id"] = Guid.NewGuid().ToString() });

        var result = await Deliver(body, eventId, "assignment.expired");

        Assert.Equal(WebhookOutcome.RetryLater, result.Outcome);
        Assert.Equal(InboxStatuses.Failed, _repository.Inbox[eventId]); // a redelivery is processed, not "duplicate"
    }

    [Fact]
    public async Task An_assignment_that_names_no_pending_attempt_of_ours_is_ignored()
    {
        _provider.OnGetAssignment = id => ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            id, _provider.TenantId, _provider.SubjectId, "lia", "1.0", "content-1", "created", ["assessment"], [], Now,
            "another-hosts-ref"));
        var (body, eventId) = Envelope("assignment.started", new JsonObject { ["assignment_id"] = Guid.NewGuid().ToString() });

        var result = await Deliver(body, eventId, "assignment.started");

        Assert.Equal(WebhookOutcome.Ignored, result.Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task With_no_signing_secret_configured_the_sender_is_told_to_retry_not_to_give_up()
    {
        _provider.WebhookSecrets = [];
        var (body, eventId) = Envelope("subject.erased", new JsonObject { ["subject_id"] = Guid.NewGuid().ToString() });

        var result = await Deliver(body, eventId, "subject.erased");

        Assert.Equal(WebhookOutcome.RetryLater, result.Outcome);
        Assert.Empty(_repository.Writes);
    }

    [Theory]
    [InlineData("assignment.started", "in_progress")]
    [InlineData("session.completed", "completed")]
    [InlineData("session.voided", "voided")]
    [InlineData("assignment.expired", "expired")]
    public async Task Lifecycle_events_advance_the_attempt(string type, string state)
    {
        var attempt = Attempt();
        var (body, eventId) = Envelope(type, new JsonObject { ["assignment_id"] = attempt.ProviderAssignmentId.ToString() });

        Assert.Equal(WebhookOutcome.Accepted, (await Deliver(body, eventId, type)).Outcome);
        Assert.Equal(["advance:" + state], _repository.Writes);
    }

    [Fact]
    public async Task Subject_erased_cascades_to_the_stored_results()
    {
        var (body, eventId) = Envelope("subject.erased", new JsonObject { ["subject_id"] = Guid.NewGuid().ToString() });

        Assert.Equal(WebhookOutcome.Accepted, (await Deliver(body, eventId, "subject.erased")).Outcome);
        Assert.Equal(["erase"], _repository.Writes);
    }

    [Theory]
    [InlineData("""{"event_id":"c0ffee00-4444-4555-8666-777788889999","event_type":"result.ready","event_version":2,"occurred_at":"2026-11-09T14:38:06Z","producer":"tims-assessments","tenant_id":"3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12","data":{}}""")]
    [InlineData("""{"event_id":"c0ffee00-4444-4555-8666-777788889999","event_type":"result.ready","event_version":1,"occurred_at":"2026-11-09T14:38:06Z","producer":"someone-else","tenant_id":"3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12","data":{}}""")]
    [InlineData("""{"event_id":"c0ffee00-4444-4555-8666-777788889999","event_type":"result.ready","event_version":1,"occurred_at":"2026-11-09T14:38:06Z","producer":"tims-assessments","tenant_id":"3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12","data":[]}""")]
    [InlineData("""[1,2,3]""")]
    public async Task A_signed_but_off_contract_envelope_is_rejected(string json)
    {
        var body = Encoding.UTF8.GetBytes(json);

        var result = await Deliver(body, Guid.Parse("c0ffee00-4444-4555-8666-777788889999"), "result.ready");

        Assert.Equal(WebhookOutcome.Rejected, result.Outcome);
        Assert.Empty(_repository.Inbox);
    }
}
