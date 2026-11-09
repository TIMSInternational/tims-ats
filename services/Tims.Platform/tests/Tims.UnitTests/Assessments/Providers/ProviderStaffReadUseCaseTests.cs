using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Domain.FitEngine;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// AS-7 / AS-14 staff reads: the assignable catalog (binding ∩ provider catalog, the vacancy's pinned version) and one
/// candidate's attempts as HR sees them (status chips, D3/D20 counting, D6 redaction, vacancy scope, #312).
/// </summary>
public sealed class ProviderStaffReadUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 13, 0, 0, TimeSpan.Zero);
    private static readonly Guid OtherVacancy = Guid.Parse("a0000000-0000-4000-8000-000000000002");

    private const string Requirements =
        """{"assessments":[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"Análisis"},""" +
        """{"instrument":"english","use":"scored","min":{"cefr":"B2"},"reason":"Clientes"},""" +
        """{"instrument":"personality","use":"advisory","reason":"Entrevista"}]}""";

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();
    private readonly FakeStaffRepository _staff = new();

    private ProviderStaffReadUseCase UseCase => new(_repository, _staff, _provider);

    private Task<StaffCandidateAttemptList> List(bool hidesLevels = false, Func<Guid, Task<bool>>? inScope = null) =>
        UseCase.ListCandidateAttemptsAsync(
            FakeRepository.Org, FakeRepository.Candidate, hidesLevels, liaScoredAllowed: false,
            inScope ?? (_ => Task.FromResult(true)), Now, CancellationToken.None);

    // ── catalog ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_catalog_lists_only_instruments_the_binding_enables_and_the_provider_offers_for_selection()
    {
        // The fake catalog does not offer MI for selection.
        _repository.Binding = _repository.Binding! with { EnabledInstruments = ["english", "lia", "mi"] };

        var result = await UseCase.GetCatalogAsync(FakeRepository.Org, null, CancellationToken.None);

        Assert.Equal(StaffReadOutcome.Ok, result.Outcome);
        Assert.True(result.Catalog!.Connected);
        Assert.Equal(["lia", "english"], result.Catalog.Instruments.Select(i => i.Instrument));
        Assert.All(result.Catalog.Instruments, i => Assert.Null(i.PinnedVersion));
    }

    [Fact]
    public async Task The_catalog_names_the_version_a_vacancy_is_pinned_to()
    {
        _staff.Pinned["lia"] = "1.0";

        var result = await UseCase.GetCatalogAsync(FakeRepository.Org, FakeRepository.Vacancy, CancellationToken.None);

        Assert.Equal("1.0", result.Catalog!.Instruments.Single(i => i.Instrument == "lia").PinnedVersion);
        Assert.Null(result.Catalog.Instruments.Single(i => i.Instrument == "english").PinnedVersion);
        Assert.Equal(FakeRepository.Vacancy, _staff.PinnedFor);
    }

    [Fact]
    public async Task An_org_without_a_binding_is_not_connected_and_the_provider_is_not_called()
    {
        _repository.Binding = null;

        var result = await UseCase.GetCatalogAsync(FakeRepository.Org, null, CancellationToken.None);

        Assert.False(result.Catalog!.Connected);
        Assert.Empty(result.Catalog.Instruments);
        Assert.DoesNotContain("catalog", _provider.Calls);
    }

    [Fact]
    public async Task An_unconfigured_provider_is_reported_as_such()
    {
        _provider.IsConfigured = false;

        var result = await UseCase.GetCatalogAsync(FakeRepository.Org, null, CancellationToken.None);

        Assert.Equal(StaffReadOutcome.ProviderUnconfigured, result.Outcome);
    }

    // ── a candidate's attempts ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Hr_sees_the_level_and_whether_the_minimum_is_met()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady), Result(percentile: 30));

        var attempt = Assert.Single((await List()).Attempts);

        Assert.Equal(ProviderStaffStatuses.ResultReady, attempt.Status);
        Assert.Equal(30, attempt.Result!.GlobalPercentile);
        Assert.Equal(ProviderMinimumStatus.NotMet, attempt.Result.Minimum);
        Assert.False(attempt.Result.ReviewPending);
        Assert.Equal(1m, attempt.TimeMultiplier);
    }

    // Owner default D6: a team leader sees "below minimum", never the level, its reasons or the accommodation.
    [Fact]
    public async Task A_team_leader_sees_only_whether_the_minimum_is_met()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady), Result(percentile: 30));
        _staff.Add(Attempt("english", ProviderAttemptStates.ResultReady), Result(cefr: "C1"));

        var attempts = (await List(hidesLevels: true)).Attempts;

        Assert.All(attempts, a =>
        {
            Assert.Null(a.Result!.GlobalPercentile);
            Assert.Null(a.Result.Cefr);
            Assert.Null(a.Result.Level);
            Assert.Null(a.Result.ValidityReasons);
            Assert.Null(a.TimeMultiplier);
            Assert.Null(a.Aids);
        });
        Assert.Equal(ProviderMinimumStatus.NotMet, attempts.Single(a => a.Instrument == "lia").Result!.Minimum);
        Assert.Equal(ProviderMinimumStatus.Met, attempts.Single(a => a.Instrument == "english").Result!.Minimum);
    }

    // D3: English counts once, in languages, even when the vacancy scores it; D20: a scored LIA is a threshold.
    [Fact]
    public async Task English_counts_in_languages_and_a_scored_lia_counts_as_a_threshold()
    {
        _staff.Add(Attempt("english", ProviderAttemptStates.Created), null);
        _staff.Add(Attempt("lia", ProviderAttemptStates.Created), null);
        _staff.Add(Attempt("personality", ProviderAttemptStates.Created), null);
        _staff.Add(Attempt("itcia", ProviderAttemptStates.Created), null);

        var attempts = (await List()).Attempts;

        Assert.Equal(ProviderCountsIn.Languages, attempts.Single(a => a.Instrument == "english").CountsIn);
        Assert.Equal(ProviderCountsIn.Gate, attempts.Single(a => a.Instrument == "lia").CountsIn);
        Assert.Equal(ProviderCountsIn.Advisory, attempts.Single(a => a.Instrument == "personality").CountsIn);
        Assert.Equal(ProviderCountsIn.NotListed, attempts.Single(a => a.Instrument == "itcia").CountsIn);
    }

    [Fact]
    public async Task A_result_awaiting_review_is_needs_review_and_its_minimum_is_unknown()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady), Result(percentile: 90, validity: ProviderValidity.NeedsReview));

        var attempt = Assert.Single((await List()).Attempts);

        Assert.Equal(ProviderStaffStatuses.NeedsReview, attempt.Status);
        Assert.True(attempt.Result!.ReviewPending);
        Assert.Equal(ProviderMinimumStatus.Unknown, attempt.Result.Minimum);
    }

    [Fact]
    public async Task A_result_sat_at_another_time_multiplier_needs_review()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady), Result(percentile: 90, applied: 1.5m));

        Assert.Equal(ProviderStaffStatuses.NeedsReview, Assert.Single((await List()).Attempts).Status);
    }

    [Fact]
    public async Task An_attempt_of_an_out_of_scope_vacancy_is_omitted()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.Created), null);
        _staff.Add(Attempt("lia", ProviderAttemptStates.Created) with { VacancyId = OtherVacancy }, null);

        var attempts = (await List(inScope: v => Task.FromResult(v == FakeRepository.Vacancy))).Attempts;

        Assert.Equal(FakeRepository.Vacancy, Assert.Single(attempts).VacancyId);
    }

    [Fact]
    public async Task A_withdrawn_candidate_shows_no_attempt()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady), Result(percentile: 90));
        _staff.Withdrawn = true;

        var list = await List();

        Assert.True(list.ConsentWithdrawn);
        Assert.Empty(list.Attempts);
    }

    [Fact]
    public async Task An_attempt_the_withdrawal_cascade_reached_shows_no_result()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.ResultReady) with { WithdrawalState = "pending" }, Result(percentile: 90));

        var attempt = Assert.Single((await List()).Attempts);

        Assert.Equal(ProviderStaffStatuses.Withdrawn, attempt.Status);
        Assert.Null(attempt.Result);
    }

    [Fact]
    public async Task Missing_consents_show_only_while_consent_is_needed_and_errors_only_while_pending()
    {
        _staff.Add(Attempt("lia", ProviderAttemptStates.Created) with { MissingConsents = ["assessment"] }, null);
        _staff.Add(Attempt("english", ProviderAttemptStates.PendingCreate) with { LastErrorCode = "provider_unavailable" }, null);
        _staff.Add(Attempt("personality", ProviderAttemptStates.InProgress) with { MissingConsents = ["assessment"], LastErrorCode = "x" }, null);

        var attempts = (await List()).Attempts;

        Assert.Equal(["assessment"], attempts.Single(a => a.Instrument == "lia").MissingConsents);
        Assert.Equal(ProviderStaffStatuses.ConsentNeeded, attempts.Single(a => a.Instrument == "lia").Status);
        Assert.Equal("provider_unavailable", attempts.Single(a => a.Instrument == "english").LastErrorCode);
        Assert.Empty(attempts.Single(a => a.Instrument == "personality").MissingConsents);
        Assert.Null(attempts.Single(a => a.Instrument == "personality").LastErrorCode);
    }

    // ── domain rules ───────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ProviderAttemptStates.PendingCreate, false, null, ProviderStaffStatuses.Pending)]
    [InlineData(ProviderAttemptStates.Created, false, null, ProviderStaffStatuses.Sent)]
    [InlineData(ProviderAttemptStates.Created, true, null, ProviderStaffStatuses.ConsentNeeded)]
    [InlineData(ProviderAttemptStates.Launched, false, null, ProviderStaffStatuses.Sent)]
    [InlineData(ProviderAttemptStates.InProgress, false, null, ProviderStaffStatuses.InProgress)]
    [InlineData(ProviderAttemptStates.Completed, false, null, ProviderStaffStatuses.Scoring)]
    [InlineData(ProviderAttemptStates.ResultReady, false, true, ProviderStaffStatuses.ResultReady)]
    [InlineData(ProviderAttemptStates.ResultReady, false, false, ProviderStaffStatuses.NeedsReview)]
    [InlineData(ProviderAttemptStates.Voided, false, null, ProviderStaffStatuses.NeedsReview)]
    [InlineData(ProviderAttemptStates.Voided, false, false, ProviderStaffStatuses.NeedsReview)]
    [InlineData(ProviderAttemptStates.Expired, false, null, ProviderStaffStatuses.Expired)]
    [InlineData(ProviderAttemptStates.Cancelled, false, null, ProviderStaffStatuses.Cancelled)]
    [InlineData(ProviderAttemptStates.Erased, false, null, ProviderStaffStatuses.Erased)]
    public void The_status_chip_follows_the_attempt_and_its_result(string state, bool missing, bool? valid, string expected) =>
        Assert.Equal(expected, ProviderStaffStatuses.For(state, missing ? ["assessment"] : [], null, valid, false, false, Now));

    [Fact]
    public void A_sent_attempt_past_its_start_deadline_is_expired() =>
        Assert.Equal(ProviderStaffStatuses.Expired,
            ProviderStaffStatuses.For(ProviderAttemptStates.Created, [], Now.AddMinutes(-1), null, false, false, Now));

    [Theory]
    [InlineData("itcia", 3, 3, ProviderMinimumStatus.Met)]
    [InlineData("itcia", 2, 3, ProviderMinimumStatus.NotMet)]
    [InlineData("itcia", null, 3, ProviderMinimumStatus.Unknown)]
    public void The_itcia_minimum_is_judged_on_the_level(string instrument, int? level, int minimum, string expected) =>
        Assert.Equal(expected, ProviderMinimumStatus.Evaluate(
            new AssessmentRequirement(instrument, FitInstrumentUses.Gate, new InstrumentMinimum(null, null, minimum, null), null, "r"),
            resultValid: true, null, null, level));

    [Fact]
    public void An_advisory_instrument_has_no_minimum() =>
        Assert.Null(ProviderMinimumStatus.Evaluate(
            new AssessmentRequirement("personality", FitInstrumentUses.Advisory, null, null, "r"), true, null, null, null));

    private static AttemptRow Attempt(string instrument, string state) =>
        new(Guid.NewGuid(), FakeRepository.Org, FakeRepository.Candidate, FakeRepository.Vacancy, instrument, state, "r", "es",
            1m, ["extended_breaks"], null, Guid.NewGuid(), Guid.NewGuid(), "1.0", "c-1", ["assessment"], null, null, false,
            MissingConsents: []);

    private static StaffResultRecord Result(
        double? percentile = null, string? cefr = null, string validity = ProviderValidity.Valid, decimal applied = 1m) =>
        new(Guid.NewGuid(), "selection", "1.0", "norm-1", validity, validity == ProviderValidity.Valid ? [] : ["proctoring"],
            false, percentile, cefr, null, applied, Now.AddHours(-1));

    private sealed class FakeStaffRepository : IProviderStaffReadRepository
    {
        private readonly List<StaffAttemptRecord> _attempts = [];

        public Dictionary<string, string> Pinned { get; } = new(StringComparer.Ordinal);

        public Guid? PinnedFor { get; private set; }

        public bool Withdrawn { get; set; }

        public void Add(AttemptRow attempt, StaffResultRecord? result) =>
            _attempts.Add(new StaffAttemptRecord(attempt, Now.AddDays(-1), null, result));

        public Task<IReadOnlyDictionary<string, string>> GetVacancyPinnedVersionsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
        {
            PinnedFor = vacancyId;
            return Task.FromResult<IReadOnlyDictionary<string, string>>(Pinned);
        }

        public Task<StaffCandidateAttempts> ListCandidateAttemptsAsync(
            Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken) =>
            Task.FromResult(Withdrawn
                ? new StaffCandidateAttempts(true, [], new Dictionary<Guid, string?>())
                : new StaffCandidateAttempts(false, _attempts,
                    new Dictionary<Guid, string?> { [FakeRepository.Vacancy] = Requirements, [OtherVacancy] = Requirements }));
    }
}
