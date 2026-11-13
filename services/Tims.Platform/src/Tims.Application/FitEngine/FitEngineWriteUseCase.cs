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
/// <c>assessments</c> after the six v1 keys. A v2 compute reads the results and writes the row atomically under a
/// per-(candidate, vacancy) lock (see <c>ComputeFitScoreV2Async</c>), so a slower concurrent v2 compute cannot leave
/// a stale integrity state as the row's last word, and a failed compute leaves the row untouched. In every other case the v1
/// code below runs unchanged — same reads, same breakdown bytes.</para>
/// </summary>
public sealed class FitEngineWriteUseCase(
    IFitEngineWriteRepository repository, IAssessmentResultSource assessmentResults)
{
    private const string DefaultProfileName = "Default";

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
    /// The C#-owned <c>fit_requirements</c> write (FIT v2): validates the body by <see cref="FitRequirementsInput"/>,
    /// then merges it atomically. Returns null (with <paramref name="error"/>) for an invalid body; the stored
    /// requirements plus every dropped or changed <c>assessments[]</c> entry otherwise.
    /// </summary>
    public async Task<FitRequirementsSaved?> UpdateFitRequirementsAsync(
        Guid organizationId, Guid vacancyId, JsonNode? body, DateTimeOffset now, CancellationToken cancellationToken,
        Action<string, IReadOnlyList<FitRequirementIssue>>? onInvalid = null, bool liaScoredAllowed = false)
    {
        if (FitRequirementsInput.Validate(body, liaScoredAllowed, out var error, out var issues) is not { } write)
        {
            onInvalid?.Invoke(error!, issues);
            return null;
        }

        var stored = await _repository.UpsertFitRequirementsAsync(
                organizationId, vacancyId, write.FitRequirements.ToJsonString(), write.ReplacesAssessments, now,
                cancellationToken)
            .ConfigureAwait(false);
        return stored is null
            ? null
            : new FitRequirementsSaved(JsonNode.Parse(stored), write.Issues);
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
    public Task<ComputeForVacancyResult> ComputeForVacancyAsync(
        Guid organizationId, Guid vacancyId, DateTimeOffset now, bool fitV2Enabled,
        CancellationToken cancellationToken) =>
        ComputeForVacancyAsync(organizationId, vacancyId, now, fitV2Enabled, liaScoredAllowed: false, cancellationToken);

    /// <summary>
    /// <c>computeForVacancy</c> with the FIT v2 switch and the LIA policy: <paramref name="liaScoredAllowed"/> false
    /// (norms unconfirmed, owner default D20) evaluates a scored LIA entry as a threshold gate
    /// (<see cref="FitV2Kernels.ApplyLiaThresholdPolicy"/>).
    /// </summary>
    public async Task<ComputeForVacancyResult> ComputeForVacancyAsync(
        Guid organizationId, Guid vacancyId, DateTimeOffset now, bool fitV2Enabled, bool liaScoredAllowed,
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
        var assessmentRequirements = fitV2Enabled ? ParseV2Requirements(requirementsNode, liaScoredAllowed) : null;

        var scored = 0;
        foreach (var candidateId in candidateIds)
        {
            // #312: false ⇒ the candidate withdrew after the pre-loop check (re-checked under the withdrawal's lock
            // immediately before the write) — nothing written, not counted.
            var computed = assessmentRequirements is null
                ? ComputeFitScoreAsync(
                    organizationId, candidateId, vacancyId, requirements, vacancy?.RoleFamily, now, cancellationToken)
                : ComputeFitScoreV2Async(
                    organizationId, candidateId, vacancyId, liaScoredAllowed, vacancy?.RoleFamily, now,
                    onlyIfRowExists: false, cancellationToken);
            if (await computed.ConfigureAwait(false))
            {
                scored++;
            }
        }

        return new ComputeForVacancyResult(scored);
    }

    /// <summary>
    /// Recompute ONE FIT v2 row after an input it depends on changed (an assignment cancelled, voided, flagged,
    /// graded or reviewed, or a provider result stored; see the <c>fit_recompute_requests</c> queue). Only a vacancy
    /// configured for FIT v2 is recomputed, and only when the flag is on. A row that already exists is rewritten. A
    /// MISSING row is created only for a provider result (round 11): the candidate holds an active application for
    /// the vacancy (the computeForVacancy population) and the in-lock result read holds a provider result for an
    /// instrument the vacancy lists, so a candidate whose provider result arrives before HR's first compute still gets
    /// a FIT v2 row. Every other change to a pair without a row still writes nothing (computeForVacancy decides who
    /// is scored). The existence check and that decision run under the FIT v2 lock, so a first compute still in
    /// flight is waited for. The same consent guard and in-lock result read as computeForVacancy. Returns true when
    /// the row was written.
    /// </summary>
    public async Task<bool> RecomputeExistingAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, DateTimeOffset now, bool fitV2Enabled,
        bool liaScoredAllowed, CancellationToken cancellationToken)
    {
        if (!fitV2Enabled)
        {
            return false;
        }

        var vacancy = await _repository.GetVacancyForFitAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        if (vacancy is null)
        {
            return false;
        }

        var requirementsNode = ParseNullableJson(vacancy.FitRequirements);
        if (ParseV2Requirements(requirementsNode, liaScoredAllowed) is null)
        {
            return false;
        }

        // Asked only for a missing row, in the lock: the repository has already checked the candidate holds an
        // active application for the vacancy (the computeForVacancy population) on the same transaction. Judged on the
        // requirements as read in the lock (Codex ats run 3 [P1]).
        Func<CancellationToken, Task<bool>> createIfMissing = async ct =>
            await V2RequirementsInLockAsync(organizationId, vacancyId, liaScoredAllowed, ct).ConfigureAwait(false)
                is { } inLock
            && HoldsProviderResult(
                await _assessmentResults.GetResultsAsync(organizationId, candidateId, vacancyId, ct).ConfigureAwait(false),
                inLock.Assessments);

        return await ComputeFitScoreV2Async(
                organizationId, candidateId, vacancyId, liaScoredAllowed, vacancy.RoleFamily, now, onlyIfRowExists: true,
                cancellationToken, createIfMissing)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// True when <paramref name="results"/> holds a provider result (any integrity: a needs-review result is reported
    /// as such, never dropped) for an instrument <paramref name="requirements"/> lists.
    /// </summary>
    public static bool HoldsProviderResult(
        IReadOnlyList<InstrumentResult> results, IReadOnlyList<AssessmentRequirement> requirements) =>
        results.Any(r => string.Equals(r.Source, ProviderFitSourceName, StringComparison.Ordinal)
            && requirements.Any(q => string.Equals(q.Instrument, r.Instrument, StringComparison.Ordinal)));

    // Tims.Domain.Assessments.Providers.ProviderFitMapping.SourceName: the tag the provider adapter puts on its results.
    private const string ProviderFitSourceName = Tims.Domain.Assessments.Providers.ProviderFitMapping.SourceName;

    private static IReadOnlyList<AssessmentRequirement>? ParseV2Requirements(JsonNode? requirementsNode, bool liaScoredAllowed) =>
        FitV2Kernels.ParseAssessmentRequirements(requirementsNode) is { } parsed
            ? FitV2Kernels.ApplyLiaThresholdPolicy(parsed, liaScoredAllowed)
            : null;

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
    // same five-dimension kernel, same consent guard.
    //
    // The results carry the integrity state (a cancel, a proctoring flag, an essay awaiting grading), so they are read
    // INSIDE the write: UpsertFitScoreV2Async holds a per-(org, candidate, vacancy) advisory lock across that read,
    // the evaluation and the upsert, in one transaction. Two v2 computes cannot interleave (A reads valid, a cancel
    // lands, B writes needs_review, A writes its stale clean score is impossible: B waits for A's commit and then
    // reads the cancel, or A waits for B's and reads it). A failure or a cancellation anywhere in that unit rolls it
    // back, so a compute never leaves a row it could not stand behind. A change that commits after the last compute's
    // in-lock read is picked up by the next compute, as for every other input. The other inputs (candidate data,
    // interview score, weights) keep v1's snapshot semantics.
    /// <summary>
    /// The vacancy's requirements as read INSIDE the FIT v2 write (under the shared requirements lock the edit trigger
    /// takes exclusively), or null when it is no longer configured for FIT v2 there.
    /// </summary>
    private async Task<(FitRequirements Requirements, IReadOnlyList<AssessmentRequirement> Assessments)?> V2RequirementsInLockAsync(
        Guid organizationId, Guid vacancyId, bool liaScoredAllowed, CancellationToken cancellationToken)
    {
        var node = ParseNullableJson(
            await _repository.GetFitRequirementsInLockAsync(organizationId, vacancyId, cancellationToken).ConfigureAwait(false));
        return ParseV2Requirements(node, liaScoredAllowed) is { } assessments
            ? (FitEngineKernels.ParseRequirements(node), assessments)
            : null;
    }

    private async Task<bool> ComputeFitScoreV2Async(
        Guid organizationId, Guid candidateId, Guid vacancyId, bool liaScoredAllowed, string? roleFamily,
        DateTimeOffset now, bool onlyIfRowExists, CancellationToken cancellationToken,
        Func<CancellationToken, Task<bool>>? createIfMissing = null)
    {
        var candidate = await _repository.GetCandidateForFitAsync(organizationId, candidateId, cancellationToken)
            .ConfigureAwait(false);
        var interviewScore = await _repository
            .GetLatestInterviewFitScoreAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);

        var (weights, weightsJson) = await ResolveWeightProfileAsync(organizationId, roleFamily, now, cancellationToken)
            .ConfigureAwait(false);
        var candidateLanguages = ParseNullableJson(candidate?.Languages);

        return await _repository.UpsertFitScoreV2Async(
                organizationId, candidateId, vacancyId, weightsJson, now,
                async ct =>
                {
                    // The requirements as of the lock, never the caller's earlier read (Codex ats run 3 [P1]).
                    if (await V2RequirementsInLockAsync(organizationId, vacancyId, liaScoredAllowed, ct).ConfigureAwait(false)
                        is not { } inLock)
                    {
                        return null;
                    }

                    var (requirements, assessmentRequirements) = inLock;
                    var experience = FitEngineKernels.DeriveExperienceScore(candidate?.YearsExperience, requirements);
                    var education = FitEngineKernels.DeriveEducationScore(
                        ParseNullableJson(candidate?.Education), requirements);
                    var results = await _assessmentResults
                        .GetResultsAsync(organizationId, candidateId, vacancyId, ct)
                        .ConfigureAwait(false);
                    return BuildV2Write(
                        assessmentRequirements, results, weights, requirements, candidateLanguages, interviewScore,
                        experience, education);
                },
                cancellationToken,
                onlyIfRowExists,
                createIfMissing)
            .ConfigureAwait(false);
    }

    private static FitScoreWrite BuildV2Write(
        IReadOnlyList<AssessmentRequirement> assessmentRequirements, IReadOnlyList<InstrumentResult> results,
        IReadOnlyDictionary<string, double> weights, FitRequirements requirements, JsonNode? candidateLanguages,
        int? interviewScore, double? experience, double? education)
    {
        var evaluation = FitV2Kernels.Evaluate(
            assessmentRequirements, results, weights, requirements, candidateLanguages);

        var rawScores = new Dictionary<string, double?>(StringComparer.Ordinal)
        {
            ["assessment"] = evaluation.AssessmentScore,
            ["interview"] = interviewScore,
            ["experience"] = experience,
            ["education"] = education,
            ["languages"] = evaluation.LanguagesScore,
        };

        var result = FitEngineKernels.ComputeWeightedScore(rawScores, weights);
        var breakdown = FitV2Kernels.BuildBreakdown(rawScores, evaluation.Entries, evaluation.ReviewPending);

        // Owner default D6: what a narrow-scoped reader may see of this row's overall (null when nothing is hidden).
        var redacted = FitV2Visibility.RedactBelowMinimum(breakdown, out var hidesSomething);
        double? restricted = hidesSomething
            ? FitEngineKernels.ComputeWeightedScore(FitEngineKernels.ParseBreakdownScores(redacted), weights).OverallScore
            : null;

        // A scored result awaiting review is left out of the number, so the number is provisional. Store the row as
        // partial; the breakdown's reviewPending says why, so a reader can hold the row apart.
        return new FitScoreWrite(
            result.OverallScore, breakdown.ToJsonString(), result.IsPartial || evaluation.ReviewPending, restricted);
    }

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
