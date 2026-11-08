using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>AS-5 staff cancel: provider first, never a finished sitting, idempotent, audited by the repository.</summary>
public sealed class CancelProviderAttemptUseCaseTests
{
    private static readonly Guid Actor = Guid.Parse("d0000000-0000-4000-8000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 13, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<ProviderCancelResult> Cancel(AttemptRow attempt) =>
        new CancelProviderAttemptUseCase(_repository, _provider).CancelAsync(FakeRepository.Org, Actor, attempt, Now, CancellationToken.None);

    private AttemptRow State(Guid id) => _repository.Attempts.Single(a => a.Id == id);

    [Theory]
    [InlineData(ProviderAttemptStates.Created)]
    [InlineData(ProviderAttemptStates.Launched)]
    [InlineData(ProviderAttemptStates.InProgress)]
    public async Task An_unfinished_attempt_is_cancelled_at_the_provider_first_then_here(string state)
    {
        var attempt = _repository.AddCreatedAttempt("lia", state);

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal(ProviderAttemptStates.Cancelled, result.Item!.State);
        Assert.Equal([attempt.ProviderAssignmentId!.Value], _provider.Cancelled);
        Assert.Equal(["staff_cancel:provider"], _repository.Writes);
        Assert.Equal(ProviderAttemptStates.Cancelled, State(attempt.Id).State);
    }

    [Fact]
    public async Task A_pending_attempt_has_nothing_at_the_provider_yet_and_is_cancelled_here()
    {
        var reserved = await _repository.ReserveAttemptsAsync(FakeRepository.Org, Actor, _repository.Binding!, FakeRepository.Candidate,
            FakeRepository.Vacancy, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)], Now, CancellationToken.None);
        var pending = Assert.Single(reserved.Attempts);

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Empty(_provider.Calls);
        Assert.Contains("staff_cancel:local", _repository.Writes);
    }

    [Fact]
    public async Task A_create_answered_between_the_read_and_the_local_cancel_is_cancelled_at_the_provider_first()
    {
        // HR read the attempt while it was pending_create; the assign request then attached the provider's ids and
        // returned. The local cancel must not land over that live assignment: it is cancelled at the provider first.
        var reserved = await _repository.ReserveAttemptsAsync(FakeRepository.Org, Actor, _repository.Binding!, FakeRepository.Candidate,
            FakeRepository.Vacancy, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)], Now, CancellationToken.None);
        var pending = Assert.Single(reserved.Attempts);
        var mapped = Guid.NewGuid();
        _repository.BeforeNextMarkCancelled = id => _repository.MapAttempt(id, mapped);

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal([mapped], _provider.Cancelled);
        Assert.Equal(["reserve", "staff_cancel:provider"], _repository.Writes);
        Assert.Equal(ProviderAttemptStates.Cancelled, State(pending.Id).State);
    }

    [Theory]
    [InlineData(ProviderAttemptStates.Completed)]
    [InlineData(ProviderAttemptStates.ResultReady)]
    [InlineData(ProviderAttemptStates.Voided)]
    [InlineData(ProviderAttemptStates.Expired)]
    public async Task A_finished_or_terminal_attempt_is_not_cancellable_and_nothing_is_sent(string state)
    {
        var attempt = _repository.AddCreatedAttempt("lia", state);

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.NotCancellable, result.Outcome);
        Assert.Equal(state, result.Detail);
        Assert.Empty(_provider.Calls);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task Cancelling_twice_answers_the_same_and_sends_nothing_more()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Cancelled);

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Empty(_provider.Calls);
        Assert.Empty(_repository.Writes);
    }

    [Fact]
    public async Task A_provider_outage_changes_nothing_here()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnCancelAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.ProviderUnavailable, result.Outcome);
        Assert.Empty(_repository.Writes);
        Assert.Equal(ProviderAttemptStates.Created, State(attempt.Id).State);
    }

    [Theory]
    [InlineData(409, "assignment_not_cancellable", ProviderCancelOutcome.NotCancellable)]
    [InlineData(403, "forbidden", ProviderCancelOutcome.ProviderRefused)]
    public async Task A_provider_refusal_changes_nothing_here(int status, string code, ProviderCancelOutcome expected)
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        _provider.OnCancelAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(status, code, false, []));

        var result = await Cancel(attempt);

        Assert.Equal(expected, result.Outcome);
        Assert.Equal(code, result.Detail);
        Assert.Empty(_repository.Writes);
    }

    [Theory]
    [InlineData(404)]
    [InlineData(410)]
    public async Task An_assignment_the_provider_no_longer_holds_is_cancelled_here(int status)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.OnCancelAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(status, "not_found", false, []));

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal(["staff_cancel:local"], _repository.Writes);
    }

    [Fact]
    public async Task An_unconfigured_provider_refuses_before_any_write()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _provider.IsConfigured = false;

        Assert.Equal(ProviderCancelOutcome.ProviderUnconfigured, (await Cancel(attempt)).Outcome);
        Assert.Empty(_repository.Writes);
    }
}
