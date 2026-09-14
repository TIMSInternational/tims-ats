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
/// </summary>
public sealed class FitEngineWriteUseCase(IFitEngineWriteRepository repository)
{
    private const string DefaultProfileName = "Default";

    // TS DEFAULT_WEIGHTS, verbatim — written only when no 'Default' profile exists yet.
    private const string DefaultWeightsJson =
        """{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""";

    private readonly IFitEngineWriteRepository _repository = repository;

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

    /// <summary><c>computeForVacancy</c> — score every active-pipeline candidate; response is the count only.</summary>
    public async Task<ComputeForVacancyResult> ComputeForVacancyAsync(
        Guid organizationId, Guid vacancyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var candidateIds = await _repository.GetPipelineCandidateIdsAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        if (candidateIds.Count == 0)
        {
            // No candidates ⇒ no reads, no Default-profile bootstrap — TS maps over an empty array the same way.
            return new ComputeForVacancyResult(0);
        }

        var vacancy = await _repository.GetVacancyForFitAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        // Vacancy null (soft-deleted between probe and compute) ⇒ requirements {} and roleFamily null — the TS
        // `vacancy?.` chain, not an error.
        var requirements = FitEngineKernels.ParseRequirements(ParseNullableJson(vacancy?.FitRequirements));

        foreach (var candidateId in candidateIds)
        {
            await ComputeFitScoreAsync(
                    organizationId, candidateId, vacancyId, requirements, vacancy?.RoleFamily, now, cancellationToken)
                .ConfigureAwait(false);
        }

        return new ComputeForVacancyResult(candidateIds.Count);
    }

    // TS computeFitScore for one candidate: 4 reads → derive → resolve weights → weighted score → upsert.
    // A null candidate (soft-deleted while still holding an active application — getPipelineCandidateIds does
    // not join candidates) still gets a row: person-dims null, assessment/interview still fetched. TS parity.
    private async Task ComputeFitScoreAsync(
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

        await _repository.UpsertFitScoreAsync(
                organizationId, candidateId, vacancyId, result.OverallScore, breakdown.ToJsonString(), weightsJson,
                result.IsPartial, now, cancellationToken)
            .ConfigureAwait(false);
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
