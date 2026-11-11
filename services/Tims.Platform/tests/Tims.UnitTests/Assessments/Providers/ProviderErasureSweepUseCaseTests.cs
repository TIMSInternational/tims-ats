using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Codex r13 P1: the erasure sweep asks the provider about every subject that still holds stored results (no revision
/// window) and applies the webhook's local erasure only when getSubject confirms it.
/// </summary>
public sealed class ProviderErasureSweepUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 11, 15, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Previous = new(2026, 11, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<ErasureSweep> Run(ProviderErasureSweepSettings? settings = null) =>
        new ProviderErasureSweepUseCase(_repository, _provider, settings ?? ProviderErasureSweepSettings.Default)
            .RunAsync(Now, CancellationToken.None);

    private AttemptRow Due(string state = ProviderAttemptStates.ResultReady, DateTimeOffset? lastChecked = null)
    {
        var attempt = _repository.AddCreatedAttempt("lia", state);
        _repository.DueSubjects.Add(new SubjectErasureCheck(FakeRepository.Org, attempt.ProviderSubjectId!.Value, lastChecked));
        return attempt;
    }

    [Fact]
    public void The_documented_defaults_are_seven_days_and_two_hundred_subjects()
    {
        Assert.Equal(TimeSpan.FromDays(7), ProviderErasureSweepSettings.Default.CheckInterval);
        Assert.Equal(200, ProviderErasureSweepSettings.Default.MaxSubjectsPerRun);
    }

    [Theory]
    [InlineData("410")]
    [InlineData("erased")]
    [InlineData("erasure_pending")]
    public async Task A_confirmed_erasure_runs_the_local_erasure_via_the_sweep(string answer)
    {
        var attempt = Due();
        _provider.OnGetSubject = id => answer == "410"
            ? ProviderCall<ProviderSubject>.Fail(new ProviderFailure(410, "subject_erased", false, []))
            : ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, answer));

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(1, 1, 0), outcome);
        Assert.Equal(attempt.ProviderSubjectId, Assert.Single(_repository.LocallyErasedSubjects));
        Assert.Equal("sweep", Assert.Single(_repository.EraseVia));
        Assert.Equal(ProviderAttemptStates.Erased, _repository.Attempts.Single().State);
        Assert.Empty(_repository.ReleasedChecks);
        Assert.DoesNotContain("get_assignment", _provider.Calls); // the sweep never needs the assignment
    }

    [Theory]
    [InlineData("active")]
    [InlineData("404")]
    [InlineData("410_other")]
    [InlineData("403")]
    [InlineData("other_subject")]
    public async Task A_definitive_answer_that_is_not_an_erasure_keeps_the_scores_and_the_stamp(string answer)
    {
        Due(lastChecked: Previous);
        _provider.OnGetSubject = id => answer switch
        {
            "active" => ProviderCall<ProviderSubject>.Success(new ProviderSubject(id, "active")),
            "404" => ProviderCall<ProviderSubject>.Fail(new ProviderFailure(404, "not_found", false, [])),
            "410_other" => ProviderCall<ProviderSubject>.Fail(new ProviderFailure(410, "assignment_expired", false, [])),
            "403" => ProviderCall<ProviderSubject>.Fail(new ProviderFailure(403, "forbidden", false, [])),
            _ => ProviderCall<ProviderSubject>.Success(new ProviderSubject(Guid.NewGuid(), "erased")),
        };

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(1, 0, 0), outcome);
        Assert.Empty(_repository.LocallyErasedSubjects);
        Assert.Empty(_repository.ReleasedChecks); // asked again only after the interval
        Assert.Equal(ProviderAttemptStates.ResultReady, _repository.Attempts.Single().State);
    }

    [Theory]
    [InlineData(503, ProviderFailure.Unavailable)]
    [InlineData(null, ProviderFailure.TokenUnavailable)]
    public async Task An_inconclusive_lookup_gives_the_claim_back_so_the_next_run_asks_again(int? status, string code)
    {
        var attempt = Due(lastChecked: Previous);
        _provider.OnGetSubject = _ => ProviderCall<ProviderSubject>.Fail(new ProviderFailure(status, code, true, []));

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(1, 0, 1), outcome);
        Assert.Empty(_repository.LocallyErasedSubjects);
        Assert.Equal((attempt.ProviderSubjectId!.Value, FakeRepository.ClaimStamp, (DateTimeOffset?)Previous),
            Assert.Single(_repository.ReleasedChecks));
    }

    [Fact]
    public async Task One_failing_subject_never_stops_the_others()
    {
        var first = Due();
        var second = Due();
        _provider.OnGetSubject = id => id == first.ProviderSubjectId
            ? throw new InvalidOperationException("boom")
            : ProviderCall<ProviderSubject>.Fail(new ProviderFailure(410, "subject_erased", false, []));

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(2, 1, 1), outcome);
        Assert.Equal(second.ProviderSubjectId, Assert.Single(_repository.LocallyErasedSubjects));
        Assert.Equal(first.ProviderSubjectId, Assert.Single(_repository.ReleasedChecks).Subject);
    }

    [Fact]
    public async Task A_subject_another_instance_claimed_is_not_asked_about()
    {
        var attempt = Due();
        _repository.ClaimedElsewhere.Add(attempt.ProviderSubjectId!.Value);

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(0, 0, 0), outcome);
        Assert.Empty(_provider.Calls);
    }

    [Fact]
    public async Task The_configured_interval_and_cap_reach_the_listing()
    {
        Due();
        Due();
        Due();

        var outcome = await Run(new ProviderErasureSweepSettings(TimeSpan.FromDays(3), 2));

        Assert.Equal((TimeSpan.FromDays(3), 2), _repository.ListedWith);
        Assert.Equal(2, outcome.Checked);
    }

    [Fact]
    public async Task An_unconfigured_provider_claims_nothing()
    {
        Due();
        _provider.IsConfigured = false;

        var outcome = await Run();

        Assert.Equal(new ErasureSweep(0, 0, 0), outcome);
        Assert.Null(_repository.ListedWith);
        Assert.Empty(_repository.ClaimedChecks);
    }
}
