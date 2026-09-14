using System.Text.Json.Nodes;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// Use-case unit pins over a recording fake repository — the orchestration behaviors the integration matrix
/// asserts only end-to-end:
///   computeForVacancy — NO candidates ⇒ {0} and ZERO further reads (no vacancy fetch, no profile bootstrap —
///     the TS empty-map parity); the stored weights are the profile jsonb VERBATIM (extra keys survive — never
///     a re-serialization of the parsed dict); the breakdown carries EXACTLY the six keys in TS literal order
///     with llmJudgment null;
///   resolveWeightProfile — roleFamily hit wins; an EMPTY-STRING roleFamily is falsy in TS and must skip to
///     Default; a roleFamily miss falls back to Default; both missing bootstraps Default with the verbatim
///     0.2-fifths JSON;
///   simulateWeights — stable DESC (ties keep the fetch order, matching JS sort over the overallScore-DESC
///     rows) and a NON-NUMBER breakdown value reads as missing.
/// </summary>
public sealed class FitEngineUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);

    // ── computeForVacancy ──
    [Fact]
    public async Task ComputeForVacancy_NoCandidates_ReturnsZero_AndTouchesNothingElse()
    {
        var repo = new FakeWriteRepo { PipelineCandidateIds = [] };
        var useCase = new FitEngineWriteUseCase(repo);

        var result = await useCase.ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        Assert.Equal(0, result.Computed);
        Assert.Equal(0, repo.VacancyFetches);
        Assert.Equal(0, repo.ProfileFinds);
        Assert.Empty(repo.FitScoreUpserts);
        Assert.Empty(repo.ProfileUpserts);
    }

    [Fact]
    public async Task ComputeForVacancy_StoresProfileWeightsVerbatim_IncludingExtraKeys()
    {
        // The profile jsonb carries an EXTRA key — TS writes profile.weights AS-IS into fit_scores.weights,
        // so the C# must store the raw string, not a rebuild from the parsed number dict.
        const string weirdProfile = """{"assessment":0.5,"interview":0.5,"zzz":"extra"}""";
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData("Engineering", null),
            ProfilesByName = { ["Engineering"] = new WeightProfileData(Guid.NewGuid(), "Engineering", weirdProfile) },
            Candidate = new CandidateForFitData(null, null, null),
        };
        var useCase = new FitEngineWriteUseCase(repo);

        await useCase.ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        var upsert = Assert.Single(repo.FitScoreUpserts);
        Assert.Equal(weirdProfile, upsert.WeightsJson);
    }

    [Fact]
    public async Task ComputeForVacancy_BreakdownHasExactlySixKeys_InTsLiteralOrder_LlmJudgmentNull()
    {
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData(null, """{"minYearsExperience":2}"""),
            ProfilesByName = { ["Default"] = DefaultProfile() },
            Candidate = new CandidateForFitData(4, null, null),
            AssessmentScore = 75.5,
        };
        var useCase = new FitEngineWriteUseCase(repo);

        await useCase.ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        var upsert = Assert.Single(repo.FitScoreUpserts);
        var breakdown = JsonNode.Parse(upsert.BreakdownJson)!.AsObject();
        Assert.Equal(
            ["assessment", "interview", "experience", "education", "languages", "llmJudgment"],
            breakdown.Select(p => p.Key).ToArray());
        Assert.Equal(75.5, breakdown["assessment"]!.GetValue<double>());
        Assert.Equal(100, breakdown["experience"]!.GetValue<double>()); // 4y vs min 2 → capped 100
        Assert.Null(breakdown["interview"]);
        Assert.Null(breakdown["llmJudgment"]);
    }

    [Fact]
    public async Task ComputeForVacancy_VacancyNull_StillComputes_EmptyRequirements_DefaultProfile()
    {
        // The vacancy soft-deleted BETWEEN the endpoint probe and the compute: the TS `vacancy?.` chain
        // computes with {} requirements and a null roleFamily rather than throwing. Reachable only here —
        // the endpoint's assertScoped 404s first, so no integration test can exercise it.
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = null,
            ProfilesByName = { ["Default"] = DefaultProfile() },
            Candidate = new CandidateForFitData(7, null, null),
            AssessmentScore = 42,
        };

        await new FitEngineWriteUseCase(repo).ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        var upsert = Assert.Single(repo.FitScoreUpserts);
        var breakdown = JsonNode.Parse(upsert.BreakdownJson)!.AsObject();
        // No requirements ⇒ the three requirement-derived dims are null even though the candidate HAS data.
        Assert.Equal(42, breakdown["assessment"]!.GetValue<double>());
        Assert.Null(breakdown["experience"]);
        Assert.Null(breakdown["education"]);
        Assert.Null(breakdown["languages"]);
        // Null roleFamily is falsy ⇒ never looked up; resolution goes straight to Default.
        Assert.DoesNotContain(string.Empty, repo.ProfileFindNames);
        Assert.Equal(["Default"], repo.ProfileFindNames);
    }

    [Fact]
    public async Task ComputeForVacancy_ManyCandidates_FetchesVacancyExactlyOnce()
    {
        // Pins divergence #4 (TS re-fetches the vacancy per candidate; this port fetches once). Without
        // this, moving the fetch back inside the loop is invisible.
        var second = Guid.Parse("ca000000-0000-0000-0000-000000000002");
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId, second],
            Vacancy = new VacancyForFitData(null, null),
            ProfilesByName = { ["Default"] = DefaultProfile() },
            Candidate = new CandidateForFitData(null, null, null),
        };

        await new FitEngineWriteUseCase(repo).ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        Assert.Equal(2, repo.FitScoreUpserts.Count);
        Assert.Equal(1, repo.VacancyFetches);
    }

    // ── resolveWeightProfile precedence ──
    [Fact]
    public async Task ResolveProfile_RoleFamilyHit_WinsOverDefault()
    {
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData("Engineering", null),
            ProfilesByName =
            {
                ["Engineering"] = new WeightProfileData(Guid.NewGuid(), "Engineering", """{"assessment":1}"""),
                ["Default"] = DefaultProfile(),
            },
            Candidate = new CandidateForFitData(null, null, null),
        };

        await new FitEngineWriteUseCase(repo).ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        Assert.Equal("""{"assessment":1}""", Assert.Single(repo.FitScoreUpserts).WeightsJson);
        Assert.Empty(repo.ProfileUpserts);
    }

    [Fact]
    public async Task ResolveProfile_EmptyStringRoleFamily_SkipsToDefault_TsFalsyParity()
    {
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData(string.Empty, null),
            ProfilesByName = { ["Default"] = DefaultProfile() },
            Candidate = new CandidateForFitData(null, null, null),
        };

        await new FitEngineWriteUseCase(repo).ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        // The empty-string family must NOT be looked up (TS `if (roleFamily)` is falsy on '').
        Assert.DoesNotContain(string.Empty, repo.ProfileFindNames);
        Assert.Contains("Default", repo.ProfileFindNames);
    }

    [Fact]
    public async Task ResolveProfile_BothMissing_BootstrapsDefaultWithVerbatimFifths()
    {
        var repo = new FakeWriteRepo
        {
            PipelineCandidateIds = [CandidateId],
            Vacancy = new VacancyForFitData("Unknown", null),
            Candidate = new CandidateForFitData(null, null, null),
        };

        await new FitEngineWriteUseCase(repo).ComputeForVacancyAsync(OrgId, VacancyId, Now, CancellationToken.None);

        var bootstrap = Assert.Single(repo.ProfileUpserts);
        Assert.Equal("Default", bootstrap.Name);
        Assert.Equal(
            """{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""",
            bootstrap.WeightsJson);
    }

    // ── simulateWeights ──
    [Fact]
    public async Task SimulateWeights_StableDesc_TiesKeepFetchOrder()
    {
        var rowA = RankingRow("Aaa", 90, """{"assessment":70,"interview":null,"experience":null,"education":null,"languages":null}""");
        var rowB = RankingRow("Bbb", 80, """{"assessment":70,"interview":null,"experience":null,"education":null,"languages":null}""");
        var repo = new FakeReadRepo { Rows = [rowA, rowB] };
        var useCase = new FitEngineReadUseCase(repo);

        var simulated = await useCase.SimulateWeightsAsync(
            OrgId, VacancyId, AllOnAssessment, CancellationToken.None);

        // Both simulate to 70 — the stable sort keeps the stored overallScore-DESC fetch order (Aaa first).
        Assert.Equal(70, simulated[0].SimulatedScore);
        Assert.Equal(70, simulated[1].SimulatedScore);
        Assert.Equal("Aaa", simulated[0].FirstName);
        Assert.Equal("Bbb", simulated[1].FirstName);
    }

    [Fact]
    public async Task SimulateWeights_NonNumberBreakdownValue_ReadsAsMissing()
    {
        var repo = new FakeReadRepo
        {
            Rows = [RankingRow("Gar", 10, """{"assessment":"garbage","interview":null,"experience":null,"education":null,"languages":null}""")],
        };

        var simulated = await new FitEngineReadUseCase(repo).SimulateWeightsAsync(
            OrgId, VacancyId, AllOnAssessment, CancellationToken.None);

        // Every weighted dim missing → availableWeight 0 → {0, partial} (documented divergence from TS NaN
        // coercion on garbage jsonb; real rows are Zod-validated numbers).
        Assert.Equal(0, Assert.Single(simulated).SimulatedScore);
        Assert.True(simulated[0].IsPartial);
    }

    // ── divergence #2: malformed jsonb (C#-ONLY — the TS oracle THROWS on these, so by construction
    //    the shared goldens cannot carry them; without these facts the doc's "pinned" claim was false) ──
    [Fact]
    public void DeriveEducationScore_NonArrayJsonb_IsAbsent_NotAThrow()
    {
        var req = FitEngineKernels.ParseRequirements(JsonNode.Parse("""{"requiredEducationLevel":"bachelor"}"""));
        // TS: `education.length` on an object → undefined, then the for..of throws TypeError → 500.
        Assert.Null(FitEngineKernels.DeriveEducationScore(JsonNode.Parse("""{"degree":"PhD"}"""), req));
        Assert.Null(FitEngineKernels.DeriveEducationScore(JsonNode.Parse("\"PhD\""), req));
        Assert.Null(FitEngineKernels.DeriveEducationScore(JsonNode.Parse("7"), req));
    }

    [Fact]
    public void DeriveLanguageScore_NonArrayJsonb_IsAbsent_NotAThrow()
    {
        var req = FitEngineKernels.ParseRequirements(JsonNode.Parse("""{"requiredLanguages":["English"]}"""));
        // TS: `languages.map` on a string/object → TypeError → 500.
        Assert.Null(FitEngineKernels.DeriveLanguageScore(JsonNode.Parse("\"English\""), req));
        Assert.Null(FitEngineKernels.DeriveLanguageScore(JsonNode.Parse("""{"a":1}"""), req));
    }

    [Fact]
    public void DeriveLanguageScore_NonStringEntry_IsSkipped_RestStillMatch()
    {
        var req = FitEngineKernels.ParseRequirements(JsonNode.Parse("""{"requiredLanguages":["English"]}"""));
        // TS: `l.replace` on the number 5 → TypeError → 500. Here the 5 is skipped and "English" still matches.
        Assert.Equal(100, FitEngineKernels.DeriveLanguageScore(JsonNode.Parse("""[5,"English"]"""), req));
        // …and when the ONLY entry is unusable, the dimension reads absent rather than 0.
        Assert.Equal(0, FitEngineKernels.DeriveLanguageScore(JsonNode.Parse("[5]"), req));
    }

    [Fact]
    public void ParseWeights_NonNumberValue_IsDropped_SoItWeighsZero()
    {
        // Divergence #5, previously unasserted: a string weight is DROPPED (→ `?? 0`), not JS-coerced.
        var weights = FitEngineKernels.ParseWeights(JsonNode.Parse("""{"assessment":"1","interview":0.5}"""));
        Assert.False(weights.ContainsKey("assessment"));
        Assert.Equal(0.5, weights["interview"]);

        var raw = FitEngineKernels.ParseBreakdownScores(JsonNode.Parse("""{"assessment":90,"interview":40}"""));
        // assessment weighs 0, so only interview contributes: 40*0.5/0.5 = 40.
        Assert.Equal(40, FitEngineKernels.ComputeWeightedScore(raw, weights).OverallScore);
    }

    // ── plumbing ──
    private static readonly Guid OrgId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid VacancyId = Guid.Parse("7ac00000-0000-0000-0000-000000000001");
    private static readonly Guid CandidateId = Guid.Parse("ca000000-0000-0000-0000-000000000001");

    private static readonly IReadOnlyDictionary<string, double> AllOnAssessment =
        new Dictionary<string, double>
        {
            ["assessment"] = 1,
            ["interview"] = 0,
            ["experience"] = 0,
            ["education"] = 0,
            ["languages"] = 0,
        };

    private static WeightProfileData DefaultProfile() => new(
        Guid.NewGuid(), "Default",
        """{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""");

    private static FitScoreForVacancyData RankingRow(string firstName, double overall, string breakdown) => new(
        Guid.NewGuid(), overall, breakdown, false, Now, Guid.NewGuid(), firstName, "Last");

    private sealed record FitScoreUpsert(
        Guid CandidateId, double OverallScore, string BreakdownJson, string WeightsJson, bool IsPartial);

    private sealed record ProfileUpsert(string Name, string WeightsJson);

    private sealed class FakeWriteRepo : IFitEngineWriteRepository
    {
        public IReadOnlyList<Guid> PipelineCandidateIds { get; init; } = [];

        public VacancyForFitData? Vacancy { get; init; }

        public CandidateForFitData? Candidate { get; init; }

        public double? AssessmentScore { get; init; }

        public int? InterviewScore { get; init; }

        public Dictionary<string, WeightProfileData> ProfilesByName { get; } = [];

        public int VacancyFetches { get; private set; }

        public int ProfileFinds { get; private set; }

        public List<string> ProfileFindNames { get; } = [];

        public List<FitScoreUpsert> FitScoreUpserts { get; } = [];

        public List<ProfileUpsert> ProfileUpserts { get; } = [];

        public Task<CandidateForFitData?> GetCandidateForFitAsync(
            Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
            Task.FromResult(Candidate);

        public Task<VacancyForFitData?> GetVacancyForFitAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
        {
            VacancyFetches++;
            return Task.FromResult(Vacancy);
        }

        public Task<double?> GetLatestAssessmentScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(AssessmentScore);

        public Task<int?> GetLatestInterviewFitScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(InterviewScore);

        public Task<WeightProfileData?> FindWeightProfileAsync(
            Guid organizationId, string name, CancellationToken cancellationToken)
        {
            ProfileFinds++;
            ProfileFindNames.Add(name);
            return Task.FromResult(ProfilesByName.TryGetValue(name, out var profile) ? profile : null);
        }

        public Task<WeightProfileData> UpsertWeightProfileAsync(
            Guid organizationId, string name, string weightsJson, DateTimeOffset now,
            CancellationToken cancellationToken)
        {
            ProfileUpserts.Add(new ProfileUpsert(name, weightsJson));
            var saved = new WeightProfileData(Guid.NewGuid(), name, weightsJson);
            ProfilesByName[name] = saved;
            return Task.FromResult(saved);
        }

        public Task UpsertFitScoreAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, double overallScore, string breakdownJson,
            string weightsJson, bool isPartial, DateTimeOffset now, CancellationToken cancellationToken)
        {
            FitScoreUpserts.Add(new FitScoreUpsert(candidateId, overallScore, breakdownJson, weightsJson, isPartial));
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<Guid>> GetPipelineCandidateIdsAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(PipelineCandidateIds);
    }

    private sealed class FakeReadRepo : IFitEngineReadRepository
    {
        public IReadOnlyList<FitScoreForVacancyData> Rows { get; init; } = [];

        public Task<IReadOnlyList<FitScoreForVacancyData>> GetFitScoresForVacancyAsync(
            Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(Rows);

        public Task<IReadOnlyList<WeightProfileData>> ListWeightProfilesAsync(
            Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<WeightProfileData>>([]);

        public Task<ExplainFitRowData?> GetFitScoreForExplainAsync(
            Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult<ExplainFitRowData?>(null);
    }
}
