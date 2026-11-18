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
    public async Task A_pending_attempt_the_provider_confirms_it_never_created_is_cancelled_here()
    {
        var pending = await ReservePending();

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal(["lookup"], _provider.Calls);
        Assert.Contains("staff_cancel:local", _repository.Writes);
        Assert.Null(State(pending.Id).LastErrorCode);
    }

    [Fact]
    public async Task A_lost_create_response_is_found_by_lookup_and_that_assignment_is_cancelled_at_the_provider()
    {
        // Codex ATS P1: the create reached the provider but its answer was lost, so the attempt has no ids. A local-only
        // cancel would strand a live assignment the ATS no longer tracks.
        var pending = await ReservePending();
        var assignment = LandedCreate(pending);

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal([assignment.AssignmentId], _provider.Cancelled);
        Assert.Equal(["reserve", "created", "staff_cancel:provider"], _repository.Writes);
        Assert.Equal(ProviderAttemptStates.Cancelled, State(pending.Id).State);
        Assert.Equal(assignment.AssignmentId, State(pending.Id).ProviderAssignmentId);
        Assert.Null(State(pending.Id).LastErrorCode);
    }

    [Fact]
    public async Task A_failed_lookup_cancels_here_but_keeps_the_cancel_pending_and_the_unbind_refused()
    {
        var pending = await ReservePending();
        _provider.OnLookup = _ => ProviderCall<ProviderAssignmentLookup>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Contains("staff_cancel:unconfirmed", _repository.Writes);
        var row = State(pending.Id);
        Assert.Equal(ProviderAttemptStates.Cancelled, row.State);
        Assert.Null(row.ProviderAssignmentId);
        Assert.Equal(ProviderCleanup.CancelPending, row.LastErrorCode);
        Assert.True(ProviderCleanup.IsCancelUnconfirmed(row));

        var unbind = await new ProviderBindingAdminUseCase(_repository, new CancelProviderAttemptUseCase(_repository, _provider))
            .UnbindAsync(FakeRepository.Org, Actor, cancelOpenAttempts: false, Now, CancellationToken.None);
        Assert.Equal(ProviderUnbindOutcome.Blocked, unbind.Outcome);
        Assert.Equal(1, unbind.OpenWork.CancelPending);
        Assert.DoesNotContain("binding_unset", _repository.Writes);
    }

    [Fact]
    public async Task An_empty_lookup_while_a_create_is_still_in_flight_is_not_conclusive()
    {
        var pending = await ReservePending();
        _repository.CreateFences[pending.Id] = [_repository.DbNow];

        var result = await Cancel(pending);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.True(ProviderCleanup.IsCancelUnconfirmed(State(pending.Id)));
    }

    [Fact]
    public async Task Retrying_an_unconfirmed_cancel_finds_the_landed_create_and_cancels_it_at_the_provider()
    {
        var pending = await ReservePending();
        _provider.OnLookup = _ => ProviderCall<ProviderAssignmentLookup>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        await Cancel(pending);
        _provider.OnLookup = null;
        var assignment = LandedCreate(pending);

        var retry = await Cancel(State(pending.Id));

        Assert.Equal(ProviderCancelOutcome.Cancelled, retry.Outcome);
        Assert.Equal([assignment.AssignmentId], _provider.Cancelled);
        var row = State(pending.Id);
        Assert.Equal(assignment.AssignmentId, row.ProviderAssignmentId);
        Assert.Null(row.LastErrorCode);
    }

    [Fact]
    public async Task Retrying_an_unconfirmed_cancel_whose_lookup_still_fails_reports_the_outage()
    {
        var pending = await ReservePending();
        _provider.OnLookup = _ => ProviderCall<ProviderAssignmentLookup>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        await Cancel(pending);

        var retry = await Cancel(State(pending.Id));

        Assert.Equal(ProviderCancelOutcome.ProviderUnavailable, retry.Outcome);
        Assert.True(ProviderCleanup.IsCancelUnconfirmed(State(pending.Id)));
    }

    private async Task<AttemptRow> ReservePending()
    {
        var reserved = await _repository.ReserveAttemptsAsync(FakeRepository.Org, Actor, _repository.Binding!, FakeRepository.Candidate,
            FakeRepository.Vacancy, [new NewAttempt("lia", "Análisis de datos", "es", 1m, [], null)], Now, CancellationToken.None);
        return Assert.Single(reserved.Attempts) with { IsNew = false };
    }

    // What the provider holds for an attempt whose create landed while the answer never reached the ATS.
    private ProviderAssignment LandedCreate(AttemptRow attempt)
    {
        var assignment = new ProviderAssignment(Guid.NewGuid(), _repository.Binding!.ProviderTenantId, Guid.NewGuid(),
            attempt.Instrument, "1.0", "content-1", "created", ["assessment"], [], Now.AddDays(7), attempt.Id.ToString());
        _provider.ByExternalRef[attempt.Id.ToString()] = assignment;
        return assignment;
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

    [Fact]
    public async Task The_providers_void_of_this_cancel_landing_first_still_ends_cancelled_not_needs_review()
    {
        // Cancelling an in-progress sitting voids it at the provider (administrative_void), and its assignment.voided
        // webhook can commit between the provider's 200 and the local write (seen in the cross-system e2e).
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.InProgress);
        _repository.BeforeNextMarkCancelled = id => _repository.SetState(id, ProviderAttemptStates.Voided);

        var result = await Cancel(attempt);

        Assert.Equal(ProviderCancelOutcome.Cancelled, result.Outcome);
        Assert.Equal(ProviderAttemptStates.Cancelled, result.Item!.State);
        Assert.Equal(["staff_cancel:provider"], _repository.Writes);
        Assert.Equal(ProviderAttemptStates.Cancelled, State(attempt.Id).State);
    }

    [Fact]
    public async Task A_void_with_a_stored_result_is_never_overwritten_by_a_cancel()
    {
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.InProgress);
        _repository.BeforeNextMarkCancelled = id => _repository.SetState(id, ProviderAttemptStates.Voided, Guid.NewGuid());

        await Cancel(attempt);

        Assert.Equal(ProviderAttemptStates.Voided, State(attempt.Id).State);
        Assert.Empty(_repository.Writes);
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
