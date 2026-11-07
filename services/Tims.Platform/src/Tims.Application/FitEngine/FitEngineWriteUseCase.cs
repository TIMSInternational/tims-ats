using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>
/// The FIT-engine WRITE flows — <c>computeForVacancy</c> and <c>upsertRoleFamilyWeightProfile</c>
/// (fit-engine.service.ts <c>computeFitScore</c> / <c>computeForVacancy</c> / <c>upsertWeightProfile</c> /
/// <c>resolveWeightProfile</c>). Two deliberately-unobservable shape changes from TS, recorded in the slice doc:
/// candidates run SEQUENTIALLY (TS <c>Promise.all</c> — same DB end-state on success; both stacks are
/// non-atomic on failure), and the vacancy row is fetched ONCE (TS re-fetches it per candidate — same values
/// within the request).
///
/// <para>FIT v2 (<c>Platform:FitEngineV2Enabled</c>, default off): when the flag is on AND the vacancy's
/// <c>fit_requirements</c> carries an <c>assessments</c> array, the <c>assessment</c> dimension is built per
/// instrument from <see cref="IAssessmentResultSource"/> (<see cref="FitV2Kernels"/>), a scored English result
/// verifies the <c>languages</c> dimension, and the breakdown gains <c>fitVersion</c>, <c>reviewPending</c> and
/// <c>assessments</c> after the six v1 keys. A v2 compute re-reads the results after its write and writes again
/// when they changed (see <c>ComputeFitScoreV2Async</c>), so a slower concurrent v2 compute does not leave a stale
/// integrity state as the row's last word (bounded; the design doc lists what remains). In every other case the v1
/// code below runs unchanged — same reads, same breakdown bytes.</para>
/// </summary>
public sealed class FitEngineWriteUseCase(
    IFitEngineWriteRepository repository, IAssessmentResultSource assessmentResults)
{
    private const string DefaultProfileName = "Default";

    /// <summary>The most FIT v2 writes one candidate gets in one compute (see <c>ComputeFitScoreV2Async</c>).</summary>
    public const int MaxV2Writes = 3;

    // TS DEFAULT_WEIGHTS, verbatim — written only when no 'Default' profile exists yet.
    private const string DefaultWeightsJson =
        """{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""";

    private readonly IFitEngineWriteRepository _repository = repository;
    private readonly IAssessmentResultSource _assessmentResults = assessmentResults;

    /// <summary>v1-only construction (no result source): FIT v2 cannot run, so pass the flag off.</summary>
    public FitEngineWriteUseCase(IFitEngineWriteRepository repository)
        : this(repository, NoAssessmentResults.Instance)
    {
    }

    /// <summary><c>upsertRoleFamilyWeightProfile</c> — the weights JSON is built from the FIVE validated values only
    /// (Zod strips unknown body keys, so extras must never reach the row).</summary>
    public async Task<WeightProfileRow> UpsertWeightProfileAsync(
        Guid organizationId, string name, IReadOnlyDictionary<string, double> weights, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var json = BuildWeightsJson(weights);
        var saved = await _repository.UpsertWeightProfileAsync(organizationId, name, json, now, cancellationToken)
            .ConfigureAwait(false);
        return new WeightProfileRow(saved.Id.ToString(), saved.Name, JsonNode.Parse(saved.Weights));
    }

    /// <summary>
    /// <c>computeForVacancy</c> — score every active-pipeline candidate whose recruitment consent is NOT withdrawn;
    /// response is the count actually scored. A withdrawn candidate (#312/#313 — matched on itself or on any
    /// same-org candidate row with the same normalized email) is SKIPPED: no reads, no score computed, no
    /// fit_scores upsert. An existing fit_scores row is left untouched (not deleted) — erasure belongs to the
    /// deletion-request flow, not to scoring. There is no single-candidate scoring path, so nothing returns 412.
    /// Each write re-checks the candidate's consent under the withdrawal's advisory lock, so a withdrawal that
    /// commits mid-run also skips that candidate (and it is not counted).
    /// </summary>
    public Task<ComputeForVacancyResult> ComputeForVacancyAsync(
        Guid organizationId, Guid vacancyId, DateTimeOffset now, CancellationToken cancellationToken) =>
        ComputeForVacancyAsync(organizationId, vacancyId, now, fitV2Enabled: false, cancellationToken);

    /// <summary>
    /// <c>computeForVacancy</c> with the FIT v2 switch. <paramref name="fitV2Enabled"/> false is exactly v1. True
    /// takes the v2 path only for a vacancy whose requirements carry an <c>assessments</c> array.
    /// </summary>
    public async Task<ComputeForVacancyResult> ComputeForVacancyAsync(
        Guid organizationId, Guid vacancyId, DateTimeOffset now, bool fitV2Enabled,
        CancellationToken cancellationToken)
    {
        var pipelineIds = await _repository.GetPipelineCandidateIdsAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        if (pipelineIds.Count == 0)
        {
            // No candidates ⇒ no reads, no Default-profile bootstrap — TS maps over an empty array the same way.
            return new ComputeForVacancyResult(0);
        }

        var withdrawn = await _repository
            .GetConsentWithdrawnCandidateIdsAsync(organizationId, pipelineIds, cancellationToken)
            .ConfigureAwait(false);
        var candidateIds = pipelineIds.Where(id => !withdrawn.Contains(id)).ToList();
        if (candidateIds.Count == 0)
        {
            // Every candidate withdrew ⇒ same shape as the empty pipeline: no vacancy read, no bootstrap.
            return new ComputeForVacancyResult(0);
        }

        var vacancy = await _repository.GetVacancyForFitAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        // Vacancy null (soft-deleted between probe and compute) ⇒ requirements {} and roleFamily null — the TS
        // `vacancy?.` chain, not an error.
        var requirementsNode = ParseNullableJson(vacancy?.FitRequirements);
        var requirements = FitEngineKernels.ParseRequirements(requirementsNode);
        // null ⇒ v1 for every candidate (flag off, or no `assessments` array on this vacancy).
        var assessmentRequirements = fitV2Enabled ? FitV2Kernels.ParseAssessmentRequirements(requirementsNode) : null;

        var scored = 0;
        foreach (var candidateId in candidateIds)
        {
            // #312: false ⇒ the candidate withdrew after the pre-loop check (re-checked under the withdrawal's lock
            // immediately before the write) — nothing written, not counted.
            var computed = assessmentRequirements is null
                ? ComputeFitScoreAsync(
                    organizationId, candidateId, vacancyId, requirements, vacancy?.RoleFamily, now, cancellationToken)
                : ComputeFitScoreV2Async(
                    organizationId, candidateId, vacancyId, requirements, assessmentRequirements, vacancy?.RoleFamily,
                    now, cancellationToken);
            if (await computed.ConfigureAwait(false))
            {
                scored++;
            }
        }

        return new ComputeForVacancyResult(scored);
    }

    // TS computeFitScore for one candidate: 4 reads → derive → resolve weights → weighted score → upsert.
    // A null candidate (soft-deleted while still holding an active application — getPipelineCandidateIds does
    // not join candidates) still gets a row: person-dims null, assessment/interview still fetched. TS parity.
    private async Task<bool> ComputeFitScoreAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, FitRequirements requirements, string? roleFamily,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var candidate = await _repository.GetCandidateForFitAsync(organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        var assessmentScore = await _repository
            .GetLatestAssessmentScoreAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        var interviewScore = await _repository
            .GetLatestInterviewFitScoreAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);

        var rawScores = new Dictionary<string, double?>(StringComparer.Ordinal)
        {
            ["assessment"] = assessmentScore,
            ["interview"] = interviewScore,
            ["experience"] = FitEngineKernels.DeriveExperienceScore(candidate?.YearsExperience, requirements),
            ["education"] = FitEngineKernels.DeriveEducationScore(
                ParseNullableJson(candidate?.Education), requirements),
            ["languages"] = FitEngineKernels.DeriveLanguageScore(
                ParseNullableJson(candidate?.Languages), requirements),
        };

        // Resolved PER CANDIDATE (TS does) — the first candidate may bootstrap the Default profile, the rest find it.
        var (weights, weightsJson) = await ResolveWeightProfileAsync(organizationId, roleFamily, now, cancellationToken)
            .ConfigureAwait(false);
        var result = FitEngineKernels.ComputeWeightedScore(rawScores, weights);

        // breakdown = { ...rawScores, llmJudgment: null } — all six keys always written, nulls explicit. The
        // router path never carries an llmJudgment (that arrives only via the TS analyzeAiInterview flow).
        var breakdown = new JsonObject();
        foreach (var dim in FitEngineKernels.FitDimensions)
        {
            breakdown[dim] = rawScores[dim] is { } score ? JsonValue.Create(score) : null;
        }

        breakdown["llmJudgment"] = null;

        return await _repository.UpsertFitScoreUnlessWithdrawnAsync(
                organizationId, candidateId, vacancyId, result.OverallScore, breakdown.ToJsonString(), weightsJson,
                result.IsPartial, now, cancellationToken)
            .ConfigureAwait(false);
    }

    // FIT v2 for one candidate: the same reads as v1 except that the per-instrument results REPLACE the
    // latest-of-any-type assessment score (GetLatestAssessmentScoreAsync is not called). Same weight resolution,
    // same five-dimension kernel, same consent-guarded upsert.
    //
    // Write, then verify. The results are read outside the transaction that writes fit_scores, so a slower compute
    // could write a result's stale integrity over a newer compute's row: A reads a valid result, the result turns
    // needs-review (a cancel or a proctoring flag), B writes needs_review, then A writes the counted score. So
    // every v2 compute re-reads its results AFTER its write and, when they changed, evaluates and writes again.
    // The last write to land is always followed by its own check, so the row ends on results at least as new as
    // that check; a change after it is picked up by the next compute, as for every other input. Bounded by
    // MaxV2Writes: under continuous churn the last write stands. Only the results are re-read: they carry the
    // integrity state, and the other inputs keep v1's snapshot semantics.
    private async Task<bool> ComputeFitScoreV2Async(
        Guid organizationId, Guid candidateId, Guid vacancyId, FitRequirements requirements,
        IReadOnlyList<AssessmentRequirement> assessmentRequirements, string? roleFamily, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var candidate = await _repository.GetCandidateForFitAsync(organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        var results = await _assessmentResults
            .GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        var interviewScore = await _repository
            .GetLatestInterviewFitScoreAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);

        var (weights, weightsJson) = await ResolveWeightProfileAsync(organizationId, roleFamily, now, cancellationToken)
            .ConfigureAwait(false);
        var candidateLanguages = ParseNullableJson(candidate?.Languages);

        for (var write = 1; ; write++)
        {
            var evaluation = FitV2Kernels.Evaluate(
                assessmentRequirements, results, weights, requirements, candidateLanguages);

            var rawScores = new Dictionary<string, double?>(StringComparer.Ordinal)
            {
                ["assessment"] = evaluation.AssessmentScore,
                ["interview"] = interviewScore,
                ["experience"] = FitEngineKernels.DeriveExperienceScore(candidate?.YearsExperience, requirements),
                ["education"] = FitEngineKernels.DeriveEducationScore(
                    ParseNullableJson(candidate?.Education), requirements),
                ["languages"] = evaluation.LanguagesScore,
            };

            var result = FitEngineKernels.ComputeWeightedScore(rawScores, weights);
            var breakdown = FitV2Kernels.BuildBreakdown(rawScores, evaluation.Entries, evaluation.ReviewPending);

            // A scored result awaiting review is left out of the number, so the number is provisional. Store the
            // row as partial (the vacancy ranking and the pipeline views flag a partial score; some readers do
            // not, see the design doc); the breakdown's reviewPending says why, so a reader can hold the row apart.
            var isPartial = result.IsPartial || evaluation.ReviewPending;

            var written = await _repository.UpsertFitScoreUnlessWithdrawnAsync(
                    organizationId, candidateId, vacancyId, result.OverallScore, breakdown.ToJsonString(),
                    weightsJson, isPartial, now, cancellationToken)
                .ConfigureAwait(false);
            if (!written)
            {
                // #312: withdrawn since the previous write (or before the first) — nothing more is written. The
                // candidate counts as scored only if an earlier write of this compute landed.
                return write > 1;
            }

            var current = await _assessmentResults
                .GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken)
                .ConfigureAwait(false);
            if (SameResults(results, current) || write == MaxV2Writes)
            {
                return true;
            }

            results = current;
        }
    }

    // Order-insensitive: a source may return its rows in any order. InstrumentResult is a record of value-typed
    // and string fields, so Equals compares every field (integrity, value, completedAt, versions).
    private static bool SameResults(IReadOnlyList<InstrumentResult> a, IReadOnlyList<InstrumentResult> b) =>
        a.Count == b.Count
        && a.OrderBy(r => r.Instrument, StringComparer.Ordinal).ThenBy(r => r.Source, StringComparer.Ordinal)
            .ThenBy(r => r.ResultId, StringComparer.Ordinal)
            .SequenceEqual(b.OrderBy(r => r.Instrument, StringComparer.Ordinal)
                .ThenBy(r => r.Source, StringComparer.Ordinal).ThenBy(r => r.ResultId, StringComparer.Ordinal));

    // TS resolveWeightProfile: roleFamily profile (an EMPTY-STRING roleFamily is falsy in TS → skipped) →
    // 'Default' profile → CREATE Default with 0.2s. Returns the parsed dict for the kernel AND the raw jsonb for
    // storage — fit_scores.weights stores the profile jsonb AS-IS (extra/garbage keys included), never a
    // re-serialization of the parsed dict.
    private async Task<(IReadOnlyDictionary<string, double> Weights, string Json)> ResolveWeightProfileAsync(
        Guid organizationId, string? roleFamily, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrEmpty(roleFamily))
        {
            var profile = await _repository.FindWeightProfileAsync(organizationId, roleFamily, cancellationToken)
                .ConfigureAwait(false);
            if (profile is not null)
            {
                return (FitEngineKernels.ParseWeights(JsonNode.Parse(profile.Weights)), profile.Weights);
            }
        }

        var defaultProfile = await _repository
            .FindWeightProfileAsync(organizationId, DefaultProfileName, cancellationToken)
            .ConfigureAwait(false);
        if (defaultProfile is not null)
        {
            return (FitEngineKernels.ParseWeights(JsonNode.Parse(defaultProfile.Weights)), defaultProfile.Weights);
        }

        var created = await _repository
            .UpsertWeightProfileAsync(organizationId, DefaultProfileName, DefaultWeightsJson, now, cancellationToken)
            .ConfigureAwait(false);
        return (FitEngineKernels.ParseWeights(JsonNode.Parse(created.Weights)), created.Weights);
    }

    // The five validated weights → the row jsonb, in the TS object-literal key order (jsonb canonicalizes
    // storage order anyway; this only shapes the pre-storage string).
    private static string BuildWeightsJson(IReadOnlyDictionary<string, double> weights)
    {
        var json = new JsonObject();
        foreach (var dim in FitEngineKernels.FitDimensions)
        {
            json[dim] = weights[dim];
        }

        return json.ToJsonString();
    }

    private static JsonNode? ParseNullableJson(string? raw) => raw is null ? null : JsonNode.Parse(raw);
}
