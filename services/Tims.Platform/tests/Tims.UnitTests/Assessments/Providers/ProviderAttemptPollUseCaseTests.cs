using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// D17 polling fallback: a stale attempt is re-read with getAssignment and its result with getResult, through the same
/// guarded writes a webhook uses, under a lease that is always released.
/// </summary>
public sealed class ProviderAttemptPollUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 15, 0, 0, TimeSpan.Zero);
    private static readonly Guid Owner = Guid.Parse("0e0e0e0e-0000-4000-8000-000000000001");

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private Task<AttemptPoll> Run(TimeSpan? maxPollDuration = null) =>
        new ProviderAttemptPollUseCase(_repository, _provider, maxPollDuration).RunAsync(Owner, Now, CancellationToken.None);

    private ProviderCall<ProviderAssignment> AssignmentOf(
        AttemptRow attempt, string status, Guid? resultId = null, IReadOnlyList<string>? missing = null, Guid? tenant = null,
        string? externalRef = null) =>
        ProviderCall<ProviderAssignment>.Success(new ProviderAssignment(
            attempt.ProviderAssignmentId!.Value, tenant ?? _repository.Binding!.ProviderTenantId, attempt.ProviderSubjectId!.Value,
            attempt.Instrument, "1.0", "content-1", status, ["assessment"], missing ?? [], Now.AddDays(10),
            externalRef ?? attempt.Id.ToString(), resultId, Now.AddMinutes(-40), status == "completed" ? Now.AddMinutes(-5) : null));

    private ParsedProviderResult ResultFor(AttemptRow attempt, Guid resultId, int revision = 1, string validity = "valid")
    {
        var json = ProviderResultParserTests.Result("lia", "LiaResultV1", ProviderResultParserTests.LiaScores("full", 46.2),
            ProviderResultParserTests.Summary(), validity, validity == "valid" ? null : ["administrative_void"]);
        json["result_id"] = resultId.ToString();
        json["result_revision"] = revision;
        json["assignment_id"] = attempt.ProviderAssignmentId.ToString();
        json["subject_id"] = attempt.ProviderSubjectId.ToString();
        json["vacancy"]!["external_vacancy_ref"] = attempt.VacancyId.ToString();
        return ProviderResultParserTests.Parse(json);
    }

    [Fact]
    public async Task A_sitting_the_provider_started_moves_the_attempt_to_in_progress_without_a_webhook()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "in_progress");

        var outcome = await Run();

        Assert.Equal((1, 1, 1, 0), (outcome.Organizations, outcome.Polled, outcome.Changed, outcome.Failed));
        Assert.Contains("advance:in_progress", _repository.Writes);
        Assert.DoesNotContain("result", _provider.Calls);
    }

    [Fact]
    public async Task A_completed_assignment_with_a_result_fetches_and_stores_it_through_the_guarded_write()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        var resultId = Guid.NewGuid();
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "completed", resultId);
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(ResultFor(attempt, id));

        await Run();

        Assert.Contains("advance:completed", _repository.Writes);
        Assert.Contains("result:1", _repository.Writes);
        Assert.Equal(resultId, Assert.Single(_repository.StoredResults).ResultId);
    }

    // A later void is published as a new result revision (D12): re-reading a result_ready attempt picks it up.
    [Fact]
    public async Task A_result_ready_attempt_is_re_read_and_a_newer_revision_is_handed_to_the_store()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.ResultReady);
        var resultId = Guid.NewGuid();
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "completed", resultId);
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(ResultFor(attempt, id, revision: 2, validity: "voided"));

        await Run();

        var stored = Assert.Single(_repository.StoredResults);
        Assert.Equal((2, "voided"), (stored.ResultRevision, stored.ValidityStatus));
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("advance:", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_result_from_another_tenant_is_never_stored()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var resultId = Guid.NewGuid();
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "completed", resultId);
        _provider.OnGetResult = id =>
        {
            var json = ProviderResultParserTests.Result("lia", "LiaResultV1", ProviderResultParserTests.LiaScores("full", 46.2),
                ProviderResultParserTests.Summary());
            json["result_id"] = id.ToString();
            json["tenant_id"] = Guid.NewGuid().ToString();
            json["assignment_id"] = attempt.ProviderAssignmentId.ToString();
            json["subject_id"] = attempt.ProviderSubjectId.ToString();
            json["vacancy"]!["external_vacancy_ref"] = attempt.VacancyId.ToString();
            return ProviderCall<ParsedProviderResult>.Success(ProviderResultParserTests.Parse(json));
        };

        await Run();

        Assert.Empty(_repository.StoredResults);
    }

    [Theory]
    [InlineData("tenant")]
    [InlineData("external_ref")]
    public async Task An_assignment_that_is_not_this_attempts_is_never_applied(string mismatch)
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        _provider.OnGetAssignment = _ => mismatch == "tenant"
            ? AssignmentOf(attempt, "voided", tenant: Guid.NewGuid())
            : AssignmentOf(attempt, "voided", externalRef: Guid.NewGuid().ToString());

        var outcome = await Run();

        Assert.Equal(0, outcome.Changed);
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("advance:", StringComparison.Ordinal));
    }

    [Fact]
    public async Task The_consents_the_provider_still_lacks_are_recorded_for_the_portal()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "created", missing: ["voice", "assessment", "not_a_purpose"]);

        await Run();

        Assert.Contains("missing:assessment,voice", _repository.Writes);
        Assert.Equal(["assessment", "voice"], _repository.Attempts.Single().MissingConsents);
    }

    // Never a 404 read as a state: neither a confirmed nor an unconfirmed one changes the attempt.
    [Theory]
    [InlineData(404, "not_found", false)]
    [InlineData(null, ProviderFailure.NotFoundUnconfirmed, true)]
    [InlineData(503, ProviderFailure.Unavailable, true)]
    public async Task A_failed_assignment_read_changes_nothing_and_still_releases_the_lease(int? status, string code, bool transient)
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);
        _provider.OnGetAssignment = _ => ProviderCall<ProviderAssignment>.Fail(new ProviderFailure(status, code, transient, []));

        var outcome = await Run();

        Assert.Equal((1, 0), (outcome.Polled, outcome.Changed));
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("advance:", StringComparison.Ordinal));
        Assert.Equal((attempt.Id, Owner), Assert.Single(_repository.Released));
        Assert.Empty(_repository.Leases);
    }

    [Fact]
    public async Task One_failing_attempt_never_stops_the_others_and_every_lease_is_released()
    {
        var first = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        var second = _repository.AddCreatedAttempt("english", ProviderAttemptStates.Launched);
        _provider.OnGetAssignment = id => id == first.ProviderAssignmentId
            ? throw new InvalidOperationException("boom")
            : AssignmentOf(second, "in_progress");

        var outcome = await Run();

        Assert.Equal((2, 1, 1), (outcome.Polled, outcome.Changed, outcome.Failed));
        Assert.Equal(2, _repository.Released.Count);
        Assert.Empty(_repository.Leases);
    }

    // Codex release round A1 [P2]: leasing a batch up front let later leases run out while earlier attempts were still
    // being polled, so another instance could claim them. One claim at a time, each released before the next claim.
    [Fact]
    public async Task Attempts_are_claimed_one_at_a_time_and_each_is_released_before_the_next_claim()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        _repository.AddCreatedAttempt("english", ProviderAttemptStates.Launched);
        _repository.AddCreatedAttempt("mi", ProviderAttemptStates.Launched);
        _provider.OnGetAssignment = id => AssignmentOf(_repository.Attempts.Single(a => a.ProviderAssignmentId == id), "in_progress");

        var outcome = await Run();

        Assert.Equal(3, outcome.Polled);
        var leaseLog = _repository.Writes.Where(w => w.StartsWith("claim", StringComparison.Ordinal) || w == "released").ToList();
        Assert.Equal(
            ["claim:max=1", "claimed:1", "released", "claim:max=1", "claimed:1", "released", "claim:max=1", "claimed:1", "released",
             "claim:max=1", "claimed:0"],
            leaseLog);
    }

    // The work under one lease is capped well inside the lease, so the lease never runs out while its owner still works.
    [Fact]
    public async Task A_poll_past_its_time_cap_is_cancelled_counted_failed_and_released()
    {
        var slow = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        var quick = _repository.AddCreatedAttempt("english", ProviderAttemptStates.Launched);
        _provider.OnGetAssignmentAsync = async (id, ct) =>
        {
            if (id == slow.ProviderAssignmentId)
            {
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }

            return AssignmentOf(id == slow.ProviderAssignmentId ? slow : quick, "in_progress");
        };

        var outcome = await Run(TimeSpan.FromMilliseconds(100));

        Assert.Equal((2, 1, 1), (outcome.Polled, outcome.Changed, outcome.Failed));
        Assert.Equal([slow.Id, quick.Id], _repository.Released.Select(r => r.AttemptId));
        Assert.True(ProviderAttemptPolling.MaxPollDuration * 2 <= ProviderAttemptPolling.LeaseDuration);
    }

    // Codex release round A1 [P2]: a voided revision moves the attempt to voided; a later corrected revision (staff
    // overturned the void) must still be found without its webhook.
    [Fact]
    public async Task A_voided_attempt_holding_a_result_is_re_read_and_a_corrected_revision_is_stored()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Voided);
        _repository.WithStoredResult.Add(attempt.Id);
        _repository.AddCreatedAttempt("english", ProviderAttemptStates.Voided); // voided before any result: nothing to re-read
        var resultId = Guid.NewGuid();
        _provider.OnGetAssignment = id => AssignmentOf(_repository.Attempts.Single(a => a.ProviderAssignmentId == id), "completed", resultId);
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(ResultFor(attempt, id, revision: 3));

        var outcome = await Run();

        Assert.Equal(1, outcome.Polled);
        var stored = Assert.Single(_repository.StoredResults);
        Assert.Equal((3, "valid"), (stored.ResultRevision, stored.ValidityStatus));
    }

    // Round 11 (Codex r11 run 2, P2): a voided assignment advertising a result whose first fetch fails transiently is
    // not voided yet (a voided attempt with no stored result is never polled again), and the next pass stores it.
    [Fact]
    public async Task A_void_waits_for_the_advertised_result_so_a_failed_first_fetch_is_retried_by_the_next_poll()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        var resultId = Guid.NewGuid();
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "voided", resultId);
        // First pass: the fake's default GetResult is an outage.

        await Run();

        Assert.Empty(_repository.StoredResults);
        Assert.DoesNotContain("advance:voided", _repository.Writes);

        // The poll interval passes: the attempt, still completed, is due again (a voided one with no result would not be).
        Assert.Contains(ProviderAttemptStates.Completed, ProviderAttemptPolling.SittingStates);
        _repository.Released.Clear();
        _provider.OnGetResult = id => ProviderCall<ParsedProviderResult>.Success(ResultFor(attempt, id, validity: "voided"));
        await Run();

        var stored = Assert.Single(_repository.StoredResults);
        Assert.Equal((resultId, "voided"), (stored.ResultId, stored.ValidityStatus));
    }

    [Fact]
    public async Task A_void_with_a_result_that_is_gone_still_lands()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "voided", Guid.NewGuid());
        _provider.OnGetResult = _ => ProviderCall<ParsedProviderResult>.Fail(new ProviderFailure(404, "not_found", false, []));

        await Run();

        Assert.Contains("advance:voided", _repository.Writes);
    }

    [Fact]
    public async Task A_failing_organization_never_stops_the_others()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        var other = Guid.NewGuid();
        _repository.Attempts.Add(attempt with { Id = Guid.NewGuid(), OrganizationId = other, ProviderAssignmentId = Guid.NewGuid() });
        _repository.FailingClaimOrganization = other;
        _provider.OnGetAssignment = _ => AssignmentOf(attempt, "in_progress");

        var outcome = await Run();

        Assert.Equal((2, 1, 1), (outcome.Organizations, outcome.FailedOrganizations, outcome.Changed));
    }

    [Fact]
    public async Task A_withdrawn_candidates_attempt_is_staged_and_nothing_is_fetched()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Completed);
        _repository.WithdrawnCandidates.Add(attempt.CandidateId);

        await Run();

        Assert.Contains("withdrawal_staged", _repository.Writes);
        Assert.DoesNotContain("get_assignment", _provider.Calls);
        Assert.DoesNotContain("result", _provider.Calls);
    }

    [Fact]
    public async Task An_unconfigured_provider_claims_nothing()
    {
        _repository.AddCreatedAttempt("lia", ProviderAttemptStates.Launched);
        _provider.IsConfigured = false;

        var outcome = await Run();

        Assert.Equal(0, outcome.Polled);
        Assert.DoesNotContain(_repository.Writes, w => w.StartsWith("claimed:", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("created", null)]
    [InlineData("cancelled", null)] // only an ATS cancel or the #312 cascade cancels an attempt
    [InlineData("a_future_status", null)]
    [InlineData("in_progress", ProviderAttemptStates.InProgress)]
    [InlineData("completed", ProviderAttemptStates.Completed)]
    [InlineData("voided", ProviderAttemptStates.Voided)]
    [InlineData("expired", ProviderAttemptStates.Expired)]
    public void A_provider_status_maps_to_at_most_one_ats_state(string providerStatus, string? state) =>
        Assert.Equal(state, ProviderAttemptPolling.StateFor(providerStatus));
}
