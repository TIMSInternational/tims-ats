using System.Text;
using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Round-13 fixes at the use-case level (the SQL is pinned in Tims.IntegrationTests/Assessments/AssessmentProviderRound12Tests):
/// <list type="bullet">
/// <item>Codex r12 P1: an unbound binding that retains results keeps accepting the events that erase or invalidate them
/// (<see cref="ProviderEventTypes.RetainedDataEvents"/>); every other event for it stays refused.</item>
/// <item>Codex r12 P2: a launch ends its consent-capture fence in the SAME locked write that records its optional
/// decisions, so another tab can never act on a cleared fence while the grant is not on record yet.</item>
/// </list>
/// </summary>
public sealed class ProviderRound13Tests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 38, 10, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private static (byte[] Body, Guid EventId) Envelope(string type, JsonObject data)
    {
        var id = Guid.NewGuid();
        var envelope = new JsonObject
        {
            ["event_id"] = id.ToString(),
            ["event_type"] = type,
            ["event_version"] = 1,
            ["occurred_at"] = "2026-11-09T14:38:06Z",
            ["producer"] = "tims-assessments",
            ["tenant_id"] = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12",
            ["data"] = data,
        };
        return (Encoding.UTF8.GetBytes(envelope.ToJsonString()), id);
    }

    private Task<WebhookResult> Receive(string type, JsonObject data)
    {
        var (body, eventId) = Envelope(type, data);
        return new ProviderWebhookUseCase(_repository, _provider).HandleAsync(
            body, WebhookSignature.BuildHeader(FakeProvider.Secret, Now.ToUnixTimeSeconds(), body),
            eventId.ToString(), type, 1, Now, CancellationToken.None);
    }

    private Task<InboxProcessing> Process(string type, JsonObject data)
    {
        var (body, _) = Envelope(type, data);
        Assert.True(ProviderWebhookUseCase.TryParseEnvelope(body, out var envelope, out _));
        return new ProviderInboxProcessor(_repository, _provider).ProcessAsync(FakeRepository.Org, envelope!, Now, CancellationToken.None);
    }

    private Task<LaunchResult> Launch(Guid attemptId, IReadOnlyList<CapturedConsent> consents) =>
        new LaunchProviderAttemptUseCase(_repository, _provider).LaunchAsync(
            attemptId, "ana@example.com", consents, Now, CancellationToken.None, notice: LaunchProviderAttemptUseCaseTests.Notice);

    // ── 1. Privacy and invalidation events after an unbind ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ProviderEventTypes.SubjectErased)]
    [InlineData(ProviderEventTypes.ResultReady)]
    [InlineData(ProviderEventTypes.SessionVoided)]
    [InlineData(ProviderEventTypes.AssignmentVoided)]
    public async Task An_unbound_binding_still_queues_the_events_that_erase_or_invalidate_retained_results(string type)
    {
        _repository.BindingInactive = true;

        var result = await Receive(type, new JsonObject { ["subject_id"] = Guid.NewGuid().ToString(), ["assignment_id"] = Guid.NewGuid().ToString() });

        Assert.Equal(WebhookOutcome.Queued, result.Outcome);
        Assert.Single(_repository.InboxRows);
    }

    [Theory]
    [InlineData(ProviderEventTypes.AssignmentStarted)]
    [InlineData(ProviderEventTypes.SessionCompleted)]
    [InlineData(ProviderEventTypes.AssignmentExpired)]
    public async Task An_unbound_binding_refuses_every_other_event(string type)
    {
        _repository.BindingInactive = true;

        var result = await Receive(type, new JsonObject { ["assignment_id"] = Guid.NewGuid().ToString() });

        Assert.Equal(new WebhookResult(WebhookOutcome.Ignored, "binding_inactive"), result);
        Assert.Empty(_repository.InboxRows);
    }

    [Fact]
    public async Task A_subject_erased_after_an_unbind_erases_the_retained_scores()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady);
        _repository.BindingInactive = true;

        var processed = await Process(ProviderEventTypes.SubjectErased,
            new JsonObject { ["subject_id"] = attempt.ProviderSubjectId!.Value.ToString() });

        Assert.Equal(InboxStatuses.Processed, processed.Status);
        Assert.Equal(ProviderAttemptStates.Erased, _repository.Attempts.Single().State);
    }

    [Fact]
    public async Task After_an_unbind_a_lifecycle_event_already_queued_is_not_applied()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady);
        _repository.BindingInactive = true;

        var processed = await Process(ProviderEventTypes.AssignmentExpired,
            new JsonObject { ["assignment_id"] = attempt.ProviderAssignmentId!.Value.ToString() });

        Assert.Equal(new InboxProcessing(InboxStatuses.Ignored, "binding_inactive", false), processed);
        Assert.Equal(ProviderAttemptStates.ResultReady, _repository.Attempts.Single().State);
    }

    [Fact]
    public async Task After_an_unbind_an_unknown_assignment_is_never_reconciled()
    {
        _repository.BindingInactive = true;

        var processed = await Process(ProviderEventTypes.ResultReady,
            new JsonObject { ["assignment_id"] = Guid.NewGuid().ToString(), ["result_id"] = Guid.NewGuid().ToString() });

        Assert.Equal(new InboxProcessing(InboxStatuses.Ignored, "unknown_assignment", false), processed);
        Assert.DoesNotContain(_provider.Calls, c => c.StartsWith("get_assignment", StringComparison.Ordinal));
    }

    [Fact]
    public async Task After_an_unbind_a_result_is_applied_only_as_a_revision_of_one_already_retained()
    {
        // No stored result to revise (a voided sitting): a result.ready would ADD scores after the unbind, so it is refused.
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Voided);
        _repository.BindingInactive = true;

        var processed = await Process(ProviderEventTypes.ResultReady,
            new JsonObject { ["assignment_id"] = attempt.ProviderAssignmentId!.Value.ToString(), ["result_id"] = Guid.NewGuid().ToString() });

        Assert.Equal(new InboxProcessing(InboxStatuses.Ignored, "binding_inactive", false), processed);
        Assert.Empty(_repository.StoredResults);
    }

    // ── 2. The capture fence ends together with the recorded decision ──────────────────────────────────────────────

    [Fact]
    public async Task Another_tab_acting_once_a_capture_fence_is_cleared_sees_that_launchs_grant_on_record()
    {
        // Codex r12 P2: tab B captures voice and clears its fence; tab A then enforces the EXISTING decline (withdrawing
        // B's voice consent) and launches; B then recorded "granted" and launched without restoring it. With the fence
        // ended in the same locked write as the decision, A already sees B's grant: the recorded decision and the
        // provider's consent agree whichever order the two tabs run in.
        var attempt = _repository.AddCreatedAttempt("english") with { DeclinedOptionalConsents = [ConsentPurposes.Voice] };
        _repository.Attempts[0] = attempt;
        _repository.DbNow = Now;
        var subject = attempt.ProviderSubjectId!.Value;
        LaunchResult? tabA = null;
        _repository.AfterConsentCaptureEnded = () => tabA = Launch(attempt.Id, []).GetAwaiter().GetResult();

        var tabB = await Launch(attempt.Id, [new CapturedConsent(ConsentPurposes.Voice, "voice-v2026-11-cr", "es")]);

        Assert.Equal(LaunchOutcome.Launched, tabA!.Outcome);
        Assert.Equal(LaunchOutcome.Launched, tabB.Outcome);
        var final = _repository.Attempts.Single();
        var voiceActive = _provider.SubjectConsents[subject].Any(c => c.Purpose == ConsentPurposes.Voice && c.Status == "active");
        Assert.True(voiceActive);
        Assert.Contains(ConsentPurposes.Voice, final.GrantedOptionalConsents!);
        Assert.DoesNotContain(ConsentPurposes.Voice, final.DeclinedOptionalConsents!);
        Assert.Empty(_provider.WithdrawnConsents);
    }
}
