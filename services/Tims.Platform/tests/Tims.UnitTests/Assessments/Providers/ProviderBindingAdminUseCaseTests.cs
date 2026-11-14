using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Round 12: the platform owner's safe unbind. It never strands provider work: refused while any remains, and with the
/// confirmation (cancelOpenAttempts) it cancels the unfinished sittings at the provider first and unbinds only if
/// nothing is left. After it, no assignment can be reserved. Every DSAR erasure run is audited.
/// </summary>
public sealed class ProviderBindingAdminUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 16, 0, 0, TimeSpan.Zero);
    private static readonly Guid Owner = Guid.Parse("0e0e0e0e-0000-4000-8000-00000000000a");

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ProviderBindingAdminUseCase UseCase => new(_repository, new CancelProviderAttemptUseCase(_repository, _provider));

    [Fact]
    public async Task An_unbind_with_an_open_sitting_is_refused_and_changes_nothing()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);

        var result = await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: false, Now, CancellationToken.None);

        Assert.Equal(ProviderUnbindOutcome.Blocked, result.Outcome);
        Assert.Equal(1, result.OpenWork.Cancellable);
        Assert.False(_repository.BindingInactive);
        Assert.Empty(_provider.Calls);
        Assert.Equal(ProviderAttemptStates.InProgress, _repository.Attempts.Single().State);
    }

    [Fact]
    public async Task The_confirmed_unbind_cancels_the_open_sittings_at_the_provider_first_then_unbinds()
    {
        var open = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        _repository.AddCreatedAttempt("english", ProviderAttemptStates.ResultReady); // finished: kept as it is

        var result = await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: true, Now, CancellationToken.None);

        Assert.Equal(ProviderUnbindOutcome.Unbound, result.Outcome);
        Assert.Equal(1, result.Cancelled);
        Assert.Equal([open.ProviderAssignmentId!.Value], _provider.Cancelled);
        Assert.True(_repository.BindingInactive);
        Assert.Contains("binding_unset", _repository.Writes);
        Assert.Equal(ProviderAttemptStates.ResultReady, _repository.Attempts.Single(a => a.Id != open.Id).State);
    }

    [Fact]
    public async Task A_sitting_awaiting_its_result_blocks_even_the_confirmed_unbind()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);

        var result = await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: true, Now, CancellationToken.None);

        Assert.Equal(ProviderUnbindOutcome.Blocked, result.Outcome);
        Assert.Equal(1, result.OpenWork.AwaitingResult);
        Assert.False(_repository.BindingInactive);
    }

    [Fact]
    public async Task A_cancel_the_provider_refuses_leaves_the_binding_in_force()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        _provider.OnCancelAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var result = await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: true, Now, CancellationToken.None);

        Assert.Equal(ProviderUnbindOutcome.Blocked, result.Outcome);
        Assert.Equal(1, result.CancelFailed);
        Assert.False(_repository.BindingInactive);
    }

    [Fact]
    public async Task After_an_unbind_no_assignment_is_reserved()
    {
        await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: false, Now, CancellationToken.None);
        Assert.True(_repository.BindingInactive);

        var assign = await new AssignProviderInstrumentsUseCase(_repository, _provider).AssignAsync(
            FakeRepository.Org, Guid.NewGuid(),
            new AssignProviderInstrumentsInput(FakeRepository.Candidate, FakeRepository.Vacancy,
                [new AssignInstrumentItem("lia", null)], null, 1m, [], null, ProviderAgeBands.Adult),
            Now, CancellationToken.None);

        Assert.Equal(ProviderAssignOutcome.NotEnabled, assign.Outcome);
        Assert.Empty(_repository.Attempts);
        Assert.DoesNotContain("subject", _provider.Calls);
    }

    [Fact]
    public async Task An_org_without_a_binding_in_force_is_not_bound()
    {
        _repository.Binding = null;

        var result = await UseCase.UnbindAsync(FakeRepository.Org, Owner, cancelOpenAttempts: true, Now, CancellationToken.None);

        Assert.Equal(ProviderUnbindOutcome.NotBound, result.Outcome);
    }

    [Fact]
    public async Task Every_erasure_run_is_audited_with_its_outcome()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady);

        var result = await new ProviderSubjectRightsUseCase(_repository, _provider)
            .EraseAsync(FakeRepository.Org, FakeRepository.Candidate, Owner, Now, CancellationToken.None);

        var run = Assert.Single(_repository.ErasureRuns);
        Assert.Equal((FakeRepository.Candidate, result.Outcome.ToString(), result.Subjects, result.Requested), run);
    }

    [Theory]
    [InlineData(null, true, false)]
    [InlineData("{}", true, false)]
    [InlineData("""{"cancelOpenAttempts":true}""", true, true)]
    [InlineData("""{"cancelOpenAttempts":false}""", true, false)]
    [InlineData("""{"cancelOpenAttempts":"yes"}""", false, false)]
    [InlineData("""{"cancelOpenAttempts":true,"force":true}""", false, false)]
    [InlineData("[]", false, false)]
    public void The_unbind_body_is_strict(string? json, bool ok, bool cancel)
    {
        var parsed = ProviderBindingAdminUseCase.TryParseUnbindBody(json is null ? null : JsonNode.Parse(json), out var flag);

        Assert.Equal(ok, parsed);
        Assert.Equal(cancel, flag);
    }
}
