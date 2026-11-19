using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// The portal's fast path for a link-out completion (production 2026-11-19: the PCA frame stayed open for minutes after
/// the candidate finished, because the ATS waited for the provider's 10-minute webhook cron or the D17 poller). Listing
/// the candidate's attempts refreshes their launched or in-progress PCA sittings from the provider first, through the
/// poller's own single-attempt step, under a rate-limited lease, inside a hard time bound that never fails the list.
/// </summary>
public sealed class ProviderPortalRefreshTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 19, 2, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new() { ApplyAdvances = true };
    private readonly FakeProvider _provider = new();

    private Task<PortalList> List(TimeSpan? budget = null) =>
        new ProviderPortalUseCase(_repository, _provider, budget).ListAsync("invu", "ana@example.com", Now, CancellationToken.None);

    private ProviderCall<ProviderAssignment> AssignmentOf(AttemptRow attempt, string status) =>
        ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            attempt.ProviderAssignmentId!.Value, _repository.Binding!.ProviderTenantId, attempt.ProviderSubjectId!.Value,
            attempt.Instrument, "1.0", "content-1", status, ["assessment"], [], Now.AddDays(10), attempt.Id.ToString(), null,
            Now.AddMinutes(-3), status == "completed" ? Now.AddSeconds(-20) : null));

    [Theory]
    [InlineData(ProviderAttemptStates.Launched)]
    [InlineData(ProviderAttemptStates.InProgress)]
    public async Task A_pca_sitting_the_provider_reports_completed_lists_as_completed_on_the_same_call(string state)
    {
        var pca = _repository.AddCreatedAttempt("pca", state);
        _provider.OnGetAssignment = _ => AssignmentOf(pca, "completed");

        var list = await List();

        Assert.Equal(ProviderPortalStatuses.Completed, Assert.Single(list.Attempts).Status);
        Assert.Contains("advance:completed", _repository.Writes);
        // The lease is released (stamping last_polled_at, the rate-limit clock) and nothing is left leased.
        Assert.Equal(pca.Id, Assert.Single(_repository.Released).AttemptId);
        Assert.Empty(_repository.Leases);
    }

    [Fact]
    public async Task An_attempt_polled_within_the_interval_is_not_asked_again()
    {
        var pca = _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _repository.RecentlyPolled.Add(pca.Id);
        _provider.OnGetAssignment = _ => AssignmentOf(pca, "completed");

        var list = await List();

        Assert.Equal(ProviderPortalStatuses.InProgress, Assert.Single(list.Attempts).Status);
        Assert.DoesNotContain("get_assignment", _provider.Calls);
        Assert.Empty(_repository.Released);
    }

    [Fact]
    public async Task Two_lists_back_to_back_ask_the_provider_once()
    {
        var pca = _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _provider.OnGetAssignment = _ => AssignmentOf(pca, "in_progress");

        await List();
        await List();

        Assert.Equal(1, _provider.Calls.Count(c => c == "get_assignment"));
        Assert.Equal(2, _repository.PortalRefreshClaims.Count); // the second claim was refused by the rate limit
    }

    [Fact]
    public async Task An_attempt_the_poller_holds_is_skipped()
    {
        var pca = _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _repository.Leases[pca.Id] = Guid.NewGuid();
        _provider.OnGetAssignment = _ => AssignmentOf(pca, "completed");

        var list = await List();

        Assert.Equal(ProviderPortalStatuses.InProgress, Assert.Single(list.Attempts).Status);
        Assert.DoesNotContain("get_assignment", _provider.Calls);
        Assert.Single(_repository.Leases); // the poller's lease is untouched
    }

    [Fact]
    public async Task A_failing_provider_returns_the_last_known_state_and_still_releases()
    {
        var pca = _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _provider.OnGetAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));

        var list = await List();

        Assert.Equal(PortalOutcome.Ok, list.Outcome);
        Assert.Equal(ProviderPortalStatuses.InProgress, Assert.Single(list.Attempts).Status);
        Assert.Equal(pca.Id, Assert.Single(_repository.Released).AttemptId);
    }

    [Fact]
    public async Task A_provider_that_throws_or_a_claim_that_fails_never_fails_the_list()
    {
        _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _repository.PortalRefreshClaimThrows = true;

        var list = await List();

        Assert.Equal(ProviderPortalStatuses.InProgress, Assert.Single(list.Attempts).Status);
    }

    [Fact]
    public async Task A_hanging_provider_is_cut_off_at_the_budget_and_the_last_state_is_listed()
    {
        var pca = _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _provider.OnGetAssignmentAsync = async (_, cancellationToken) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            return AssignmentOf(pca, "completed");
        };

        var clock = System.Diagnostics.Stopwatch.StartNew();
        var list = await List(TimeSpan.FromMilliseconds(200));

        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5), $"took {clock.Elapsed}");
        Assert.Equal(ProviderPortalStatuses.InProgress, Assert.Single(list.Attempts).Status);
        Assert.DoesNotContain("advance:completed", _repository.Writes);
        // Released all the same, so the hanging provider is asked again only after the interval.
        Assert.Equal(pca.Id, Assert.Single(_repository.Released).AttemptId);
    }

    [Theory]
    [InlineData("lia", ProviderAttemptStates.InProgress)]      // native: its own player reports progress
    [InlineData("english", ProviderAttemptStates.Launched)]
    [InlineData("pca", ProviderAttemptStates.Created)]         // never opened
    [InlineData("pca", ProviderAttemptStates.Completed)]       // already reads completed
    public async Task Native_instruments_and_pca_attempts_nobody_is_sitting_are_never_refreshed(string instrument, string state)
    {
        var attempt = _repository.AddCreatedAttempt(instrument, state);
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "completed");

        await List();

        Assert.Empty(_repository.PortalRefreshClaims);
        Assert.DoesNotContain("get_assignment", _provider.Calls);
    }

    [Fact]
    public async Task A_launched_pca_attempt_past_its_start_deadline_is_not_refreshed()
    {
        _repository.AddCreatedAttempt("pca", ProviderAttemptStates.Launched, Now.AddMinutes(-1));

        await List();

        Assert.Empty(_repository.PortalRefreshClaims);
    }

    [Fact]
    public async Task An_unconfigured_provider_lists_without_refreshing()
    {
        _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _provider.IsConfigured = false;

        var list = await List();

        Assert.Single(list.Attempts);
        Assert.Empty(_repository.PortalRefreshClaims);
    }

    [Fact]
    public async Task Another_candidates_attempt_is_never_refreshed()
    {
        _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);

        var list = await new ProviderPortalUseCase(_repository, _provider)
            .ListAsync("invu", "someone@example.com", Now, CancellationToken.None);

        Assert.Empty(list.Attempts);
        Assert.Empty(_repository.PortalRefreshClaims);
    }
}
