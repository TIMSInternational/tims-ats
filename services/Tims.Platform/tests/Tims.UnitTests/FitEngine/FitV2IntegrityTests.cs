using System.Text.Json.Nodes;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// The FIT v2 flag-on preconditions closed on release/assessments-fit-provider (slice "fit"), at the unit level:
///   D6 on every read — the candidate fit-scores read redacts exactly as contracts/fit-v2-fixtures/visibility.json
///     says (the same file the TS twin in @tims/ai runs), and drops rows outside the reader's vacancies;
///   D20 — a scored LIA is a threshold gate until the norms are confirmed;
///   several native quizzes — the latest result of EACH quiz counts, a flagged one holds the instrument;
///   grading norms — the local percentile/band arithmetic is the TS one;
///   the recompute queue's drain loop — completion at the claimed sequence, failures recorded, nothing stops the pass.
/// The review-completion rule and the database halves (triggers, queue SQL, review column, grading write) are pinned against real Postgres in
/// Tims.IntegrationTests/FitEngine/FitV2IntegrityTests.
/// </summary>
public sealed class FitV2IntegrityTests
{
    private static readonly Guid OrgId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CandidateId = Guid.Parse("ca000000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    // ── D6: the candidate fit-scores read ──
    [Fact]
    public async Task CandidateFitScores_RedactEveryVisibilityFixtureCase_ForANarrowReader()
    {
        var cases = JsonNode.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "fit-v2-fixtures", "visibility.json")))!["cases"]!.AsArray();
        Assert.True(cases.Count >= 6);
        foreach (var c in cases)
        {
            var input = c!["input"]!;
            var expected = c["expected"]!;
            var repo = new CandidateRepo();
            repo.Rows.Add(new CandidateFitScoreData(
                Guid.NewGuid(), Guid.NewGuid(), input["overallScore"]!.GetValue<double>(),
                input["breakdown"]!.ToJsonString(), input["weights"]?.ToJsonString(),
                input["isPartial"]!.GetValue<bool>(), Now));

            var row = Assert.Single(await new FitEngineReadUseCase(repo).GetCandidateFitScoresAsync(
                OrgId, CandidateId, hideBelowMinimum: true, _ => Task.FromResult(true), CancellationToken.None));

            var name = c["name"]!.GetValue<string>();
            Assert.True(JsonNode.DeepEquals(expected["breakdown"], row.Breakdown), $"{name}: breakdown {row.Breakdown?.ToJsonString()}");
            Assert.True(expected["overallScore"]!.GetValue<double>() == row.OverallScore, $"{name}: overall {row.OverallScore}");
            Assert.True(expected["isPartial"]!.GetValue<bool>() == row.IsPartial, $"{name}: isPartial");

            // HR / admin (company scope and up) see the stored row, whatever it holds.
            var wide = Assert.Single(await new FitEngineReadUseCase(repo).GetCandidateFitScoresAsync(
                OrgId, CandidateId, hideBelowMinimum: false, _ => Task.FromResult(true), CancellationToken.None));
            Assert.True(JsonNode.DeepEquals(input["breakdown"], wide.Breakdown), name);
            Assert.Equal(input["overallScore"]!.GetValue<double>(), wide.OverallScore);
        }
    }

    [Fact]
    public async Task CandidateFitScores_OmitRowsOfVacanciesOutsideTheReadersScope_ProbingEachVacancyOnce()
    {
        var inScope = Guid.NewGuid();
        var outOfScope = Guid.NewGuid();
        var repo = new CandidateRepo();
        foreach (var vacancy in new[] { inScope, outOfScope, inScope })
        {
            repo.Rows.Add(new CandidateFitScoreData(Guid.NewGuid(), vacancy, 70, "{}", null, false, Now));
        }

        var probes = new List<Guid>();
        var rows = await new FitEngineReadUseCase(repo).GetCandidateFitScoresAsync(
            OrgId, CandidateId, hideBelowMinimum: false,
            vacancy =>
            {
                probes.Add(vacancy);
                return Task.FromResult(vacancy == inScope);
            },
            CancellationToken.None);

        Assert.Equal([inScope.ToString(), inScope.ToString()], rows.Select(r => r.VacancyId).ToArray());
        Assert.Equal([inScope, outOfScope], probes);
    }

    // ── D20 ──
    [Fact]
    public void LiaThresholdPolicy_TurnsOnlyAScoredLiaIntoAGate_AndDropsItsWeight()
    {
        var requirements = FitV2Kernels.ParseAssessmentRequirements(JsonNode.Parse(
            """{"assessments":[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"weight":2},{"instrument":"native_quiz","weight":1},{"instrument":"itcia","use":"scored","min":{"level":3},"weight":1}]}"""))!;

        var threshold = FitV2Kernels.ApplyLiaThresholdPolicy(requirements);
        Assert.Equal(new AssessmentRequirement("lia", "gate", requirements[0].Min, null, null), threshold[0]);
        Assert.Equal(requirements[1], threshold[1]);
        Assert.Equal(requirements[2], threshold[2]);

        Assert.Same(requirements, FitV2Kernels.ApplyLiaThresholdPolicy(requirements, liaScoredAllowed: true));
    }

    // ── several native quizzes ──
    [Fact]
    public void SeveralQuizzes_EachQuizsLatestCounts_CombinedByTheirMean()
    {
        var evaluation = EvaluateQuiz(
            Quiz("q1-old", "type-1", 30, days: -10),
            Quiz("q1-new", "type-1", 60, days: -5),
            Quiz("q2", "type-2", 90, days: -7));

        var entry = Assert.Single(evaluation.Entries);
        Assert.Equal(FitInstrumentStatuses.Completed, entry.Status);
        Assert.Equal(75, entry.Score); // (60 + 90) / 2 — not 60 alone (the latest quiz) and not the older 30
        Assert.Equal("q1-new", entry.ResultId);
        Assert.Equal(["q1-new", "q2"], entry.ResultIds);
        Assert.Equal(75, evaluation.AssessmentScore);
        Assert.Equal(
            ["q1-new", "q2"],
            FitV2Kernels.EntryToJson(entry)["resultIds"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
    }

    [Fact]
    public void SeveralQuizzes_OneAwaitingReview_HoldsTheWholeInstrument_NeverAMeanOfTheRest()
    {
        var evaluation = EvaluateQuiz(
            Quiz("q1", "type-1", 95, days: -2),
            Quiz("q2", "type-2", 10, days: -3, ResultIntegrity.NeedsReview));

        var entry = Assert.Single(evaluation.Entries);
        Assert.Equal(FitInstrumentStatuses.NeedsReview, entry.Status);
        Assert.Null(entry.Score);
        Assert.Null(evaluation.AssessmentScore);
        Assert.True(evaluation.ReviewPending);
        Assert.Equal(["q1", "q2"], entry.ResultIds);
    }

    [Fact]
    public void OneQuiz_OrResultsWithoutAVariant_KeepTheSingleTestRule_AndNoResultIdsKey()
    {
        var single = Assert.Single(EvaluateQuiz(Quiz("a", "type-1", 40, days: -9), Quiz("b", "type-1", 70, days: -1)).Entries);
        Assert.Equal(70, single.Score);
        Assert.Null(single.ResultIds);
        Assert.False(FitV2Kernels.EntryToJson(single).ContainsKey("resultIds"));

        var noVariant = Assert.Single(EvaluateQuiz(Quiz("a", null, 40, days: -9), Quiz("b", null, 70, days: -1)).Entries);
        Assert.Equal(70, noVariant.Score);
    }

    [Fact]
    public void CombineVariants_MeansOnlyTheQuizzesWithAValue_AndHasNoValueWhenNoneHas()
    {
        var combined = FitV2Kernels.CombineVariants([Quiz("a", "1", 80, days: -1), Quiz("b", "2", null, days: -2)]);
        Assert.Equal(80, combined.NormalizedScore);
        Assert.Equal(ResultIntegrity.Valid, combined.Integrity);

        var none = FitV2Kernels.CombineVariants([Quiz("a", "1", null, days: -1), Quiz("b", "2", null, days: -2)]);
        Assert.Null(none.NormalizedScore);
    }

    // ── grading norms ──
    [Theory]
    [InlineData(0, 0, 4, null, null)]                       // below the minimum sample: no percentile (TS honest null)
    [InlineData(0, 0, 5, 0d, "below_average")]
    [InlineData(1, 0, 4, null, null)]
    [InlineData(1, 0, 5, 20d, "below_average")]
    [InlineData(1, 1, 5, 30d, "average")]                     // midpoint rank: (1 + 0.5) / 5
    [InlineData(2, 1, 5, 50d, "above_average")]
    [InlineData(7, 1, 10, 75d, "excellent")]
    [InlineData(2, 0, 8, 25d, "average")]                     // 25 is the first 'average'
    [InlineData(1, 1, 3, null, null)]
    public void NormBands_MatchTheTsComputeNormBandFromCounts(
        long below, long equal, long sample, double? percentile, string? band)
    {
        var result = AssessmentNormBands.FromCounts(below, equal, sample);
        Assert.Equal(percentile, result?.Percentile);
        Assert.Equal(band, result?.Band);
    }

    [Fact]
    public void NormBands_BandEdges()
    {
        Assert.Equal("below_average", AssessmentNormBands.BandFor(24.999));
        Assert.Equal("average", AssessmentNormBands.BandFor(49.999));
        Assert.Equal("above_average", AssessmentNormBands.BandFor(74.999));
        Assert.Equal("excellent", AssessmentNormBands.BandFor(100));
    }

    // ── the recompute drain loop ──
    [Fact]
    public async Task Drain_CompletesEachClaimAtItsSequence_RecordsFailures_AndKeepsGoing()
    {
        var orgB = Guid.NewGuid();
        var ok = new FitRecomputeRequest(Guid.NewGuid(), Guid.NewGuid(), 3, 1);
        var boom = new FitRecomputeRequest(Guid.NewGuid(), Guid.NewGuid(), 1, 1);
        var queue = new FakeQueue
        {
            Organizations = [OrgId, orgB],
            Claims = { [OrgId] = [boom, ok] },
            ClaimFailures = { orgB },
        };
        var repo = new RecomputeRepo { FailFor = boom.CandidateId };

        var outcome = await new FitRecomputeUseCase(queue, new FitEngineWriteUseCase(repo, new NoResults()))
            .RunAsync(Now, fitV2Enabled: true, liaScoredAllowed: false, CancellationToken.None);

        Assert.Equal(new FitRecomputeOutcome(2, 1, 0, 1, 1), outcome);
        Assert.Equal([(ok.CandidateId, 3L)], queue.Completed);
        Assert.Equal([(boom.CandidateId, 1L, nameof(InvalidOperationException))], queue.Failures);
    }

    [Fact]
    public async Task Drain_ARequestThatNeedsNoWrite_IsStillCompleted_AndCancellationStopsThePass()
    {
        var request = new FitRecomputeRequest(Guid.NewGuid(), Guid.NewGuid(), 1, 1);
        var queue = new FakeQueue { Organizations = [OrgId], Claims = { [OrgId] = [request] } };

        var outcome = await new FitRecomputeUseCase(queue, new FitEngineWriteUseCase(new RecomputeRepo(), new NoResults()))
            .RunAsync(Now, fitV2Enabled: false, liaScoredAllowed: false, CancellationToken.None);
        Assert.Equal(new FitRecomputeOutcome(1, 0, 1, 0, 0), outcome); // flag off: nothing written, request consumed
        Assert.Single(queue.Completed);

        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new FitRecomputeUseCase(queue, new FitEngineWriteUseCase(new RecomputeRepo(), new NoResults()))
                .RunAsync(Now, fitV2Enabled: true, liaScoredAllowed: false, cancelled.Token));
    }

    // ── helpers ──
    private static FitV2Evaluation EvaluateQuiz(params InstrumentResult[] results) =>
        FitV2Kernels.Evaluate(
            [new AssessmentRequirement(FitInstruments.NativeQuiz, FitInstrumentUses.Scored, null, null, null)],
            results,
            FitEngineKernels.ParseWeights(JsonNode.Parse("""{"assessment":1}""")),
            FitEngineKernels.ParseRequirements(null),
            null);

    private static InstrumentResult Quiz(
        string id, string? variant, double? score, int days, ResultIntegrity integrity = ResultIntegrity.Valid) =>
        new(FitInstruments.NativeQuiz, id, "ats", integrity, Now.AddDays(days), score, null, null, null, null, null, variant);

    private sealed class CandidateRepo : IFitEngineReadRepository
    {
        public List<CandidateFitScoreData> Rows { get; } = [];

        public Task<IReadOnlyList<CandidateFitScoreData>> GetFitScoresForCandidateAsync(
            Guid organizationId, Guid candidateId, int max, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<CandidateFitScoreData>>(Rows.Take(max).ToList());

        public Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<FitScoreForVacancyData>>([]);

        public Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
            Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<WeightProfileData>>([]);

        public Task<IReadOnlyList<FitReviewStateData>> GetReviewStatesAsync(
            Guid organizationId, IReadOnlyCollection<Guid> fitScoreIds, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<FitReviewStateData>>([]);

        public Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<ExplainFitRowData?>(null);
    }

    private sealed class FakeQueue : IFitRecomputeQueue
    {
        public IReadOnlyList<Guid> Organizations { get; init; } = [];

        public Dictionary<Guid, IReadOnlyList<FitRecomputeRequest>> Claims { get; } = [];

        public HashSet<Guid> ClaimFailures { get; } = [];

        public List<(Guid Candidate, long Seq)> Completed { get; } = [];

        public List<(Guid Candidate, long Seq, string Error)> Failures { get; } = [];

        public Task<IReadOnlyList<Guid>> ListOrganizationsWithDueRequestsAsync(int max, CancellationToken cancellationToken) =>
            Task.FromResult(Organizations);

        public Task<IReadOnlyList<FitRecomputeRequest>> ClaimAsync(
            Guid organizationId, int max, CancellationToken cancellationToken) =>
            ClaimFailures.Contains(organizationId)
                ? throw new InvalidOperationException("claim failed")
                : Task.FromResult(Claims.TryGetValue(organizationId, out var claims) ? claims : []);

        public Task<bool> CompleteAsync(Guid organizationId, FitRecomputeRequest request, CancellationToken cancellationToken)
        {
            Completed.Add((request.CandidateId, request.RequestSeq));
            return Task.FromResult(true);
        }

        public Task RecordFailureAsync(
            Guid organizationId, FitRecomputeRequest request, string error, CancellationToken cancellationToken)
        {
            Failures.Add((request.CandidateId, request.RequestSeq, error));
            return Task.CompletedTask;
        }
    }

    private sealed class NoResults : IAssessmentResultSource
    {
        public Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<InstrumentResult>>([]);
    }

    // A v2-configured vacancy whose rows all exist; the write throws for FailFor.
    private sealed class RecomputeRepo : IFitEngineWriteRepository
    {
        public Guid? FailFor { get; init; }

        public Task<CandidateForFitData?> GetCandidateForFitAsync(
            Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
            Task.FromResult<CandidateForFitData?>(null);

        public Task<VacancyForFitData?> GetVacancyForFitAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<VacancyForFitData?>(new VacancyForFitData(null, """{"assessments":[{"instrument":"native_quiz"}]}"""));

        public Task<double?> GetLatestAssessmentScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("a recompute never reads v1's latest-of-any-type score");

        public Task<int?> GetLatestInterviewFitScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<int?>(null);

        public Task<WeightProfileData?> FindWeightProfileAsync(
            Guid organizationId, string name, CancellationToken cancellationToken) =>
            Task.FromResult<WeightProfileData?>(new WeightProfileData(Guid.NewGuid(), name, """{"assessment":1}"""));

        public Task<WeightProfileData> UpsertWeightProfileAsync(
            Guid organizationId, string name, string weightsJson, DateTimeOffset now, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("not used");

        public Task<bool> UpsertFitScoreUnlessWithdrawnAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
            string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken,
            bool skipIfV2Configured = false) =>
            throw new InvalidOperationException("a recompute never writes v1");

        public async Task<bool> UpsertFitScoreV2Async(
            Guid organizationId, Guid candidateId, Guid vacancyId, string weightsJson, DateTimeOffset now,
            Func<CancellationToken, Task<FitScoreWrite?>> buildInLock, CancellationToken cancellationToken,
            bool onlyIfRowExists = false, Func<CancellationToken, Task<bool>>? createIfMissing = null)
        {
            Assert.True(onlyIfRowExists);
            if (candidateId == FailFor)
            {
                throw new InvalidOperationException("write failed");
            }

            await buildInLock(cancellationToken);
            return true;
        }

        // The in-lock read sees the vacancy as the fake stores it.

        public async Task<string?> GetFitRequirementsInLockAsync(

            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>

            (await GetVacancyForFitAsync(organizationId, vacancyId, cancellationToken))?.FitRequirements;


        public Task<string?> UpsertFitRequirementsAsync(
            Guid organizationId, Guid vacancyId, string fitRequirementsJson, bool replaceAssessments, DateTimeOffset now,
            CancellationToken cancellationToken) =>
            throw new InvalidOperationException("not used");

        public Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("a recompute never reads the pipeline");

        public Task<IReadOnlySet<Guid>> GetConsentWithdrawnCandidateIdsAsync(
            Guid organizationId, IReadOnlyCollection<Guid> candidateIds, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("a recompute re-checks consent inside the locked write");
    }
}
