using System.Text;
using System.Text.Json.Nodes;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// Proctoring parity with tims-suite (owner decision 2026-11-11): the org's settings, the block every TIMS assignment
/// carries (never PCA), the snapshot on the attempt, and the new outcomes (auto-submit, proctoring void) in the staff
/// read and the candidate portal.
/// </summary>
public sealed class ProviderProctoringTests
{
    private static readonly Guid Actor = Guid.Parse("d0000000-0000-4000-8000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 11, 13, 0, 0, TimeSpan.Zero);
    private static readonly Guid Owner = Guid.Parse("0f0f0f0f-0000-4000-8000-000000000003");

    private static readonly AssessmentProctoring Strict =
        new(true, new AntiCheatPolicy(3, AntiCheatConsequences.AutoSubmit), false);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private static AssignProviderInstrumentsInput Input(params string[] instruments) =>
        new(FakeRepository.Candidate, FakeRepository.Vacancy, instruments.Select(i => new AssignInstrumentItem(i, "Razón del puesto")).ToList(),
            null, 1m, [], null, ProviderAgeBands.Adult);

    private Task<ProviderAssignResult> Assign(AssignProviderInstrumentsInput input, bool identityCheckAllowed = false) =>
        new AssignProviderInstrumentsUseCase(_repository, _provider)
            .AssignAsync(FakeRepository.Org, Actor, input, Now, CancellationToken.None, identityCheckAllowed);

    private void Settings(AssessmentProctoring settings) =>
        _repository.ProctoringSettings = new ProctoringSettingsRow(settings, Now.AddDays(-1), Actor);

    // ── the block for one assignment ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_link_out_instrument_never_carries_a_block() =>
        Assert.Null(AssessmentProctoring.ForAssignment("pca", Strict, identityCheckAllowed: true));

    [Fact]
    public void Every_setting_off_or_none_saved_sends_no_block_todays_behaviour()
    {
        Assert.Null(AssessmentProctoring.ForAssignment("lia", null, identityCheckAllowed: true));
        Assert.Null(AssessmentProctoring.ForAssignment("lia", AssessmentProctoring.Off, identityCheckAllowed: true));
    }

    [Fact]
    public void The_identity_check_is_dropped_unless_the_platform_allows_it()
    {
        var withIdentity = Strict with { IdentityCheck = true };

        Assert.False(AssessmentProctoring.ForAssignment("lia", withIdentity, identityCheckAllowed: false)!.IdentityCheck);
        Assert.True(AssessmentProctoring.ForAssignment("lia", withIdentity, identityCheckAllowed: true)!.IdentityCheck);
        // Identity check alone, not allowed: nothing left to send.
        Assert.Null(AssessmentProctoring.ForAssignment("english", new AssessmentProctoring(false, null, true), false));
    }

    [Theory]
    [InlineData(0, "warn", false)]
    [InlineData(1, "warn", true)]
    [InlineData(20, "void", true)]
    [InlineData(21, "auto_submit", false)]
    [InlineData(3, "block", false)]
    public void An_anti_cheat_policy_is_valid_only_within_the_contract(int threshold, string consequence, bool valid) =>
        Assert.Equal(valid, new AntiCheatPolicy(threshold, consequence).IsValid);

    // ── assignment creation ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Every_tims_assignment_carries_the_orgs_block_and_pca_omits_it()
    {
        Settings(Strict);

        var result = await Assign(Input("lia", "english", "pca"));

        Assert.Equal(ProviderAssignOutcome.Ok, result.Outcome);
        Assert.Equal(Strict, _provider.Assignments.Single(a => a.Request.Instrument == "lia").Request.Proctoring);
        Assert.Equal(Strict, _provider.Assignments.Single(a => a.Request.Instrument == "english").Request.Proctoring);
        Assert.Null(_provider.Assignments.Single(a => a.Request.Instrument == "pca").Request.Proctoring);
        // What was sent is on the attempt.
        Assert.Equal(Strict, _repository.Attempts.Single(a => a.Instrument == "lia").Proctoring);
        Assert.Null(_repository.Attempts.Single(a => a.Instrument == "pca").Proctoring);
    }

    [Fact]
    public async Task An_org_that_never_saved_settings_sends_no_block()
    {
        await Assign(Input("lia"));

        Assert.Null(Assert.Single(_provider.Assignments).Request.Proctoring);
        Assert.Null(Assert.Single(_repository.Attempts).Proctoring);
    }

    [Fact]
    public async Task A_stored_identity_check_is_not_sent_while_the_platform_flag_is_off()
    {
        Settings(Strict with { IdentityCheck = true });

        await Assign(Input("lia"));

        Assert.Equal(Strict, Assert.Single(_provider.Assignments).Request.Proctoring);
    }

    [Fact]
    public async Task A_create_re_sent_after_a_settings_change_carries_the_block_it_was_reserved_with()
    {
        Settings(Strict);
        _provider.OnCreateAssignment = _ => ProviderCall<ProviderAssignment>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true));
        var first = await Assign(Input("lia"));
        Assert.Equal(ProviderAttemptStates.PendingCreate, first.Response!.Items[0].State);

        // HR changes the settings before the re-send: the sitting already assigned keeps its block, so the provider
        // never sees a different block under the same external_ref (409 external_ref_conflict).
        Settings(new AssessmentProctoring(false, new AntiCheatPolicy(10, AntiCheatConsequences.Void), false));
        _provider.OnCreateAssignment = null;
        var second = await Assign(Input("lia"));

        Assert.Equal(ProviderAssignOutcome.Ok, second.Outcome);
        Assert.Equal(2, _provider.Assignments.Count);
        Assert.All(_provider.Assignments, a => Assert.Equal(Strict, a.Request.Proctoring));
    }

    [Fact]
    public async Task A_settings_change_is_not_a_terms_conflict_for_an_open_attempt()
    {
        Settings(Strict);
        await Assign(Input("lia"));
        Settings(AssessmentProctoring.Off);

        var again = await Assign(Input("lia"));

        Assert.Equal(ProviderAssignOutcome.Ok, again.Outcome);
        Assert.Single(_provider.Assignments);
    }

    // ── the settings ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Settings_never_saved_read_as_all_off_with_the_identity_check_unavailable()
    {
        var view = await new ProviderProctoringSettingsUseCase(_repository).GetAsync(FakeRepository.Org, false, CancellationToken.None);

        Assert.False(view.Lockdown);
        Assert.Null(view.AntiCheat);
        Assert.False(view.IdentityCheck);
        Assert.False(view.IdentityCheckAvailable);
        Assert.Null(view.UpdatedAt);
    }

    [Fact]
    public async Task Turning_the_identity_check_on_while_it_is_unavailable_saves_nothing()
    {
        var result = await new ProviderProctoringSettingsUseCase(_repository).UpdateAsync(
            FakeRepository.Org, Actor, Strict with { IdentityCheck = true }, identityCheckAllowed: false, Now, CancellationToken.None);

        Assert.Equal(ProctoringSettingsOutcome.IdentityCheckUnavailable, result.Outcome);
        Assert.Empty(_repository.SavedProctoring);
    }

    [Fact]
    public async Task Saving_the_settings_stores_them_for_the_actor()
    {
        var result = await new ProviderProctoringSettingsUseCase(_repository).UpdateAsync(
            FakeRepository.Org, Actor, Strict, identityCheckAllowed: false, Now, CancellationToken.None);

        Assert.Equal(ProctoringSettingsOutcome.Ok, result.Outcome);
        Assert.Equal((Actor, Strict), Assert.Single(_repository.SavedProctoring));
        Assert.True(result.View!.Lockdown);
        Assert.Equal(new AntiCheatPolicy(3, "auto_submit"), result.View.AntiCheat);
        Assert.Equal("2026-11-11T13:00:00.000Z", result.View.UpdatedAt);
    }

    [Fact]
    public void A_stored_identity_check_reads_off_once_the_platform_withdraws_it()
    {
        var view = ProviderProctoringSettingsUseCase.ToView(
            new ProctoringSettingsRow(Strict with { IdentityCheck = true }, Now, Actor), identityCheckAllowed: false);

        Assert.False(view.IdentityCheck);
        Assert.False(view.IdentityCheckAvailable);
    }

    [Theory]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":3,"consequence":"auto_submit"},"identityCheck":false}""", true)]
    [InlineData("""{"lockdown":false,"antiCheat":null,"identityCheck":false}""", true)]
    [InlineData("""{"lockdown":false,"identityCheck":false}""", false)] // antiCheat must be explicit
    [InlineData("""{"lockdown":false,"antiCheat":null,"identityCheck":false,"extra":1}""", false)]
    [InlineData("""{"lockdown":"yes","antiCheat":null,"identityCheck":false}""", false)]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":0,"consequence":"warn"},"identityCheck":false}""", false)]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":21,"consequence":"warn"},"identityCheck":false}""", false)]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":2.5,"consequence":"warn"},"identityCheck":false}""", false)]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":3,"consequence":"kick"},"identityCheck":false}""", false)]
    [InlineData("""{"lockdown":true,"antiCheat":{"threshold":3},"identityCheck":false}""", false)]
    [InlineData("""[]""", false)]
    public void The_settings_body_is_parsed_strictly(string json, bool ok) =>
        Assert.Equal(ok, ProviderProctoringSettingsUseCase.TryParseBody(JsonNode.Parse(json), out _));

    // ── outcomes ────────────────────────────────────────────────────────────────────────────────────────────────────

    private static (byte[] Body, Guid EventId) Envelope(string type, JsonObject data)
    {
        var id = Guid.NewGuid();
        var envelope = new JsonObject
        {
            ["event_id"] = id.ToString(),
            ["event_type"] = type,
            ["event_version"] = 1,
            ["occurred_at"] = "2026-11-11T12:38:06Z",
            ["producer"] = "tims-assessments",
            ["tenant_id"] = "3f1d2c4b-8a6e-4f2a-9c1d-5b7e8a9f0c12",
            ["data"] = data,
        };
        return (Encoding.UTF8.GetBytes(envelope.ToJsonString()), id);
    }

    private async Task Deliver(string type, JsonObject data)
    {
        var (body, eventId) = Envelope(type, data);
        await new ProviderWebhookUseCase(_repository, _provider).HandleAsync(
            body, WebhookSignature.BuildHeader(FakeProvider.Secret, Now.ToUnixTimeSeconds(), body),
            eventId.ToString(), type, 1, Now, CancellationToken.None);
        await new ProviderInboxWorkerUseCase(_repository, _provider).RunAsync(Owner, Now, CancellationToken.None);
    }

    [Fact]
    public async Task A_session_completed_by_proctoring_auto_submit_records_its_cause()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);

        await Deliver("session.completed", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
            ["session_id"] = Guid.NewGuid().ToString(),
            ["instrument"] = "lia",
            ["completed_at"] = "2026-11-11T12:38:05Z",
            ["result_expected"] = true,
            ["completed_by"] = "proctoring_auto_submit",
        });

        Assert.Equal((ProviderAttemptStates.Completed, "proctoring_auto_submit"), Assert.Single(_repository.Advances));
    }

    [Fact]
    public async Task A_session_completed_without_completed_by_from_an_older_provider_still_completes()
    {
        var attempt = _repository.AddCreatedAttempt("lia", ProviderAttemptStates.InProgress);

        await Deliver("session.completed", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
            ["completed_at"] = "2026-11-11T12:38:05Z",
        });

        Assert.Equal((ProviderAttemptStates.Completed, (string?)null), Assert.Single(_repository.Advances));
    }

    [Fact]
    public async Task A_proctoring_void_records_its_reason()
    {
        var attempt = _repository.AddCreatedAttempt("english", ProviderAttemptStates.InProgress);

        await Deliver("session.voided", new JsonObject
        {
            ["assignment_id"] = attempt.ProviderAssignmentId.ToString(),
            ["voided_at"] = "2026-11-11T12:38:05Z",
            ["reason"] = "proctoring_void",
            ["decided_by"] = "server_policy",
        });

        Assert.Equal((ProviderAttemptStates.Voided, "proctoring_void"), Assert.Single(_repository.Advances));
    }

    [Theory]
    [InlineData("proctoring_auto_submit", null, ProviderProctoringOutcomes.AutoSubmitted)]
    [InlineData(null, "proctoring_void", ProviderProctoringOutcomes.Voided)]
    [InlineData("candidate", null, null)]
    [InlineData("time_limit", null, null)]
    [InlineData(null, "administrative_void", null)]
    public void The_proctoring_outcome_names_only_what_proctoring_did(string? completedBy, string? voidReason, string? expected) =>
        Assert.Equal(expected, ProviderProctoringOutcomes.For(completedBy, voidReason));

    private Task<StaffCandidateAttemptList> StaffList(AttemptRow attempt, StaffResultRecord? result, bool hidesLevels)
    {
        var staff = new StaffRepository(new StaffAttemptRecord(attempt, Now.AddDays(-1), Now.AddHours(-1), result));
        return new ProviderStaffReadUseCase(_repository, staff, _provider).ListCandidateAttemptsAsync(
            FakeRepository.Org, FakeRepository.Candidate, hidesLevels, liaScoredAllowed: false, _ => Task.FromResult(true), Now,
            CancellationToken.None);
    }

    private static AttemptRow Row(string state, string? completedBy = null, string? voidReason = null) =>
        new(Guid.NewGuid(), FakeRepository.Org, FakeRepository.Candidate, FakeRepository.Vacancy, "lia", state, "r", "es", 1m, [],
            null, Guid.NewGuid(), Guid.NewGuid(), "1.0", "c-1", ["assessment"], null, null, false, MissingConsents: [],
            CompletedBy: completedBy, VoidReason: voidReason);

    private static StaffResultRecord Flagged() =>
        new(Guid.NewGuid(), "selection", "1.0", "norm-1", ProviderValidity.NeedsReview, ["proctoring_flagged"], true, 55, null,
            null, 1m, Now.AddHours(-1));

    [Fact]
    public async Task An_auto_submitted_result_is_needs_review_with_its_reason_and_outcome_for_company_scope()
    {
        var view = Assert.Single((await StaffList(
            Row(ProviderAttemptStates.ResultReady, completedBy: "proctoring_auto_submit"), Flagged(), hidesLevels: false)).Attempts);

        Assert.Equal(ProviderStaffStatuses.NeedsReview, view.Status);
        Assert.Equal(ProviderProctoringOutcomes.AutoSubmitted, view.ProctoringOutcome);
        Assert.Equal(["proctoring_flagged"], view.Result!.ValidityReasons);
        Assert.True(view.Result.ReviewPending);
    }

    [Fact]
    public async Task A_narrow_reader_sees_no_proctoring_detail_owner_default_d6()
    {
        var view = Assert.Single((await StaffList(
            Row(ProviderAttemptStates.ResultReady, completedBy: "proctoring_auto_submit"), Flagged(), hidesLevels: true)).Attempts);

        Assert.Equal(ProviderStaffStatuses.NeedsReview, view.Status);
        Assert.Null(view.ProctoringOutcome);
        Assert.Null(view.Result!.ValidityReasons);
        Assert.Null(view.Result.GlobalPercentile);
    }

    [Fact]
    public async Task A_proctoring_void_before_any_result_is_needs_review_with_its_outcome()
    {
        var view = Assert.Single((await StaffList(
            Row(ProviderAttemptStates.Voided, voidReason: "proctoring_void"), null, hidesLevels: false)).Attempts);

        Assert.Equal(ProviderStaffStatuses.NeedsReview, view.Status);
        Assert.Equal(ProviderProctoringOutcomes.Voided, view.ProctoringOutcome);
        Assert.Null(view.Result);
    }

    [Fact]
    public void The_portal_stays_coarse_an_auto_submitted_sitting_is_completed_and_a_void_needs_the_org_d9()
    {
        Assert.Equal(ProviderPortalStatuses.Completed,
            ProviderPortalStatuses.For(Row(ProviderAttemptStates.Completed, completedBy: "proctoring_auto_submit"), Now));
        Assert.Equal(ProviderPortalStatuses.NeedsReview,
            ProviderPortalStatuses.For(Row(ProviderAttemptStates.Voided, voidReason: "proctoring_void"), Now));
    }

    private sealed class StaffRepository(StaffAttemptRecord record) : IProviderStaffReadRepository
    {
        public Task<IReadOnlyDictionary<string, string>> GetVacancyPinnedVersionsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyDictionary<string, string>>(new Dictionary<string, string>());

        public Task<StaffCandidateAttempts> ListCandidateAttemptsAsync(
            Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken) =>
            Task.FromResult(new StaffCandidateAttempts(false, [record], new Dictionary<Guid, string?> { [FakeRepository.Vacancy] = null }));
    }
}
