using System.Text.Json.Nodes;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// FIT v2 orchestration pins over a recording fake repository and a fake result source:
///   the switch — flag OFF is v1 even for a configured vacancy (the result source is never read); flag ON with no
///     <c>assessments</c> array is byte-identical to flag OFF; flag ON + array takes the v2 path, which REPLACES
///     the latest-of-any-type read and keeps the six v1 keys first;
///   hiring guardrails — a not-met gate never moves the overall score and never skips the candidate; a
///     needs-review result is excluded from the assessment dimension (never read as a 0 instrument score), and
///     because excluding it still moves the overall number, the row is stored partial with reviewPending: true;
///   weighting — the profile's assessment weight is split across scored instruments by their weights;
///   a SCORED English result verifies the languages dimension (a gate never moves a number);
///   v1 readers — simulateWeights re-scores a v2 row from its five dimension keys;
///   the composite source's order. (The ATS adapter and the provider stub live in Tims.Infrastructure and are
///   pinned in Tims.IntegrationTests/FitEngine/FitV2Tests.)
/// </summary>
public sealed class FitV2UseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid OrgId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid VacancyId = Guid.Parse("7ac00000-0000-0000-0000-000000000001");
    private static readonly Guid CandidateId = Guid.Parse("ca000000-0000-0000-0000-000000000001");

    private const string DefaultWeights =
        """{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""";

    // ── the switch ──
    [Fact]
    public async Task FlagOff_ConfiguredVacancy_IsV1_AndNeverReadsTheResultSource()
    {
        var repo = Repo("""{"assessments":[{"instrument":"native_quiz"}]}""", assessmentScore: 64);
        var source = new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 99));

        await new FitEngineWriteUseCase(repo, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: false, CancellationToken.None);

        var breakdown = SingleBreakdown(repo);
        Assert.Equal(
            ["assessment", "interview", "experience", "education", "languages", "llmJudgment"],
            breakdown.Select(p => p.Key).ToArray());
        Assert.Equal(64, breakdown["assessment"]!.GetValue<double>());
        Assert.Equal(1, repo.LatestAssessmentReads);
        Assert.Empty(source.Calls);
    }

    [Fact]
    public async Task FlagOn_VacancyWithoutAssessmentsArray_IsByteIdenticalToFlagOff()
    {
        const string requirements =
            """{"minYearsExperience":2,"requiredLanguages":["English","Spanish"],"assessments":{"not":"an array"}}""";
        var off = Repo(requirements, assessmentScore: 75.5, languages: """["English (B2)"]""", interview: 70);
        var on = Repo(requirements, assessmentScore: 75.5, languages: """["English (B2)"]""", interview: 70);
        var source = new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 10));

        await new FitEngineWriteUseCase(off, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: false, CancellationToken.None);
        await new FitEngineWriteUseCase(on, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var a = Assert.Single(off.FitScoreUpserts);
        var b = Assert.Single(on.FitScoreUpserts);
        Assert.Equal(a, b);
        Assert.Empty(source.Calls);
        Assert.Equal(1, on.LatestAssessmentReads);
    }

    [Fact]
    public async Task FlagOn_ConfiguredVacancy_V2Breakdown_V1KeysFirst_ReplacesLatestOfAnyTypeRead()
    {
        var repo = Repo(
            """{"assessments":[{"instrument":"lia","min":{"globalPercentile":40}},{"instrument":"personality"}]}""",
            assessmentScore: 12);
        var source = new FakeResultSource(
            Result(FitInstruments.Lia, "r-lia", percentile: 20),
            Result(FitInstruments.Personality, "r-p"));

        await new FitEngineWriteUseCase(repo, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var breakdown = SingleBreakdown(repo);
        Assert.Equal(
            ["assessment", "interview", "experience", "education", "languages", "llmJudgment", "fitVersion", "reviewPending", "assessments"],
            breakdown.Select(p => p.Key).ToArray());
        Assert.Equal(50, breakdown["assessment"]!.GetValue<double>()); // 20 / 40 → 50, NOT the latest-of-any-type 12
        Assert.Equal(2, breakdown["fitVersion"]!.GetValue<int>());
        Assert.False(breakdown["reviewPending"]!.GetValue<bool>());
        Assert.Equal(0, repo.LatestAssessmentReads);
        Assert.Equal([(OrgId, CandidateId, VacancyId)], source.Calls);

        var entries = breakdown["assessments"]!.AsArray();
        Assert.Equal(["lia", "personality"], entries.Select(e => e!["instrument"]!.GetValue<string>()).ToArray());
        Assert.Null(entries[1]!["score"]); // advisory: never scored
        Assert.Equal("advisory", entries[1]!["use"]!.GetValue<string>());
        Assert.Equal("completed", entries[1]!["status"]!.GetValue<string>());
        Assert.Null(entries[1]!["resultId"]); // advisory: status only
        Assert.Null(entries[1]!["source"]);
        Assert.Equal("r-lia", entries[0]!["resultId"]!.GetValue<string>());
    }

    [Fact]
    public async Task FlagOn_EmptyAssessmentsArray_AssessmentDimensionIsNull()
    {
        var repo = Repo("""{"assessments":[]}""", assessmentScore: 90);
        var source = new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 90));

        await new FitEngineWriteUseCase(repo, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var upsert = Assert.Single(repo.FitScoreUpserts);
        var breakdown = JsonNode.Parse(upsert.BreakdownJson)!.AsObject();
        Assert.Null(breakdown["assessment"]);
        Assert.Empty(breakdown["assessments"]!.AsArray());
        Assert.True(upsert.IsPartial);
    }

    [Fact]
    public async Task FlagOn_NonEmptyArrayWhereNothingParses_IsV1_NotADroppedAssessmentDimension()
    {
        // A typo ("native-quiz") must not take the v2 path with no instrument, which would drop the quiz score v1
        // uses for every candidate without a word to HR: the vacancy behaves as if it were not configured.
        const string requirements = """{"assessments":[{"instrument":"native-quiz"}]}""";
        var off = Repo(requirements, assessmentScore: 90);
        var on = Repo(requirements, assessmentScore: 90);
        var source = new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 90));

        await new FitEngineWriteUseCase(off, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: false, CancellationToken.None);
        await new FitEngineWriteUseCase(on, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        Assert.Equal(Assert.Single(off.FitScoreUpserts), Assert.Single(on.FitScoreUpserts));
        Assert.Equal(90, SingleBreakdown(on)["assessment"]!.GetValue<double>());
        Assert.Equal(1, on.LatestAssessmentReads);
        Assert.Empty(source.Calls);
    }

    // ── hiring guardrails ──
    [Fact]
    public async Task FlagOn_GateNotMet_NeverChangesTheOverallScore_AndNeverSkipsTheCandidate()
    {
        // English is ALSO required in languages and the CV claims it: a not-met English GATE must not override that
        // claim (only a scored English entry may move a number), so both rows score the same.
        var withGate = Repo(
            """{"requiredLanguages":["English"],"assessments":[{"instrument":"lia","min":{"globalPercentile":40}},{"instrument":"english","use":"gate","min":{"cefr":"C1"}}]}""",
            interview: 30,
            languages: """["English (C2)"]""");
        var withoutGate = Repo(
            """{"requiredLanguages":["English"],"assessments":[{"instrument":"lia","min":{"globalPercentile":40}}]}""",
            interview: 30,
            languages: """["English (C2)"]""");
        var source = new FakeResultSource(
            Result(FitInstruments.Lia, "r-lia", percentile: 60),
            Result(FitInstruments.English, "r-en", cefr: "A2"));

        await new FitEngineWriteUseCase(withGate, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);
        await new FitEngineWriteUseCase(withoutGate, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var gated = Assert.Single(withGate.FitScoreUpserts);
        var plain = Assert.Single(withoutGate.FitScoreUpserts);
        Assert.Equal(plain.OverallScore, gated.OverallScore);
        Assert.Equal(77, gated.OverallScore); // (100 + 30 + 100) × 0.2 / 0.6 = 76.67
        var breakdown = JsonNode.Parse(gated.BreakdownJson)!;
        Assert.Equal(100, breakdown["languages"]!.GetValue<double>());
        var english = breakdown["assessments"]![1]!;
        Assert.Equal("not_met", english["gate"]!.GetValue<string>());
        Assert.Null(english["score"]);
        Assert.Equal("cv", english["languagesEvidence"]!.GetValue<string>());
    }

    [Fact]
    public async Task FlagOn_NeedsReview_IsExcluded_NotReadAsZero()
    {
        const string requirements = """{"minYearsExperience":2,"assessments":[{"instrument":"native_quiz"}]}""";
        var review = Repo(requirements, yearsExperience: 4);
        var zero = Repo(requirements, yearsExperience: 4);

        await new FitEngineWriteUseCase(
                review,
                new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 0, integrity: ResultIntegrity.NeedsReview)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);
        await new FitEngineWriteUseCase(zero, new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 0)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var excluded = Assert.Single(review.FitScoreUpserts);
        var scoredZero = Assert.Single(zero.FitScoreUpserts);
        Assert.Equal(100, excluded.OverallScore); // only experience (100) remains after renormalization
        Assert.Equal(50, scoredZero.OverallScore); // (0 × 0.2 + 100 × 0.2) / 0.4
        var entry = JsonNode.Parse(excluded.BreakdownJson)!["assessments"]![0]!;
        Assert.Equal("needs_review", entry["status"]!.GetValue<string>());
        Assert.Null(JsonNode.Parse(excluded.BreakdownJson)!["assessment"]);
        Assert.True(JsonNode.Parse(excluded.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
        Assert.True(excluded.IsPartial);
        Assert.False(JsonNode.Parse(scoredZero.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
    }

    [Fact]
    public async Task FlagOn_NeedsReview_WhenAssessmentIsTheOnlyDimension_IsTheNoDataValue_MarkedPending()
    {
        // No CV data, no interview: the assessment is the only dimension that could exist. A result awaiting review
        // leaves NO dimension, so the overall is v1's no-data value (0, partial), exactly what a candidate who never
        // took the test gets: the flag does not rank the candidate below one with no result. It is not a score:
        // reviewPending says the number is provisional, and a ranking reader must hold the row apart.
        const string requirements = """{"assessments":[{"instrument":"native_quiz"}]}""";
        var review = Repo(requirements);
        var none = Repo(requirements);
        var low = Repo(requirements);

        await new FitEngineWriteUseCase(
                review,
                new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 85, integrity: ResultIntegrity.NeedsReview)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);
        await new FitEngineWriteUseCase(none, new FakeResultSource())
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);
        await new FitEngineWriteUseCase(low, new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 10)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var pending = Assert.Single(review.FitScoreUpserts);
        var noResult = Assert.Single(none.FitScoreUpserts);
        var scoredLow = Assert.Single(low.FitScoreUpserts);
        Assert.Equal(noResult.OverallScore, pending.OverallScore);
        Assert.Equal(0, pending.OverallScore);
        Assert.True(pending.IsPartial);
        Assert.True(JsonNode.Parse(pending.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
        Assert.False(JsonNode.Parse(noResult.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
        Assert.Equal(10, scoredLow.OverallScore);
        Assert.False(JsonNode.Parse(scoredLow.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
    }

    [Fact]
    public async Task FlagOn_OneScoredInstrumentNeedsReview_RowIsPartial_EvenWithEveryDimensionPresent()
    {
        // All five dimensions are present, so v1's isPartial would be false. The quiz awaiting review is left out of
        // the assessment dimension (lia alone fills it), which makes the number provisional: the row is stored as
        // partial so no reader shows it as a complete score (or puts it in the >= 80 highlight).
        const string requirements =
            """{"minYearsExperience":2,"requiredEducationLevel":"bachelor","requiredLanguages":["Spanish"],"assessments":[{"instrument":"lia","min":{"globalPercentile":40}},{"instrument":"native_quiz"}]}""";
        const string education = """[{"degree":"Bachelor of Science"}]""";
        var review = Repo(requirements, interview: 80, yearsExperience: 4, languages: """["Spanish"]""", education: education);
        var valid = Repo(requirements, interview: 80, yearsExperience: 4, languages: """["Spanish"]""", education: education);

        await new FitEngineWriteUseCase(
                review,
                new FakeResultSource(
                    Result(FitInstruments.Lia, "r-lia", percentile: 40),
                    Result(FitInstruments.NativeQuiz, "a-1", score: 30, integrity: ResultIntegrity.NeedsReview)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);
        await new FitEngineWriteUseCase(
                valid,
                new FakeResultSource(
                    Result(FitInstruments.Lia, "r-lia", percentile: 40),
                    Result(FitInstruments.NativeQuiz, "a-1", score: 30)))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var pending = Assert.Single(review.FitScoreUpserts);
        var counted = Assert.Single(valid.FitScoreUpserts);
        var pendingBreakdown = JsonNode.Parse(pending.BreakdownJson)!;
        Assert.Equal(100, pendingBreakdown["assessment"]!.GetValue<double>()); // lia only: 40 vs 40
        Assert.Equal(96, pending.OverallScore); // (100 + 80 + 100 + 100 + 100) / 5
        Assert.True(pending.IsPartial);
        Assert.True(pendingBreakdown["reviewPending"]!.GetValue<bool>());

        Assert.Equal(65, JsonNode.Parse(counted.BreakdownJson)!["assessment"]!.GetValue<double>()); // (100 + 30) / 2
        Assert.Equal(89, counted.OverallScore); // (65 + 80 + 100 + 100 + 100) / 5
        Assert.False(counted.IsPartial);
        Assert.False(JsonNode.Parse(counted.BreakdownJson)!["reviewPending"]!.GetValue<bool>());
    }

    // ── weighting ──
    [Fact]
    public async Task FlagOn_SplitsTheProfilesAssessmentWeight_ByInstrumentWeights()
    {
        var repo = Repo(
            """{"assessments":[{"instrument":"lia","min":{"globalPercentile":40},"weight":1},{"instrument":"native_quiz","weight":3}]}""",
            interview: 80,
            profileWeights: """{"assessment":0.5,"interview":0.5,"experience":0,"education":0,"languages":0}""");
        var source = new FakeResultSource(
            Result(FitInstruments.Lia, "r-lia", percentile: 50),
            Result(FitInstruments.NativeQuiz, "a-1", score: 60));

        await new FitEngineWriteUseCase(repo, source)
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var upsert = Assert.Single(repo.FitScoreUpserts);
        var breakdown = JsonNode.Parse(upsert.BreakdownJson)!;
        Assert.Equal(70, breakdown["assessment"]!.GetValue<double>()); // (100 × 1 + 60 × 3) / 4
        Assert.Equal(75, upsert.OverallScore); // (70 × 0.5 + 80 × 0.5) / 1.0
        Assert.Equal(0.125, breakdown["assessments"]![0]!["effectiveWeight"]!.GetValue<double>());
        Assert.Equal(0.375, breakdown["assessments"]![1]!["effectiveWeight"]!.GetValue<double>());
    }

    // ── a scored English result verifies languages ──
    [Fact]
    public async Task FlagOn_ScoredEnglishBelowTheMinimum_OverridesTheCvClaimInLanguages()
    {
        const string requirements =
            """{"requiredLanguages":["English"],"assessments":[{"instrument":"english","use":"scored","min":{"cefr":"B2"}}]}""";
        var repo = Repo(requirements, languages: """["English (C2)"]""");

        await new FitEngineWriteUseCase(repo, new FakeResultSource(Result(FitInstruments.English, "r-en", cefr: "B1")))
            .ComputeForVacancyAsync(OrgId, VacancyId, Now, fitV2Enabled: true, CancellationToken.None);

        var breakdown = SingleBreakdown(repo);
        Assert.Equal(50, breakdown["assessment"]!.GetValue<double>()); // B1 vs B2 on the ladder: (2 + 1) / 6
        Assert.Equal(0, breakdown["languages"]!.GetValue<double>());
        Assert.Equal("assessment", breakdown["assessments"]![0]!["languagesEvidence"]!.GetValue<string>());
    }

    // ── v1 readers of a v2 row ──
    [Fact]
    public async Task SimulateWeights_ReScoresAV2Row_FromItsFiveDimensionKeys()
    {
        const string v2Breakdown =
            """{"assessment":70,"interview":80,"experience":null,"education":null,"languages":null,"llmJudgment":null,"fitVersion":2,"assessments":[{"instrument":"lia","score":100}]}""";
        var read = new FakeReadRepo(
            new FitScoreForVacancyData(Guid.NewGuid(), 75, v2Breakdown, true, Now, CandidateId, "Ana", "Ruiz"));
        var weights = new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["assessment"] = 0.25,
            ["interview"] = 0.75,
            ["experience"] = 0,
            ["education"] = 0,
            ["languages"] = 0,
        };

        var rows = await new FitEngineReadUseCase(read).SimulateWeightsAsync(OrgId, VacancyId, weights, CancellationToken.None);

        var row = Assert.Single(rows);
        Assert.Equal(78, row.SimulatedScore); // (70 × 0.25 + 80 × 0.75) / 1.0 = 77.5 → 78
        Assert.True(row.IsPartial);
    }

    // ── the composite port ──
    [Fact]
    public async Task CompositeSource_ConcatenatesInOrder()
    {
        var first = new FakeResultSource(Result(FitInstruments.NativeQuiz, "a-1", score: 1));
        var second = new FakeResultSource(Result(FitInstruments.Lia, "r-1", percentile: 2));
        var composite = new CompositeAssessmentResultSource([first, new FakeResultSource(), second]);

        var results = await composite.GetResultsAsync(OrgId, CandidateId, VacancyId, CancellationToken.None);

        Assert.Equal(["a-1", "r-1"], results.Select(r => r.ResultId).ToArray());
        Assert.Equal([(OrgId, CandidateId, VacancyId)], first.Calls);
    }

    // ── helpers ──
    private static JsonObject SingleBreakdown(FakeWriteRepo repo) =>
        JsonNode.Parse(Assert.Single(repo.FitScoreUpserts).BreakdownJson)!.AsObject();

    private static FakeWriteRepo Repo(
        string fitRequirements,
        double? assessmentScore = null,
        int? interview = null,
        int? yearsExperience = null,
        string? languages = null,
        string profileWeights = DefaultWeights,
        string? education = null) =>
        new()
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData(null, fitRequirements),
            Candidate = new CandidateForFitData(yearsExperience, education, languages),
            AssessmentScore = assessmentScore,
            InterviewScore = interview,
            DefaultProfile = new WeightProfileData(Guid.NewGuid(), "Default", profileWeights),
        };

    private static InstrumentResult Result(
        string instrument,
        string id,
        double? score = null,
        double? percentile = null,
        string? cefr = null,
        int? level = null,
        ResultIntegrity integrity = ResultIntegrity.Valid) =>
        new(instrument, id, "test", integrity, Now.AddDays(-1), score, percentile, cefr, level, null, null);

    private sealed record FitScoreUpsert(double OverallScore, string BreakdownJson, string WeightsJson, bool IsPartial);

    private sealed class FakeResultSource(params InstrumentResult[] results) : IAssessmentResultSource
    {
        public List<(Guid Org, Guid Candidate, Guid Vacancy)> Calls { get; } = [];

        public Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
        {
            Calls.Add((organizationId, candidateId, vacancyId));
            return Task.FromResult<IReadOnlyList<InstrumentResult>>(results);
        }
    }

    private sealed class FakeReadRepo(params FitScoreForVacancyData[] rows) : IFitEngineReadRepository
    {
        public Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<FitScoreForVacancyData>>(rows);

        public Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
            Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<WeightProfileData>>([]);

        public Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<ExplainFitRowData?>(null);
    }

    private sealed class FakeWriteRepo : IFitEngineWriteRepository
    {
        public IReadOnlyList<Guid> PipelineCandidateIds { get; init; } = [];

        public VacancyForFitData? Vacancy { get; init; }

        public CandidateForFitData? Candidate { get; init; }

        public double? AssessmentScore { get; init; }

        public int? InterviewScore { get; init; }

        public WeightProfileData? DefaultProfile { get; init; }

        public int LatestAssessmentReads { get; private set; }

        public List<FitScoreUpsert> FitScoreUpserts { get; } = [];

        public Task<CandidateForFitData?> GetCandidateForFitAsync(
            Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
            Task.FromResult(Candidate);

        public Task<VacancyForFitData?> GetVacancyForFitAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(Vacancy);

        public Task<double?> GetLatestAssessmentScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
        {
            LatestAssessmentReads++;
            return Task.FromResult(AssessmentScore);
        }

        public Task<int?> GetLatestInterviewFitScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(InterviewScore);

        public Task<WeightProfileData?> FindWeightProfileAsync(
            Guid organizationId, string name, CancellationToken cancellationToken) =>
            Task.FromResult(name == "Default" ? DefaultProfile : null);

        public Task<WeightProfileData> UpsertWeightProfileAsync(
            Guid organizationId, string name, string weightsJson, DateTimeOffset now,
            CancellationToken cancellationToken) =>
            Task.FromResult(new WeightProfileData(Guid.NewGuid(), name, weightsJson));

        public Task<bool> UpsertFitScoreUnlessWithdrawnAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
            string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken)
        {
            FitScoreUpserts.Add(new FitScoreUpsert(overallScore, breakdownJson, weightsJson, isPartial));
            return Task.FromResult(true);
        }

        public Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(PipelineCandidateIds);

        public Task<IReadOnlySet<Guid>> GetConsentWithdrawnCandidateIdsAsync(
            Guid organizationId, IReadOnlyCollection<Guid> candidateIds, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlySet<Guid>>(new HashSet<Guid>());
    }
}
